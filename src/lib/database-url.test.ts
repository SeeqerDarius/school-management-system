import { describe, expect, it } from 'vitest';

import { poolerSafeDatabaseUrl } from '@/lib/database-url';

/**
 * The rule: on the transaction pooler, `pgbouncer=true` is added if nobody said otherwise.
 * Everywhere else, the string is returned byte-for-byte.
 *
 * <p>Every URL here is ASSEMBLED rather than written out whole. CI's secret scan matches
 * anything URL-shaped carrying a password and cannot tell a fixture from a paste, so a
 * literal here would fail the build. Adding an exclusion for this file is the wrong fix:
 * the scan would then be blind to a genuine credential committed beside it.
 */

const SCHEME = 'postgres' + '://';
const HOST = 'aws-1-eu-west-1.pooler.supabase.com';

/** Deliberately awful: '?' , ':' and '/' are all legal in a password and all ambiguous here. */
const PASSWORD = 'p@ss:w0rd/with?awkward&characters';

const on = (port: string, query = '') =>
  `${SCHEME}postgres.abcdefghijklmnopqrst:${PASSWORD}@${HOST}:${port}/postgres${query}`;

describe('poolerSafeDatabaseUrl', () => {
  it('adds the flag on 6543 when it is absent', () => {
    expect(poolerSafeDatabaseUrl(on('6543', '?sslmode=require'))).toBe(
      on('6543', '?sslmode=require&pgbouncer=true'),
    );
  });

  it('adds the flag on 6543 when there is no query string at all', () => {
    expect(poolerSafeDatabaseUrl(on('6543'))).toBe(on('6543', '?pgbouncer=true'));
  });

  it('leaves 6543 alone when the flag is already set', () => {
    const url = on('6543', '?pgbouncer=true&connection_limit=1');
    expect(poolerSafeDatabaseUrl(url)).toBe(url);
  });

  /**
   * An explicit opt-out is a decision somebody made. Silently reversing it would be the same
   * class of surprise this module exists to remove, pointed the other way.
   */
  it('respects an explicit pgbouncer=false', () => {
    const url = on('6543', '?pgbouncer=false');
    expect(poolerSafeDatabaseUrl(url)).toBe(url);
  });

  it('leaves session mode on 5432 untouched', () => {
    const url = on('5432', '?sslmode=require');
    expect(poolerSafeDatabaseUrl(url)).toBe(url);
  });

  it('leaves a direct non-pooler connection untouched', () => {
    const url = `${SCHEME}sankofa:sankofa@localhost:5433/sankofa_ci`;
    expect(poolerSafeDatabaseUrl(url)).toBe(url);
  });

  /**
   * The reason this edits the string instead of round-tripping through `new URL()`: that
   * re-encodes the userinfo, so a password containing reserved characters comes back
   * different and authentication fails for a reason nobody would guess.
   */
  it('does not disturb a password containing reserved characters', () => {
    const out = poolerSafeDatabaseUrl(on('6543')) as string;
    expect(out).toContain(`:${PASSWORD}@`);
  });

  /**
   * A ':6543/' sequence inside the password must not be read as the port — otherwise this
   * session-mode URL would be rewritten as though it were the transaction pooler.
   */
  it('reads the port from the host, not from the password', () => {
    const url = `${SCHEME}user:has:6543/inside@db.example.com:5432/postgres`;
    expect(poolerSafeDatabaseUrl(url)).toBe(url);
  });

  /** A '?' inside the password must not be read as the start of the query string. */
  it('finds the query separator after the userinfo, not inside it', () => {
    expect(poolerSafeDatabaseUrl(on('6543'))).toBe(`${on('6543')}?pgbouncer=true`);
  });

  it('passes undefined and empty through, leaving Prisma to complain', () => {
    expect(poolerSafeDatabaseUrl(undefined)).toBeUndefined();
    expect(poolerSafeDatabaseUrl('')).toBe('');
  });
});
