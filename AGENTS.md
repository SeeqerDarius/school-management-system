# AGENTS.md — rules for anyone (human or agent) writing code in this repository

Read this before your first edit. Read `docs/ARCHITECTURE.md` before your second.

This file is **normative**. Where it conflicts with convenience, convenience loses.

---

## 1. Absolute prohibitions

These are not style preferences. A pull request violating any of them is rejected on sight.

| # | Never | Why |
|---|---|---|
| 1 | **Never bypass authorization for convenience** — no "temporarily allow everyone", no commented-out `requirePermission` | Authorization holes are the top cause of real breaches in school systems |
| 2 | **Never remove or `.skip` a test to make CI pass** | Fix the code or fix the test's premise; deleting evidence is not a fix |
| 3 | **Never disable TypeScript strictness** — no `any`, no `@ts-ignore`, no `strict: false` | Types are the cheapest correctness tool available |
| 4 | **Never bypass the tenant-scoped client** — no `$queryRaw` against a tenant-owned table, no importing `db` from `@/server/db` outside auth-before-tenant, platform administration and seeding | Invariant I-1. A cross-tenant leak is release-blocking |
| 5 | **Never expose a credential** — nothing secret in the repository, in a `NEXT_PUBLIC_*` variable, or in a client bundle | One leak compromises every school |
| 6 | **Never mutate a posted accounting entry** | Invariant I-3. Correct by reversal |
| 7 | **Never trust the client for identity, tenant or permission** | It is trusted only to render what it was given |
| 8 | **Never use floating point for money** — no `Float` in the schema, no `number` for an amount | Invariant I-2 |
| 9 | **Never add AI, ML, LLM or "smart insight" features** | Product rule §1. Everything is deterministic and auditable |
| 10 | **Never ship placeholder data in a production code path** — no `TODO`, no "Coming Soon", no hardcoded `const students = 500` outside seed files | A screen that lies is worse than a screen that is absent |
| 11 | **Never swallow an error to keep a screen looking successful** | Invariant I-8 |
| 12 | **Never edit a migration that has been merged** | Add a new one. Applied history is immutable, and its checksum is recorded in every database that ran it |

---

## 2. Definition of Done

A feature is **not** done when its screens exist. It is done when all sixteen hold:

1. Schema exists, with a reviewed migration in `prisma/migrations/`
2. Server-side implementation exists — reads in `data.ts`, writes in `actions.ts`
3. Authorization is enforced server-side with a granular permission, not a role name
4. Validation exists on the server (client validation is UX only)
5. Frontend exists
6. The UI works at phone width, not just desktop
7. Error states exist
8. Loading states exist
9. Empty states exist, and say something useful
10. Tests exist — the pure rules as unit tests, plus at least one against a real database
11. Tenant isolation is covered by an automated test
12. Audit entries are written where the action is sensitive
13. Documentation is updated
14. Accessibility considered — keyboard, labels, contrast, focus
15. Security reviewed against the module's threat notes
16. Production build succeeds

Update `IMPLEMENTATION_STATUS.md` honestly. "Functional" means it works. "Complete" means all
sixteen above. Do not conflate them.

---

## 3. Commands

```bash
npm ci                      # install
npm run dev                 # development server
npm run typecheck           # tsc --noEmit, strict
npm run lint                # ESLint — separate from the build; Next 16 no longer runs it
npm test                    # fast tests: pure functions, no database
npm run test:db             # tenant isolation and database constraints, real PostgreSQL
npm run build               # production build

npm run db:migrate          # create and apply a migration — refuses a non-local database
npm run db:deploy           # apply existing migrations (CI and production). Only ever adds
npm run db:seed             # permission catalogue, system roles, demo school outside production
npm run db:studio           # look at the data
npm run db:reset            # drop and recreate — refuses a non-local database
```

`npm test` and `npm run test:db` are separate on purpose. The database suites are *excluded* from
the default run rather than skipped inside it: a suite that quietly excuses itself when a variable
is missing is a suite that stops running and never says so.

---

## 4. Architectural boundaries

- **Business rules live in `src/lib`** as pure functions — no database, no session, no framework.
  If a calculation decides money, a grade or an approval, it belongs there and it is tested
  exhaustively without a database.
- **`data.ts` reads, `actions.ts` writes.** A Server Component does not query directly.
- **Every database access goes through `forTenant()`.** The unscoped client in `@/server/db` is for
  exactly three things: authentication before a tenant is known, platform administration, and
  seeding. Importing it anywhere else needs a comment saying which of the three it is.
- **A feature never imports another feature's `data.ts` or `actions.ts`.** Shared reads become a
  function in the owning feature, exported deliberately.
- **The client never decides.** Rendering a button is not authorization; the action re-checks.

---

## 5. Code conventions

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. No `any`,
  no non-null `!` on anything that came from outside the process.
- Money is `Prisma.Decimal` in the server and a `string` at the boundary. Never `parseFloat` an
  amount, never a `number`.
- Zod at every trust boundary — form data included, and *especially* form data.
- Server Components by default. `'use client'` requires a reason a reviewer would accept.
- A permission is referenced through the `P` constant, never a string literal. A typo in a literal
  compiles, runs, and denies everybody forever.
- Dates that are calendar dates stay strings until the last moment, then become UTC midnight.
  `new Date('2026-09-08')` rendered with `getDate()` is the 7th west of Greenwich.

### Prisma and SQL

- One migration per logical change. Never edit one that has been merged.
- **A migration that creates a table ends by enabling row-level security on it.** Copy the RLS
  block from `20260919092000_data_api_lockdown`. Prisma never emits it and `ALTER DEFAULT
  PRIVILEGES` cannot carry it forward, so a new table ships reachable over Supabase's Data API
  unless the migration says otherwise. `tests/db/data-api-lockdown.test.ts` fails the build if you
  forget, which is the only reason this is a rule rather than a hope.
- Every tenant-owned table gets `tenantId`, and the model is added to the right category in
  `src/server/tenant-scope.ts` in the same change. `tenantScopeCoverage.test.ts` fails otherwise.
- **A tenant-owned table also gets a row-level security policy in the same migration**, granting
  `sankofa_app` access to its own school's rows and nothing else. Copy the block from
  `20260921030000_tenant_rls_policies`. RLS without a policy is a closed table and the product
  breaks; RLS with a policy nobody tested is theatre. `tests/db/rls-policies.test.ts` fails the
  build when a table carries `tenantId` and has no policy.
- A write policy is never enough on its own. Prisma emits `INSERT ... RETURNING` for every
  `create()`, and PostgreSQL evaluates the **SELECT** policy against the returned row — so a row
  the application may write but not read fails the statement after passing its `WITH CHECK`.
  Whatever a migration lets the application insert, it must also let it read back.
- Constraints the schema language cannot express go in a raw-SQL migration — ordering, non-overlap,
  "at most one current", partial unique indexes. The application checks them too, for the better
  message, but the database is what guarantees them.
- Indexes ship with the migration that creates the query, not in a later "performance" pass.
- Destructive migrations go out alone, never bundled with a feature, with a rollback note.

### Server Actions

Validate → authorize → transact → audit → revalidate. In that order, every time.

```ts
const parsed = schema.safeParse({ … });            // the browser is not trusted
if (!parsed.success) return invalid(parsed.error.issues);

const { db, tenantId, userId, membershipId } = await requirePermission(P.SOMETHING);

await db.$transaction(async (tx) => {
  const record = await tx.thing.findUnique({ where: { id } });   // re-read, do not trust the form
  if (!canTransition(record.status, next)) throw new RuleViolation('…');
  await tx.thing.update({ … });
  await recordAudit(tx, { … });                    // same transaction, or it is not evidence
});

revalidatePath(PATH);
```

---

## 6. Security requirements for every change

Ask these before opening a pull request:

- Can a user of School A reach this data, this file, this export or this identifier?
- Is the permission checked **server-side**, with a granular permission rather than a role string?
- Does this write an audit record? Sensitive actions require one, plus a reason where the action is
  irreversible.
- Does any log line, error message or metric now carry a password, token, key, full payment detail,
  medical note or plaintext message?
- Is anything client-supplied trusted — a price, a balance, a grade, a tenant id, an approval flag?
- Does a new upload path validate MIME, size and filename, and stay out of a public location?
- Does a new webhook verify its signature, and is it idempotent against replay?
- Does an error message shown to a user reveal a table name, a constraint name or an identifier?

---

## 7. Testing requirements

| Change touches | Minimum required |
|---|---|
| Any tenant-owned table | a cross-tenant isolation test proving School A cannot read, write, delete or export School B |
| Any permission | a test asserting both the allow and the deny |
| Money | a test asserting exact `Decimal` values, including rounding and a partial payment |
| A journal | a test asserting debits equal credits, and that a posted journal rejects mutation |
| Grading | deterministic fixture tests for weighting, ties, absent and exempt students |
| A state machine | tests for every legal transition and at least one illegal one |
| A database constraint | a test that the *database* refuses it, not that the application does |

Tests that only assert "no exception thrown" do not count.

---

## 8. Migration requirements

- Never edit a merged migration. Add a new one. CI fails a pull request that modifies, deletes or
  renames anything under `prisma/migrations/`.
- A migration must apply to an empty database. CI proves this on every pull request.
- `prisma migrate diff` runs in CI against the applied migrations. A `schema.prisma` edited without
  a matching migration fails the build.
- Migrations are backwards compatible with the code currently running — add nullable, backfill,
  tighten later. Both versions are live for a few seconds during a deploy.
- Reconcile anything applied out of band (a console, an MCP tool, a `psql` session) back into a
  migration file **immediately**. Drift is how staging and production stop matching.
- `db:migrate` and `db:reset` refuse any host that is not localhost, and that guard is not to be
  removed. Both DROP and recreate; against Supabase they also destroy the project's own `auth` and
  `storage` schemas, and the project does not recover.

---

## 9. Git

- Conventional commits: `feat(scope):`, `fix(scope):`, `test(scope):`, `docs(scope):`,
  `chore(scope):`, `refactor(scope):`, `perf(scope):`, `build(scope):`, `ci(scope):`.
- Atomic commits. One logical change each. Never knowingly commit a broken `main`.
- Keep `IMPLEMENTATION_STATUS.md` current in the same commit as the change it describes.

---

## 10. When the specification is silent

1. Choose the most conventional professional implementation.
2. Record the decision as an ADR in `docs/adr/`.
3. Keep it configurable if a school, a country or a regulator would plausibly want it different.

Ghana is the first optimized configuration, never the only supported one. Anything Ghana-specific —
class structures, PAYE bands, SSNIT rates, GHS, term shapes — is **data**, not code.
