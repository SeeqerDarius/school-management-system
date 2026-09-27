import 'server-only';

import { createHmac } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  ACCOUNT_POLICY,
  ADDRESS_POLICY,
  lockRemainingMs,
  retryAfterSeconds,
  type ThrottlePolicy,
} from '@/lib/sign-in-throttle';

/**
 * Sign-in throttling, counted from the security log.
 *
 * <p>`security_event` already records every refused sign-in — the trail existed and nothing
 * acted on it. This acts on it, rather than introducing a second table that can disagree with
 * the audit trail about what happened.
 *
 * <h2>Why the account key is a hash of the address, not the user id</h2>
 * Keying on `userId` looks natural and is a account-enumeration oracle. An account that does not
 * exist has no id, so it could never lock; an attacker submits five wrong passwords and learns
 * from the lockout alone whether the address is real. Hashing the submitted address instead
 * means a nonexistent account throttles exactly like a real one, and the oracle closes.
 *
 * <p>It is an HMAC keyed with `NEXTAUTH_SECRET` rather than a plain digest, so a stolen database
 * does not let somebody confirm addresses offline by hashing a mailing list. It is also why the
 * raw address is never written to the log: at sign-in the address is whatever an anonymous
 * caller typed, and storing that verbatim turns the security log into somewhere an attacker can
 * write arbitrary text.
 *
 * <h2>What this does not do</h2>
 * It cannot see attempts that never reach the application — a limiter at this layer is a control
 * on credential stuffing, not on volumetric denial of service, and Vercel's platform limits
 * remain the only thing in front of it.
 */

export type ThrottleScope = 'ACCOUNT' | 'ADDRESS';

export interface ThrottleDecision {
  allowed: boolean;
  /** Which limit refused it. For the log line — never for the response shown to the caller. */
  scope?: ThrottleScope;
  retryAfterSeconds: number;
}

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

/** Stable, non-reversible key for an address being signed in to. */
export function accountKey(email: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Refusing here rather than falling back to an unkeyed digest: a silent downgrade to a
    // plain hash would still work, and would quietly ship the offline-enumeration weakness the
    // HMAC exists to prevent. NEXTAUTH_SECRET is required for sign-in to function at all.
    throw new Error('NEXTAUTH_SECRET is required to key the sign-in throttle');
  }
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex');
}

async function countFailures(
  tx: Prisma.TransactionClient,
  where: Prisma.SecurityEventWhereInput,
  policy: ThrottlePolicy,
  now: Date,
): Promise<{ failures: number; lastFailureAt: Date | null }> {
  const since = new Date(now.getTime() - policy.windowMs);

  const result = await tx.securityEvent.aggregate({
    where: { ...where, eventType: SIGN_IN_FAILED, occurredAt: { gte: since } },
    _count: { _all: true },
    _max: { occurredAt: true },
  });

  return {
    failures: result._count._all,
    lastFailureAt: result._max.occurredAt ?? null,
  };
}

export const SIGN_IN_FAILED = 'SIGN_IN_FAILED';
/**
 * Recorded when an attempt is refused *by the throttle*, and deliberately a different event type
 * from a failure. Counting these would let an attacker hold a victim's account shut forever by
 * continuing to knock; as it is, the lock decays on its own however hard anyone hammers.
 */
export const SIGN_IN_THROTTLED = 'SIGN_IN_THROTTLED';

/**
 * Decides whether this attempt may proceed to the password comparison.
 *
 * <p>Checked **before** bcrypt, which is the only placement that saves anything: a limit applied
 * after verification still pays the cost it exists to avoid, once per attempt, for as long as
 * the attacker cares to keep going.
 */
export async function checkSignInThrottle(
  tx: Prisma.TransactionClient,
  identity: { emailHash: string; ipAddress: string | null },
  now: Date = new Date(),
): Promise<ThrottleDecision> {
  const [account, address] = await Promise.all([
    countFailures(tx, { detail: { path: ['emailHash'], equals: identity.emailHash } }, ACCOUNT_POLICY, now),
    identity.ipAddress
      ? countFailures(tx, { ipAddress: identity.ipAddress }, ADDRESS_POLICY, now)
      : Promise.resolve({ failures: 0, lastFailureAt: null }),
  ]);

  const accountLock = lockRemainingMs(account.failures, account.lastFailureAt, now, ACCOUNT_POLICY);
  const addressLock = lockRemainingMs(address.failures, address.lastFailureAt, now, ADDRESS_POLICY);

  if (accountLock <= 0 && addressLock <= 0) return ALLOWED;

  // Whichever holds longer decides how long to wait; the scope reported is the one that set it.
  const scope: ThrottleScope = accountLock >= addressLock ? 'ACCOUNT' : 'ADDRESS';
  return {
    allowed: false,
    scope,
    retryAfterSeconds: retryAfterSeconds(Math.max(accountLock, addressLock)),
  };
}

/**
 * The client address, as far as it can be trusted.
 *
 * <p>`x-vercel-forwarded-for` is set by the platform and cannot be set by the caller, so it is
 * preferred. `x-forwarded-for` is a client-supplied header that a trusted proxy overwrites — it
 * is only meaningful because Vercel does overwrite it, and the leftmost entry is the origin.
 *
 * <p>**This assumes the application is reachable only through that proxy.** Expose the server
 * directly and a forged header earns a fresh allowance per fabricated address, which is worse
 * than having no limiter, because the dashboard still says there is one. Recorded in
 * docs/DEPLOYMENT.md as a deployment requirement rather than an implementation detail.
 */
export function clientAddress(headers: Record<string, string | undefined> | undefined): string | null {
  if (!headers) return null;

  const vercel = headers['x-vercel-forwarded-for'];
  if (vercel) return vercel.split(',')[0]?.trim() ?? null;

  const forwarded = headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;

  return headers['x-real-ip']?.trim() ?? null;
}
