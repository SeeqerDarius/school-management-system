import 'server-only';

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

import { withRequestContext } from '@/server/db-context';
import { effectivePermissions, membershipsForUser } from '@/server/auth/permissions';
import {
  accountKey,
  checkSignInThrottle,
  clientAddress,
  SIGN_IN_FAILED,
  SIGN_IN_THROTTLED,
} from '@/server/auth/throttle';

/**
 * Authentication.
 *
 * <p>Email and password, verified against a bcrypt hash. No external identity provider, no
 * emulator, nothing to provision — which is the whole point of this stack.
 *
 * <h2>Two properties worth stating</h2>
 *
 * <p><b>Signing in does not choose a school.</b> The token carries the user; the active
 * membership is set by a separate, separately-checked step. So "which tenant am I acting as" is
 * always a decision the server verified, never an inference from a subdomain or a client hint.
 *
 * <p><b>Accounts are invited, never self-registered.</b> There is no sign-up route. A school
 * invites someone, which creates the user row; setting a password claims it. Holding an email
 * address is not a route into a school.
 */
export const authOptions: NextAuthOptions = {
  session: {
    // JWT rather than a database session table: it is one fewer round trip per request, and it
    // works naturally on serverless. Revocation is handled by `sessionsValidFrom` below.
    strategy: 'jwt',
    maxAge: 12 * 60 * 60,
  },

  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },

  providers: [
    CredentialsProvider({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const ipAddress = clientAddress(req?.headers as Record<string, string | undefined>);
        const emailHash = accountKey(email);

        // Before bcrypt, on purpose. A limit applied after verification still pays the cost it
        // exists to avoid — a bcrypt comparison per attempt, for as long as the attacker keeps
        // going. Refusing here costs one indexed count.
        const throttle = await withRequestContext({}, (tx) =>
          checkSignInThrottle(tx, { emailHash, ipAddress }),
        );

        if (!throttle.allowed) {
          await recordSecurityEvent(null, SIGN_IN_THROTTLED, 'WARNING', {
            ipAddress,
            emailHash,
            detail: { scope: throttle.scope, retryAfterSeconds: throttle.retryAfterSeconds },
          });
          // The same null every other refusal returns. Saying "you are locked out" would
          // confirm the address is worth attacking, and saying how long would tell a script
          // exactly when to resume.
          return null;
        }

        // Bound to the address being authenticated, and nothing else. The row-level security
        // policy on app_user admits exactly that one row to an otherwise anonymous transaction,
        // so a query here cannot return the user table even if it forgets its where clause.
        const user = await withRequestContext({ signInEmail: email }, (tx) =>
          tx.appUser.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              fullName: true,
              status: true,
              passwordHash: true,
            },
          }),
        );

        // Every failure below returns the same null, so the response cannot be used to work out
        // which email addresses have accounts. The timing is evened out by always running a
        // bcrypt comparison, even when there is no user to compare against.
        const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
        const passwordMatches = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !passwordMatches) {
          await recordSecurityEvent(user?.id ?? null, SIGN_IN_FAILED, 'NOTICE', {
            ipAddress,
            emailHash,
          });
          return null;
        }

        if (user.status !== 'ACTIVE') {
          await recordSecurityEvent(user.id, `SIGN_IN_REFUSED_${user.status}`, 'NOTICE', {
            ipAddress,
            emailHash,
          });
          return null;
        }

        await withRequestContext({ userId: user.id }, (tx) =>
          tx.appUser.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          }),
        );
        await recordSecurityEvent(user.id, 'SIGN_IN_SUCCEEDED', 'INFO', { ipAddress, emailHash });

        return { id: user.id, email: user.email, name: user.fullName };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id;
        token.issuedAt = Date.now();
        // No school is chosen at sign-in. Choosing one is a separate, verified step.
        token.activeMembershipId = null;
      }

      // Switching schools. The membership is checked against the ones this user actually
      // holds — a client asking to act as someone else's membership gets nothing.
      if (trigger === 'update' && session?.activeMembershipId !== undefined) {
        const requested = session.activeMembershipId as string | null;
        if (requested === null) {
          token.activeMembershipId = null;
        } else {
          // No tenant is bound: the whole question is which school to switch to. The policy
          // allows a user to see their own memberships in that state and nobody else's, so a
          // client naming somebody else's membership id gets null from the database itself.
          const held = await withRequestContext({ userId: token.userId as string }, (tx) =>
            tx.membership.findFirst({
              where: { id: requested, userId: token.userId as string, status: 'ACTIVE' },
              select: { id: true },
            }),
          );
          token.activeMembershipId = held?.id ?? null;
        }
      }

      return token;
    },

    async session({ session, token }) {
      const userId = token.userId as string | undefined;
      if (!userId) return session;

      // A password change or an administrative revocation advances `sessionsValidFrom`,
      // invalidating tokens issued before it without waiting for them to expire.
      const user = await withRequestContext({ userId }, (tx) =>
        tx.appUser.findUnique({
          where: { id: userId },
          select: { status: true, sessionsValidFrom: true },
        }),
      );

      const issuedAt = token.issuedAt as number | undefined;
      const revoked =
        !user ||
        user.status !== 'ACTIVE' ||
        (issuedAt !== undefined && issuedAt < user.sessionsValidFrom.getTime());

      if (revoked) {
        // An expired shell rather than a throw: NextAuth renders this as "signed out", which is
        // what the person should experience. Built from nothing rather than spread from the
        // incoming session, so no identity field can survive by being forgotten here.
        return {
          user: {},
          expires: new Date(0).toISOString(),
          activeMembershipId: null,
          permissions: [],
          memberships: [],
        };
      }

      session.userId = userId;
      session.memberships = await membershipsForUser(userId);

      const activeMembershipId = (token.activeMembershipId as string | null) ?? null;
      session.activeMembershipId = activeMembershipId;

      if (activeMembershipId) {
        const active = session.memberships.find((m) => m.id === activeMembershipId);
        // Guards the case where a membership was revoked after the token was minted.
        if (active) {
          session.tenantId = active.tenantId;
          session.tenantSlug = active.tenant.slug;
          session.permissions = [...(await effectivePermissions(activeMembershipId, userId))];
        } else {
          session.activeMembershipId = null;
          session.permissions = [];
        }
      } else {
        session.permissions = [];
      }

      return session;
    },
  },
};

/**
 * Records an authentication outcome.
 *
 * <p>Failures matter most: credential stuffing against parent accounts should leave a trail.
 * Never records the password, the attempted password, or anything derived from it.
 */
async function recordSecurityEvent(
  userId: string | null,
  eventType: string,
  severity: 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL',
  context: {
    ipAddress?: string | null;
    /** Keyed hash of the address attempted. Never the address itself — see throttle.ts. */
    emailHash?: string;
    detail?: Record<string, unknown>;
  } = {},
) {
  try {
    // No tenant, and often no user: a refused sign-in is exactly the case the write policy has
    // to admit, and the read policy with it — Prisma's create() returns the row it wrote.
    await withRequestContext({ userId }, (tx) =>
      tx.securityEvent.create({
        data: {
          userId,
          eventType,
          severity,
          ipAddress: context.ipAddress ?? null,
          // The throttle counts rows by this, so it is written on every sign-in outcome rather
          // than only on failures — a success must still be findable in the same trail.
          detail: { ...(context.detail ?? {}), ...(context.emailHash ? { emailHash: context.emailHash } : {}) },
        },
      }),
    );
  } catch {
    // Never let audit-write failure block or alter a sign-in decision. The sign-in outcome
    // is the user-facing contract; losing one log row is regrettable, refusing a legitimate
    // sign-in because of it is worse.
  }
}
