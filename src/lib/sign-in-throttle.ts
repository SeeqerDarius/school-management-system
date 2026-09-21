/**
 * How hard to slow a sign-in down, given how many times it has just failed.
 *
 * <p>Pure arithmetic, deliberately separated from the query that feeds it, because the part
 * worth testing exhaustively is the ladder and the part that needs a database is trivial.
 *
 * <h2>Two keys, and why their numbers are so different</h2>
 * An attacker is throttled by address; a victim is protected by account. They need different
 * allowances, and the address one has to be generous for a reason specific to this product: a
 * school is very often one internet connection. Every teacher at Greenfield shares an address,
 * and a Monday-morning limit that assumes one person per IP locks out the whole staff room.
 *
 * <p>So the address limit is set where a genuine crowd will not reach it and a scripted attack
 * will, and the account limit — five wrong passwords in a quarter of an hour — is the precise
 * control. Distributed credential stuffing evades the first by design; the second is what
 * catches it, because it does not matter where the attempts come from.
 */

export interface ThrottlePolicy {
  /** How far back failures are counted. Older ones have aged out and no longer weigh. */
  windowMs: number;
  /** Rungs, in ascending order of failure count. The highest one reached applies. */
  ladder: ReadonlyArray<{ failures: number; lockMs: number }>;
}

const MINUTE = 60_000;

/**
 * Five wrong passwords in fifteen minutes is already unusual for a person who knows their
 * password; it is nothing at all for a script. The ladder climbs steeply after that, so a
 * sustained attack on one account becomes pointless long before it becomes expensive for us.
 */
export const ACCOUNT_POLICY: ThrottlePolicy = {
  windowMs: 15 * MINUTE,
  ladder: [
    { failures: 5, lockMs: 1 * MINUTE },
    { failures: 10, lockMs: 5 * MINUTE },
    { failures: 20, lockMs: 30 * MINUTE },
    { failures: 40, lockMs: 120 * MINUTE },
  ],
};

/**
 * Thirty in fifteen minutes from one address. A staff room of forty people signing in on Monday
 * morning does not reach this, because they mostly succeed and only failures are counted.
 */
export const ADDRESS_POLICY: ThrottlePolicy = {
  windowMs: 15 * MINUTE,
  ladder: [
    { failures: 30, lockMs: 1 * MINUTE },
    { failures: 60, lockMs: 5 * MINUTE },
    { failures: 120, lockMs: 30 * MINUTE },
    { failures: 240, lockMs: 120 * MINUTE },
  ],
};

/**
 * Milliseconds still to wait, or 0 when the attempt may proceed.
 *
 * <p>The lock runs from the **last** failure, not the first, so hammering during a lock keeps
 * the door shut. It is measured against failures alone — a refused-because-throttled attempt is
 * recorded under a different event type and is not counted here, which is what stops an attacker
 * holding somebody's account shut indefinitely simply by continuing to knock.
 */
export function lockRemainingMs(
  failures: number,
  lastFailureAt: Date | null,
  now: Date,
  policy: ThrottlePolicy,
): number {
  if (!lastFailureAt || failures <= 0) return 0;

  let lockMs = 0;
  for (const rung of policy.ladder) {
    if (failures >= rung.failures) lockMs = rung.lockMs;
  }
  if (lockMs === 0) return 0;

  const elapsed = now.getTime() - lastFailureAt.getTime();
  const remaining = lockMs - elapsed;
  return remaining > 0 ? remaining : 0;
}

/** Whole seconds, rounded up, for a `Retry-After`-shaped value. Never 0 while a lock holds. */
export function retryAfterSeconds(remainingMs: number): number {
  return remainingMs <= 0 ? 0 : Math.max(1, Math.ceil(remainingMs / 1000));
}
