import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * The Data API lockdown holds.
 *
 * <p>Prisma never emits `ENABLE ROW LEVEL SECURITY`, and `ALTER DEFAULT PRIVILEGES` cannot carry
 * RLS forward to a table that does not exist yet. So the moment somebody adds a `student` or
 * `invoice` model — which, for a school ERP with a ledger, is the very next feature — that table
 * ships with RLS off unless its migration re-runs the block from `20260919092000_data_api_lockdown`.
 *
 * <p>The failure is silent: no error, no warning, the table is simply reachable. This test is what
 * makes it loud.
 */

afterAll(async () => {
  await db.$disconnect();
});

describe('Data API lockdown', () => {
  it('leaves no table in public without row level security', async () => {
    const unprotected = await db.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relrowsecurity
      ORDER BY c.relname`;

    expect(
      unprotected.map((row) => row.relname),
      'These tables have no row-level security. Add the RLS block from ' +
        '20260919092000_data_api_lockdown to the migration that created them.',
    ).toEqual([]);
  });

  /**
   * Meaningful only against Supabase. On the bare PostgreSQL that CI uses there is no `anon`
   * role, so there is nothing to assert — but the check is written to pass vacuously rather
   * than be skipped, so it starts working the moment it is pointed at a real project.
   */
  it('grants the Data API roles nothing, wherever those roles exist', async () => {
    const [present] = await db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS "exists"`;

    if (!present?.exists) return;

    const reachable = await db.$queryRaw<
      { relname: string; grantee: string; privilege_type: string }[]
    >`
      SELECT c.relname, g.grantee::regrole::text AS grantee, g.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}')) AS g
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND g.grantee::regrole::text IN ('anon', 'authenticated')
        AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      ORDER BY 1, 2, 3`;

    expect(
      reachable,
      'These tables are reachable over the Supabase Data API with the public anon key.',
    ).toEqual([]);
  });

  /**
   * btree_gist must not be in `public`.
   *
   * <p>In `public` on Supabase its ~100 support functions are published through PostgREST and
   * pg_graphql, and Supabase's own security lint flags it. The migration installs it into
   * `extensions`; this catches anyone quietly reverting that to make a local run easier.
   */
  it('keeps btree_gist out of the public schema', async () => {
    const [placed] = await db.$queryRaw<{ nspname: string }[]>`
      SELECT n.nspname
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'btree_gist'`;

    expect(placed?.nspname).toBe('extensions');
  });

  /**
   * And the constraints that depend on it still work.
   *
   * <p>The fear that moving an extension out of `search_path` breaks an exclusion constraint is
   * a reasonable one and it is wrong: the operator class is resolved by a catalog scan at DDL
   * time and stored as an OID. This asserts the outcome rather than the reasoning.
   */
  it('still backs both calendar exclusion constraints with gist', async () => {
    const constraints = await db.$queryRaw<{ conname: string; amname: string }[]>`
      SELECT c.conname, am.amname
      FROM pg_constraint c
      JOIN pg_class i ON i.oid = c.conindid
      JOIN pg_am am ON am.oid = i.relam
      WHERE c.conrelid IN ('public.academic_year'::regclass, 'public.term'::regclass)
        AND c.contype = 'x'
      ORDER BY c.conname`;

    expect(constraints.map((row) => row.conname)).toEqual([
      'academic_year_no_overlap',
      'term_no_overlap',
    ]);
    expect(constraints.every((row) => row.amname === 'gist')).toBe(true);
  });
});
