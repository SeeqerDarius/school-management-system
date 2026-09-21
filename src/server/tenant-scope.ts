import 'server-only';

import { Prisma } from '@prisma/client';
import type { ITXClientDenyList } from '@prisma/client/runtime/library';

import { db } from '@/server/db';
import { bindRequestContext, type RequestContext } from '@/server/db-context';

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
 * <h2>How it relates to row-level security</h2>
 * It is not the only control any more, and it is the weaker of the two. The policies added in
 * `20260921030000_tenant_rls_policies` enforce the same rule inside PostgreSQL, where a raw
 * query cannot reach past it. This extension still earns its place: it means a developer never
 * writes the filter, so the database's answer and the application's agree by construction
 * rather than by diligence — and when they disagree, the database wins.
 *
 * <p>Both are bound by {@link inTenantTransaction}, which is the only way to obtain a scoped
 * client that the policies will also accept. Using {@link forTenant} directly gives you the
 * application-side filter with no context bound, which under the restricted role reads nothing.
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
  'Student',
  'Guardian',
  'GuardianRelationship',
  'Enrolment',
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

/** The scoped client as it appears inside a transaction: no `$transaction`, no `$connect`. */
export type TenantTx = Omit<TenantClient, ITXClientDenyList>;

/**
 * The one way to do tenant-owned work.
 *
 * <p>Opens a transaction, binds the request context the row-level security policies read, and
 * hands back a client that also carries the application-side tenant filter. Both controls, one
 * call, and no way to take only the weaker one by accident.
 *
 * ```ts
 * const years = await inTenantTransaction(session, (db) => db.academicYear.findMany());
 * ```
 *
 * <p>Reads go in here as well as writes. A read outside a transaction has no tenant bound, and
 * under the restricted role the policies answer it with nothing — correctly, but confusingly, so
 * the shape is the same for both rather than a rule to remember.
 */
export async function inTenantTransaction<T>(
  context: RequestContext & { tenantId: string },
  work: (db: TenantTx) => Promise<T>,
): Promise<T> {
  return forTenant(context.tenantId).$transaction(async (tx) => {
    await bindRequestContext(tx, context);
    return work(tx);
  });
}

export function forTenant(tenantId: string) {
  if (!tenantId) {
    // Failing here is correct. The alternative — an empty filter — is an unscoped query,
    // which is the exact failure this module exists to prevent.
    throw new Error('forTenant requires a tenant id; refusing to build an unscoped client');
  }

  const scopedClient = db.$extends({
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

  return scopedClient;
}

/**
 * Execute a transaction with RLS session variable set for tenant isolation.
 * This ensures RLS policies have access to the current tenant ID.
 *
 * <p>Usage:
 * ```ts
 * await withRlsTransaction(tenantId, async (tx) => {
 *   await tx.someModel.create({ data: { ... } });
 * });
 * ```
 *
 * <p>Note: This sets the session variable at the start of the transaction.
 * All operations within the callback will have RLS enforcement active.
 */
export async function withRlsTransaction<T>(
  tenantId: string,
  callback: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  const tx = forTenant(tenantId);

  return tx.$transaction(async (transactionTx) => {
    // Set the session variable for RLS policies at the start of the transaction
    // set_config accepts a bound value, so the authenticated tenant id is never SQL text.
    await transactionTx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return callback(transactionTx as TenantClient);
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
