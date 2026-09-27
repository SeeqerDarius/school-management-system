import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_POLICY,
  ADDRESS_POLICY,
  lockRemainingMs,
  retryAfterSeconds,
  type ThrottlePolicy,
} from '@/lib/sign-in-throttle';

/**
 * The throttle ladder.
 *
 * <p>Every boundary is asserted on both sides, because an off-by-one here is not a cosmetic
 * defect: one rung too lenient and credential stuffing proceeds at full speed, one rung too
 * strict and a bursar who mistypes their password three times is locked out of payroll.
 */

const NOW = new Date('2026-09-21T12:00:00Z');
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
const MINUTE = 60_000;

describe('below the first rung', () => {
  it('does not lock on no failures at all', () => {
    expect(lockRemainingMs(0, null, NOW, ACCOUNT_POLICY)).toBe(0);
  });

  it('does not lock a person who mistyped their password four times', () => {
    expect(lockRemainingMs(4, at(MINUTE), NOW, ACCOUNT_POLICY)).toBe(0);
  });

  it('ignores a failure count with no timestamp, rather than guessing', () => {
    expect(lockRemainingMs(50, null, NOW, ACCOUNT_POLICY)).toBe(0);
  });
});

describe('the rungs', () => {
  it('locks for a minute at exactly five failures', () => {
    expect(lockRemainingMs(5, NOW, NOW, ACCOUNT_POLICY)).toBe(1 * MINUTE);
  });

  it('climbs at ten, twenty and forty', () => {
    expect(lockRemainingMs(10, NOW, NOW, ACCOUNT_POLICY)).toBe(5 * MINUTE);
    expect(lockRemainingMs(20, NOW, NOW, ACCOUNT_POLICY)).toBe(30 * MINUTE);
    expect(lockRemainingMs(40, NOW, NOW, ACCOUNT_POLICY)).toBe(120 * MINUTE);
  });

  it('holds at the top rung rather than growing without bound', () => {
    expect(lockRemainingMs(10_000, NOW, NOW, ACCOUNT_POLICY)).toBe(120 * MINUTE);
  });

  it('applies the highest rung reached, not the first one passed', () => {
    // 25 is past the 20 rung and short of 40, so it is the 20 rung that applies.
    expect(lockRemainingMs(25, NOW, NOW, ACCOUNT_POLICY)).toBe(30 * MINUTE);
  });
});

describe('the lock expiring', () => {
  it('counts down from the last failure', () => {
    expect(lockRemainingMs(5, at(20_000), NOW, ACCOUNT_POLICY)).toBe(40_000);
  });

  it('is over once the lock duration has passed', () => {
    expect(lockRemainingMs(5, at(1 * MINUTE), NOW, ACCOUNT_POLICY)).toBe(0);
  });

  it('never reports a negative wait', () => {
    expect(lockRemainingMs(5, at(10 * MINUTE), NOW, ACCOUNT_POLICY)).toBe(0);
  });

  it('restarts from the newest failure, so knocking during a lock keeps it shut', () => {
    // The caller passes the most recent failure; an attempt that fails again moves it forward.
    const beforeRetry = lockRemainingMs(5, at(50_000), NOW, ACCOUNT_POLICY);
    const afterRetry = lockRemainingMs(6, NOW, NOW, ACCOUNT_POLICY);

    expect(beforeRetry).toBe(10_000);
    expect(afterRetry).toBe(1 * MINUTE);
  });
});

describe('the two policies', () => {
  it('lets a whole school share one address without tripping the account limit', () => {
    // Twenty-nine failures from one building in fifteen minutes is a bad Monday, not an attack.
    expect(lockRemainingMs(29, NOW, NOW, ADDRESS_POLICY)).toBe(0);
    // The same count against one account is not a bad Monday.
    expect(lockRemainingMs(29, NOW, NOW, ACCOUNT_POLICY)).toBeGreaterThan(0);
  });

  it('keeps the address window generous but finite', () => {
    expect(lockRemainingMs(30, NOW, NOW, ADDRESS_POLICY)).toBe(1 * MINUTE);
    expect(lockRemainingMs(240, NOW, NOW, ADDRESS_POLICY)).toBe(120 * MINUTE);
  });

  it('counts both over the same fifteen-minute window', () => {
    expect(ACCOUNT_POLICY.windowMs).toBe(15 * MINUTE);
    expect(ADDRESS_POLICY.windowMs).toBe(15 * MINUTE);
  });

  it('keeps every ladder in ascending order, which the "highest rung wins" rule assumes', () => {
    const ascending = (p: ThrottlePolicy) =>
      p.ladder.every((rung, i) => i === 0 || rung.failures > (p.ladder[i - 1]?.failures ?? 0));

    expect(ascending(ACCOUNT_POLICY)).toBe(true);
    expect(ascending(ADDRESS_POLICY)).toBe(true);
  });
});

describe('retryAfterSeconds', () => {
  it('rounds up, so a wait is never reported as already over', () => {
    expect(retryAfterSeconds(1)).toBe(1);
    expect(retryAfterSeconds(1500)).toBe(2);
  });

  it('is zero when nothing is pending', () => {
    expect(retryAfterSeconds(0)).toBe(0);
    expect(retryAfterSeconds(-5)).toBe(0);
  });
});
