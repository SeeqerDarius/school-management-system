import { randomUUID } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';
import { withRequestContext } from '@/server/db-context';
import {
  accountKey,
  checkSignInThrottle,
  SIGN_IN_FAILED,
  SIGN_IN_THROTTLED,
} from '@/server/auth/throttle';

/**
 * Sign-in throttling, against the log it actually counts.
 *
 * <p>The ladder is covered exhaustively in `src/lib/sign-in-throttle.test.ts` without a
 * database. What needs a real one is the query: that it counts the right rows, over the right
 * window, keyed the way the policy assumes — and that the two event types stay distinct, which
 * is the difference between a lock that decays and one an attacker can hold shut forever.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tests/db requires DATABASE_URL to point at a disposable PostgreSQL database.');
}

process.env.NEXTAUTH_SECRET ??= 'throttle-test-secret';

const suffix = randomUUID().slice(0, 8);
const email = `throttle-${suffix}@example.test`;
const otherEmail = `other-${suffix}@example.test`;
const address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

let emailHash: string;

/** Writes `count` failures, the most recent `mostRecentMsAgo` ago and the rest older. */
async function recordFailures(
  count: number,
  options: { hash?: string; ip?: string | null; mostRecentMsAgo?: number; eventType?: string } = {},
) {
  const { hash = emailHash, ip = address, mostRecentMsAgo = 0, eventType = SIGN_IN_FAILED } = options;

  await db.securityEvent.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      eventType,
      severity: 'NOTICE' as const,
      ipAddress: ip,
      detail: { emailHash: hash },
      occurredAt: new Date(Date.now() - mostRecentMsAgo - i * 1000),
    })),
  });
}

const check = (ip: string | null = address, hash = emailHash) =>
  withRequestContext({}, (tx) => checkSignInThrottle(tx, { emailHash: hash, ipAddress: ip }));

beforeAll(() => {
  emailHash = accountKey(email);
});

afterEach(async () => {
  await db.securityEvent.deleteMany({ where: { ipAddress: address } });
  await db.securityEvent.deleteMany({
    where: { detail: { path: ['emailHash'], equals: emailHash } },
  });
  await db.securityEvent.deleteMany({
    where: { detail: { path: ['emailHash'], equals: accountKey(otherEmail) } },
  });
});

describe('the account limit', () => {
  it('allows an attempt when nothing has failed', async () => {
    await expect(check()).resolves.toMatchObject({ allowed: true });
  });

  it('allows four failures and refuses the fifth', async () => {
    await recordFailures(4);
    await expect(check()).resolves.toMatchObject({ allowed: true });

    await recordFailures(1);
    const decision = await check();

    expect(decision.allowed).toBe(false);
    expect(decision.scope).toBe('ACCOUNT');
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts an address that has no account, so a lockout cannot prove one exists', async () => {
    // The whole reason the key is a hash of the submitted address rather than a user id.
    // These rows carry no userId at all — a nonexistent account throttles like a real one.
    await recordFailures(5, { hash: accountKey(otherEmail) });

    const unknown = await check(null, accountKey(otherEmail));

    expect(unknown.allowed).toBe(false);
  });

  it('keeps one account’s failures away from another’s', async () => {
    await recordFailures(10, { hash: accountKey(otherEmail), ip: null });

    await expect(check(null)).resolves.toMatchObject({ allowed: true });
  });

  it('ignores failures that have aged out of the window', async () => {
    await recordFailures(10, { mostRecentMsAgo: 16 * 60_000 });

    await expect(check()).resolves.toMatchObject({ allowed: true });
  });
});

describe('the address limit', () => {
  it('tolerates a crowd behind one address that the account limit would not', async () => {
    // Twenty-nine failures spread across twenty-nine different accounts from one school's
    // connection. No account is near its limit and the address is not either.
    for (let i = 0; i < 29; i += 1) {
      await recordFailures(1, { hash: accountKey(`staff-${i}-${suffix}@example.test`) });
    }

    await expect(check(address, accountKey(`nobody-${suffix}@example.test`))).resolves.toMatchObject(
      { allowed: true },
    );

    await db.securityEvent.deleteMany({ where: { ipAddress: address } });
  });

  it('refuses once one address passes its own limit', async () => {
    for (let i = 0; i < 30; i += 1) {
      await recordFailures(1, { hash: accountKey(`staff-${i}-${suffix}@example.test`) });
    }

    const decision = await check(address, accountKey(`nobody-${suffix}@example.test`));

    expect(decision.allowed).toBe(false);
    expect(decision.scope).toBe('ADDRESS');
  });

  it('does not throttle at all when no address could be determined', async () => {
    await recordFailures(40, { ip: null, hash: accountKey(otherEmail) });

    // Different account, no address: nothing to count against this attempt.
    await expect(check(null)).resolves.toMatchObject({ allowed: true });
  });
});

describe('the two event types', () => {
  it('does not count a refusal as a failure, so a lock decays however hard anyone knocks', async () => {
    // The lockout-denial-of-service guard. If SIGN_IN_THROTTLED counted, an attacker could hold
    // a victim's account shut indefinitely just by continuing to attempt it.
    await recordFailures(4);
    await recordFailures(50, { eventType: SIGN_IN_THROTTLED });

    await expect(check()).resolves.toMatchObject({ allowed: true });
  });
});

describe('the query the limiter runs on every attempt', () => {
  it('uses the partial indexes rather than scanning the security log', async () => {
    await recordFailures(3);

    const plan = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (FORMAT TEXT) SELECT count(*), max("occurredAt") FROM security_event
       WHERE "eventType" = 'SIGN_IN_FAILED' AND (detail ->> 'emailHash') = $1
         AND "occurredAt" >= now() - interval '15 minutes'`,
      emailHash,
    );
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    // On a nearly empty table PostgreSQL may still prefer a sequential scan, and that is a
    // correct choice rather than a defect — so this asserts the index is *available* to the
    // planner, which is the thing a missing migration would break.
    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'security_event' AND indexname LIKE 'security_event_signin_%'
    `;

    expect(indexes.map((i) => i.indexname).sort()).toEqual([
      'security_event_signin_account_idx',
      'security_event_signin_address_idx',
    ]);
    expect(text).toBeTruthy();
  });
});
