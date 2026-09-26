import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * RLS-based tenant isolation tests.
 *
 * <p>These tests verify that row-level security policies are correctly enforced
 * when using the sankofa_app role (without BYPASSRLS). The policies should:
 * 1. Allow access only to rows matching the app.tenant_id session variable
 * 2. Fail closed when the session variable is not set
 * 3. Handle nullable tenant fields correctly for platform rows
 * 4. Handle shared-read tables (role) correctly
 */

const suffix = randomUUID().slice(0, 8);
const slugA = `rls-a-${suffix}`;
const slugB = `rls-b-${suffix}`;
let tenantA = '';
let tenantB = '';
let campusA = '';
let campusB = '';
let studentA = '';
let studentB = '';

beforeAll(async () => {
  const [result] = await db.$queryRaw<{ roleExists: boolean; bypassesRls: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sankofa_app') AS "roleExists",
      COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'sankofa_app'), true) AS "bypassesRls"`;
  if (!result?.roleExists || result.bypassesRls) {
    throw new Error('RLS integration tests require the migrated sankofa_app role without BYPASSRLS.');
  }

  const a = await db.tenant.create({ data: { slug: slugA, legalName: slugA, displayName: slugA, status: 'ACTIVE', countryCode: 'GH', defaultCurrency: 'GHS' } });
  const b = await db.tenant.create({ data: { slug: slugB, legalName: slugB, displayName: slugB, status: 'ACTIVE', countryCode: 'GH', defaultCurrency: 'GHS' } });
  tenantA = a.id;
  tenantB = b.id;
  const ca = await db.campus.create({ data: { tenantId: tenantA, code: 'MAIN', name: 'A Main Campus' } });
  const cb = await db.campus.create({ data: { tenantId: tenantB, code: 'MAIN', name: 'B Main Campus' } });
  campusA = ca.id;
  campusB = cb.id;
  const sa = await db.student.create({ data: { tenantId: tenantA, campusId: campusA, reference: `STU-A-${suffix}`, firstName: 'Student', lastName: 'A', dateOfBirth: new Date('2015-01-01'), gender: 'FEMALE' } });
  const sb = await db.student.create({ data: { tenantId: tenantB, campusId: campusB, reference: `STU-B-${suffix}`, firstName: 'Student', lastName: 'B', dateOfBirth: new Date('2015-01-01'), gender: 'MALE' } });
  studentA = sa.id;
  studentB = sb.id;
});

afterAll(async () => {
  if (tenantA && tenantB) await db.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await db.$disconnect();
});

describe('RLS tenant isolation', () => {
  it('sankofa_app role exists and has no BYPASSRLS', async () => {
    const [role] = await db.$queryRaw<{ rolname: string; rolbypassrls: boolean }[]>`
      SELECT rolname, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'sankofa_app'`;

    expect(role).toBeDefined();
    expect(role?.rolbypassrls).toBe(false);
  });

  // These two ask whether the table is covered, so they match on what covering MEANS —
  // a policy that names sankofa_app — rather than on how the policy happens to be called.
  // They matched `tenant_isolation_%` and `<table>_%` before, which passed only while every
  // policy followed one migration's naming: 20260921030000_tenant_rls_policies replaces the
  // per-verb policies on several of these tables with a single FOR ALL policy, and the old
  // assertion went red without anything being uncovered. A coverage test keyed on a name
  // fails when a name changes and, worse, passes when a differently-named policy grants far
  // more than intended.
  it('tenant-owned tables have RLS policies binding the application role', async () => {
    const tables = ['campus', 'academic_year', 'term', 'membership', 'reference_sequence', 'branding', 'student', 'guardian', 'guardian_relationship', 'enrolment'];

    for (const table of tables) {
      const policies = await db.$queryRaw<{ policyname: string }[]>`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ${table}
          AND 'sankofa_app' = ANY(roles)`;

      expect(policies.length, `${table} has no RLS policy naming sankofa_app`).toBeGreaterThan(0);
    }
  });

  it('nullable-tenant tables have RLS policies binding the application role', async () => {
    const tables = ['audit_log', 'security_event'];

    for (const table of tables) {
      const policies = await db.$queryRaw<{ policyname: string }[]>`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ${table}
          AND 'sankofa_app' = ANY(roles)`;

      expect(policies.length, `${table} has no RLS policy naming sankofa_app`).toBeGreaterThan(0);
    }
  });

  it('shared-read tables have appropriate RLS policies', async () => {
    const policies = await db.$queryRaw<{ policyname: string }[]>`
      SELECT policyname
      FROM pg_policies
      WHERE tablename = 'role'
      AND policyname LIKE 'role_%'`;

    expect(policies.length).toBeGreaterThan(0);
  });

  it('RLS policies use app.tenant_id session variable', async () => {
    const policies = await db.$queryRaw<{ policyname: string; qual: string; with_check: string }[]>`
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE tablename IN ('campus', 'academic_year', 'term', 'membership')
      AND policyname LIKE 'tenant_isolation_%'`;

    for (const policy of policies) {
      const usesSessionVar = 
        (policy.qual?.includes('current_setting') || policy.with_check?.includes('current_setting'));
      expect(usesSessionVar).toBe(true);
    }
  });

  it('RLS policies fail closed when session variable is unset', async () => {
    const visible = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sankofa_app`;
      return tx.student.findMany({ where: { id: studentA } });
    });
    expect(visible).toEqual([]);
  });

  it('enforces tenant isolation for both reads and linked student records', async () => {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sankofa_app`;
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
      const campuses = await tx.campus.findMany({ select: { id: true } });
      const students = await tx.student.findMany({ select: { id: true } });
      return { campuses, students };
    });
    expect(result.campuses.map((row) => row.id)).toEqual([campusA]);
    expect(result.students.map((row) => row.id)).toEqual([studentA]);
    expect(result.students.map((row) => row.id)).not.toContain(studentB);
  });

  it('rejects cross-tenant student-to-campus references at the database boundary', async () => {
    await expect(db.student.create({
      data: { tenantId: tenantA, campusId: campusB, reference: `STU-X-${suffix}`, firstName: 'Cross', lastName: 'Tenant', dateOfBirth: new Date('2015-01-01'), gender: 'OTHER' },
    })).rejects.toThrow();
  });
});

describe('RLS policy permissions', () => {
  it('sankofa_app has appropriate table privileges', async () => {
    const privileges = await db.$queryRaw<{ tablename: string; grantee: string; privilege_type: string }[]>`
      SELECT c.relname as tablename, g.grantee::regrole::text as grantee, g.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS g
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        -- A table nobody has been granted anything on has relacl NULL, not an empty ACL,
        -- and aclexplode rejects the empty array COALESCE would hand it ("ACL arrays must
        -- be one-dimensional"). _prisma_migrations is exactly that table: the application
        -- role is deliberately given nothing on the migration ledger.
        AND c.relacl IS NOT NULL
        AND g.grantee::regrole::text = 'sankofa_app'
      ORDER BY tablename, privilege_type`;

    expect(privileges.length).toBeGreaterThan(0);
    
    // Check for basic privileges on key tables
    const keyTables = ['campus', 'academic_year', 'term', 'membership'];
    for (const table of keyTables) {
      const tablePrivs = privileges.filter(p => p.tablename === table);
      const privTypes = tablePrivs.map(p => p.privilege_type);
      expect(privTypes).toContain('SELECT');
      expect(privTypes).toContain('INSERT');
      expect(privTypes).toContain('UPDATE');
      expect(privTypes).toContain('DELETE');
    }
  });

  it('sankofa_app has schema usage privilege', async () => {
    const [hasUsage] = await db.$queryRaw<{ has_usage: boolean }[]>`
      SELECT has_schema_privilege('sankofa_app', 'public', 'USAGE') as has_usage`;

    expect(hasUsage?.has_usage).toBe(true);
  });
});
