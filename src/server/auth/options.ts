import 'server-only';

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

import { db } from '@/server/db';
import { effectivePermissions, membershipsForUser } from '@/server/auth/permissions';

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

      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await db.appUser.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
            passwordHash: true,
          },
        });

        // Every failure below returns the same null, so the response cannot be used to work out
        // which email addresses have accounts. The timing is evened out by always running a
        // bcrypt comparison, even when there is no user to compare against.
        const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
        const passwordMatches = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !passwordMatches) {
          await recordSecurityEvent(user?.id ?? null, 'SIGN_IN_FAILED', 'NOTICE');
          return null;
        }

        if (user.status !== 'ACTIVE') {
          await recordSecurityEvent(user.id, `SIGN_IN_REFUSED_${user.status}`, 'NOTICE');
          return null;
        }

        await db.appUser.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await recordSecurityEvent(user.id, 'SIGN_IN_SUCCEEDED', 'INFO');

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
          const held = await db.membership.findFirst({
            where: { id: requested, userId: token.userId as string, status: 'ACTIVE' },
            select: { id: true },
          });
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
      const user = await db.appUser.findUnique({
        where: { id: userId },
        select: { status: true, sessionsValidFrom: true },
      });

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
          session.permissions = [...(await effectivePermissions(activeMembershipId))];
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
) {
  try {
    await db.securityEvent.create({ data: { userId, eventType, severity } });
  } catch {
    // Never let audit-write failure block or alter a sign-in decision. The sign-in outcome
    // is the user-facing contract; losing one log row is regrettable, refusing a legitimate
    // sign-in because of it is worse.
  }
}
