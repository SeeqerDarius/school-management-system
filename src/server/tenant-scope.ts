import 'server-only';

import { Prisma } from '@prisma/client';

import { db } from '@/server/db';

/**
 * A Prisma client that cannot read or write outside one tenant.
 *
 * <h2>The problem this solves</h2>
 * The usual approach to multi-tenancy is `where: { tenantId }` written by hand at every call
 * site. It works right up until somebody forgets one — and a forgotten filter does not throw,
 * does not fail a type check and does not look wrong in review. It quietly returns every
 * school's rows. One missing clause on a student list is a disclosure of children's records.
 *
 * <p>So the filter is not written by hand. This extension injects it into every query against a
 * tenant-owned model, and injects `tenantId` into every create. A developer cannot forget it,
 * because there is nothing to remember.
 *
 * <h2>How to use it</h2>
 * ```ts
 * const tx = forTenant(session.tenantId);
 * const years = await tx.academicYear.findMany();   // already scoped
 * ```
 *
 * <h2>What it deliberately does not do</h2>
 * It is not a substitute for PostgreSQL row-level security, which enforces the same rule inside
 * the database where application code cannot reach past it. RLS is the stronger control and is
 * recorded as a planned hardening step in IMPLEMENTATION_STATUS.md. This is the control that
 * exists today, and unlike hand-written filters it is structural rather than remembered.
 */

/**
 * Models that carry a mandatory `tenantId`.
 *
 * <p>Listed explicitly rather than inferred, so adding a tenant-owned model is a deliberate act.
 * `tenantScopeCoverage.test.ts` fails if a model gains a required `tenantId` and is not listed
 * here — the case where a new table silently opts out of scoping.
 */
const TENANT_OWNED = new Set<string>([
  'Campus',
  'AcademicYear',
  'Term',
  'Membership',
  'ReferenceSequence',
]);

/**
 * Models keyed *by* `tenantId` rather than merely carrying it.
 *
 * <p>`Branding` has `tenantId` as its primary key, so the filter is the identity of the row.
 */
const TENANT_KEYED = new Set<string>(['Branding']);

/**
 * Models where `tenantId` is nullable because a row may legitimately belong to the platform
 * rather than to a school — a support engineer's sign-in, a cross-tenant job.
 *
 * <p>Reads are still scoped: `tenantId = <this tenant>` never matches a NULL, so platform rows
 * stay with the platform. That is the intended behaviour, not an accident of NULL handling.
 */
const TENANT_OPTIONAL = new Set<string>(['AuditLog', 'SecurityEvent']);

/**
 * Models where a NULL `tenantId` means "belongs to every school", not "belongs to the platform".
 *
 * <p>`Role` is the case. The 26 system role templates are seeded once with no tenant and every
 * school uses them; a school may also define roles of its own. Scoping these the way AuditLog is
 * scoped would hide the system roles from everybody, because `tenantId = <id>` never matches a
 * NULL — every school would appear to have no roles at all.
 *
 * <p>So reads match this tenant's rows OR the shared ones. Writes do not: an update or a delete
 * is narrowed to this tenant's own rows alone, so one school cannot rename a role template that
 * every other school is using.
 */
const TENANT_SHARED = new Set<string>(['Role']);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_WITH_WHERE = new Set(['update', 'updateMany', 'delete', 'deleteMany']);

export type TenantClient = ReturnType<typeof forTenant>;

export function forTenant(tenantId: string) {
  if (!tenantId) {
    // Failing here is correct. The alternative — an empty filter — is an unscoped query,
    // which is the exact failure this module exists to prevent.
    throw new Error('forTenant requires a tenant id; refusing to build an unscoped client');
  }

  return db.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped =
            TENANT_OWNED.has(model) ||
            TENANT_KEYED.has(model) ||
            TENANT_OPTIONAL.has(model) ||
            TENANT_SHARED.has(model);

          if (!scoped) {
            return query(args);
          }

          const a = args as Record<string, unknown>;

          // findUnique accepts non-unique fields in `where` alongside the unique one
          // (Prisma's extended where-unique, generally available since 5.0), so the tenant is
          // simply added. Rewriting it to a findFirst on the outer client would silently
          // escape an enclosing transaction.
          const isRead =
            operation === 'findUnique' ||
            operation === 'findUniqueOrThrow' ||
            READ_OPERATIONS.has(operation);

          if (isRead && TENANT_SHARED.has(model)) {
            // This tenant's rows plus the shared ones.
            return query({
              ...a,
              where: withClause(a.where, { OR: [{ tenantId }, { tenantId: null }] }),
            });
          }

          if (isRead || WRITE_WITH_WHERE.has(operation)) {
            // Writes to a shared model fall through to here deliberately: narrowed to this
            // tenant's own rows, so the shared templates cannot be edited from inside a school.
            return query({ ...a, where: withClause(a.where, { tenantId }) });
          }

          if (operation === 'create') {
            return query({
              ...a,
              data: { ...((a.data as object) ?? {}), tenantId },
            });
          }

          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const data = a.data;
            const withTenant = Array.isArray(data)
              ? data.map((row) => ({ ...(row as object), tenantId }))
              : { ...(data as object), tenantId };
            return query({ ...a, data: withTenant });
          }

          if (operation === 'upsert') {
            return query({
              ...a,
              where: withClause(a.where, { tenantId }),
              create: { ...((a.create as object) ?? {}), tenantId },
            });
          }

          // An operation this extension does not understand must not silently run unscoped.
          throw new Error(
            `tenant-scope does not handle "${operation}" on ${model}. ` +
              'Add explicit handling rather than bypassing the scope.',
          );
        },
      },
    },
  });
}

/**
 * Adds a tenant condition to a where clause without disturbing what the caller wrote.
 *
 * <p>Composed under `AND` rather than spread over the caller's `where`, and the difference is
 * not cosmetic. Spreading `{ ...where, tenantId }` lets the injected value overwrite an explicit
 * one, so `findMany({ where: { tenantId: someOtherSchool } })` quietly returns *this* school's
 * rows — the right rows, for a question nobody asked. Under `AND` the two conditions contradict
 * and the query returns nothing, which is the honest answer.
 *
 * <p>It also keeps the caller's own fields at the top level, which `findUnique` requires, and
 * preserves an `AND` the caller had already written rather than replacing it.
 *
 * <p>Note the deliberate asymmetry with `create`, where the tenant id IS overwritten: a row has
 * to be written to exactly one tenant, and the only safe choice is the session's.
 */
function withClause(where: unknown, clause: object): Record<string, unknown> {
  const existing = (where as Record<string, unknown>) ?? {};
  const previous = existing.AND;

  const AND =
    previous === undefined
      ? [clause]
      : Array.isArray(previous)
        ? [...previous, clause]
        : [previous, clause];

  return { ...existing, AND };
}

/** The models this extension scopes — exported so a test can assert the list is complete. */
export const scopedModels = {
  owned: [...TENANT_OWNED],
  keyed: [...TENANT_KEYED],
  optional: [...TENANT_OPTIONAL],
  shared: [...TENANT_SHARED],
};

/** Every Prisma model that declares a `tenantId` field, read from the generated DMMF. */
export function modelsWithTenantId(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name);
}
