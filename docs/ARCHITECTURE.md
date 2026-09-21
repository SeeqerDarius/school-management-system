# Architecture

> **What this is for:** the shape of the system and the rules that hold it together. Read §2
> before writing any code — those eight invariants are what makes this a system of record rather
> than a database with screens on it.

The history of how the system got this shape is in [adr/](adr/). In particular,
[ADR 0010](adr/0010-nextjs-fullstack-on-vercel.md) records the collapse of an earlier two-service
design into this one, and is candid about what that cost.

---

## 1. System shape

One deployable unit.

```
Browser
   │  HTTPS
   ▼
Next.js 16 on Vercel  ──────────────────────────────────┐
   │                                                    │
   ├── Server Components ..... read, render             │  one process,
   ├── Server Actions ........ validate, write, audit   │  one deployment,
   └── NextAuth .............. sessions, sign-in        │  one set of secrets
   │                                                    │
   │  Prisma, through a tenant-scoped client            │
   ▼                                                    │
PostgreSQL on Supabase ─────────────────────────────────┘
   Supavisor transaction mode for the app, session mode for migrations
```

There is no HTTP API between the page and the database, because there is nothing on the other side
of one. The same process renders the page and performs the write.

### Responsibility split

| Concern | Lives in | Note |
| --- | --- | --- |
| Rendering | `src/app/**`, Server Components by default | `'use client'` only where interaction demands it |
| Reads | `src/features/*/data.ts` | Permission checked, then the scoped client |
| Writes | `src/features/*/actions.ts` | Validate → authorize → transact → audit |
| Business rules | `src/lib/**` | Pure functions. No database, no session, testable in milliseconds |
| Identity | `src/server/auth/**` | Sessions, permissions, revocation |
| Tenancy | `src/server/tenant-scope.ts` | The single most important file in the repository |
| Schema | `prisma/schema.prisma` + `prisma/migrations/**` | Migrations are append-only history |

The state machine for a feature lives in `src/lib`, not in the action. `canTransition` and
`validateTermRange` know nothing about Prisma or sessions, which is why they can be tested
exhaustively without a database and why the question "can a closed year be reopened" has exactly
one answer in the codebase.

---

## 2. Invariants

These are load-bearing. Violating one is a release-blocking defect.

### I-1 Tenant isolation is structural, never remembered

Every tenant-owned table carries `tenantId uuid not null`. No query filters on it by hand.

All access goes through `forTenant(tenantId)` — a Prisma client extension that injects the filter
into every `where` and every `create`, and **throws** on any operation it does not recognise rather
than letting it run unscoped. The tenant is resolved from the authenticated principal's
**membership**, never from a request header, body, query parameter or subdomain.

The database enforces the same rule underneath, and that is the stronger half. Migration
`20260921030000_tenant_rls_policies` adds per-tenant policies to every table carrying a
`tenantId`, and creates `sankofa_app` — a login role declared `NOBYPASSRLS`, so the policies
actually bind. The policies read `app.tenant_id`, a transaction-local setting bound by
`src/server/db-context.ts`; an unbound transaction matches nothing, so forgetting to bind loses
data rather than leaking it.

`inTenantTransaction()` is the only way to get a scoped client, and it binds both controls at
once — there is no way to take the weaker one by accident.

> **The operational half is not automatic.** The role ships `NOLOGIN` and without a password,
> because a password in a migration is a password in git. Until an operator grants it and points
> `DATABASE_URL` at it — see [DEPLOYMENT.md](DEPLOYMENT.md) — the application still connects as
> `postgres`, which carries `BYPASSRLS`, and the policies are inert in that deployment however
> green the tests are. The code is correct under both roles; only the connection string decides
> which controls are live.

Three guards, and the third is the one that matters: `tenantScopeCoverage.test.ts` fails if a
model gains a `tenantId` and is not scoped; `tests/db/tenant-isolation.test.ts` proves the
application-side behaviour; `tests/db/rls-policies.test.ts` connects **as `sankofa_app`** and
proves the database refuses cross-tenant reads, updates, deletes and writes-by-claim on its own.
That last one is deliberate — a catalog check for `relrowsecurity` cannot tell enforcement from
theatre, and asking the question over a bypassing connection answers it vacuously.

### I-2 Money is decimal and carries its currency

`numeric(19,4)` in PostgreSQL, `Prisma.Decimal` in TypeScript, `string` at the boundary. Never
`Float` in the schema, never a JavaScript `number` for an amount — a `number` holds 0.1 + 0.2 as
0.30000000000000004, and a ledger that does that is not a ledger. Every monetary column is
accompanied by a `currency char(3)` ISO-4217 column, or inherits one from an explicitly documented
parent row.

### I-3 Posted financial records are immutable

A journal in state `POSTED` can never be updated or deleted. Correction is by **reversal** or by an
**adjusting journal** that references the original. Enforced by a database trigger, not only by
application code — a trigger is behind the console session and the import script too.

### I-4 Every posted journal balances

`sum(debit) = sum(credit)` per journal, in the journal's currency. Enforced by a deferred
constraint trigger evaluated at commit, so a multi-statement posting is judged on its result rather
than on its intermediate states.

### I-5 Published academic results are protected

After `PUBLISHED`, a mark changes only through an amendment record capturing `oldValue`, `newValue`,
`reason`, `changedBy`, `approvedBy`, `occurredAt`. A report card that was issued must remain
explicable.

### I-6 Statutory and pricing rules are effective-dated

Tax rates, PAYE bands, pension rates, fee structures, salary structures and account mappings carry
`effectiveFrom` / `effectiveTo`. Historical documents resolve the rule that was in force at the
time, never today's rule. Reprinting last year's payslip must reproduce last year's payslip.

### I-7 Timestamps are UTC

`timestamptz` in PostgreSQL, `DateTime` in Prisma, rendered in the school's timezone at the edge.
Calendar-only values — date of birth, school day, due date — use `@db.Date` and are read with the
UTC getters. `getDate()` on a `date` column returns the previous day west of Greenwich, which is
how a term that starts on the 8th comes to be displayed as starting on the 7th.

### I-8 No silent failure

A failed payroll posting, SMS dispatch, payment verification or result publication is recorded as
failed and surfaced. Never swallowed to keep a screen looking successful. A button that does
nothing and says nothing is worse than an error message.

---

## 3. Request lifecycle

### A page

```
requireActiveSession()              redirect to /sign-in or /choose-school
  ↓
session.permissions.has(CODE)       render a refusal, not a stack trace
  ↓
data.ts → forTenant(tenantId)       the filter is injected here
  ↓
Server Component renders            allowedTransitions() decides which buttons appear
```

Rendering a button is never authorization. The action re-checks, every time, regardless of what
the browser was shown or what it sends back.

### An action

```
'use server'
  ↓
Zod parse                           the browser is not trusted, including its dates
  ↓
requirePermission(CODE)             throws PermissionDeniedError
  ↓
db.$transaction:
    re-read the record              state is tested against the database, not the form
    canTransition(from, to)         the state machine, not a scattering of booleans
    write
    recordAudit(tx, …)              same transaction — they commit or roll back together
  ↓
revalidatePath()
```

The audit entry is written inside the transaction deliberately. Writing it afterwards would allow a
log that says a year was closed when it was not, and an audit trail that can disagree with its own
data is not evidence of anything.

---

## 4. Tenant resolution

The tenant of a request is the tenant of the **verified membership** on the session, and nothing
else.

1. Sign-in establishes *who* — a user, no school.
2. Choosing a school sets `activeMembershipId` on the token, and the server re-checks that the
   membership belongs to that user before it does.
3. `requireActiveSession()` returns `tenantId` from that membership, plus a client scoped to it.

A subdomain is a routing hint for the UI. It is never the authorization decision. A person with
memberships at three schools has three separate identities with three separate permission sets, and
switching between them is a server-verified step, not a dropdown that changes a header.

---

## 5. Database conventions

| Convention | Why |
| --- | --- |
| UUIDv7 primary keys | Time-ordered, so index inserts stay at the right edge; non-sequential in public, so one school cannot enumerate another's records by counting |
| Human references are a separate column | `STU-2026-000123` is allocated by a concurrency-safe counter. A primary key that people read is a primary key that people demand to change |
| `@db.Date` for calendar values | A school day is a date, not an instant |
| Enums for lifecycle | `PLANNED`/`ACTIVE`/`CLOSED` as separate booleans admits "closed and active at once", and then every read site has to decide what that means |
| Constraints in SQL | Ordering, non-overlap, "at most one current", "a closed period records who closed it". See `prisma/migrations/20260919091000_*` |

Constraints the Prisma schema language cannot express live in raw-SQL migrations rather than being
demoted to application checks. The application checks them too — it can say "those dates overlap
the 2026/2027 year" and a constraint violation cannot — but the application is not what guarantees
them.

---

## 6. Frontend structure

```
src/
  app/
    (auth)/          sign-in, choose-school — no tenant yet
    (school)/        everything scoped to one school; force-dynamic
    api/auth/        NextAuth
  components/        the small set of presentational primitives
  features/
    <feature>/
      data.ts        reads
      actions.ts     writes
      schema.ts      Zod input validation
      components/    the client components, kept as few as possible
  lib/               pure business rules
  server/            db, tenant scope, auth, audit
```

Every route in `(school)` is `force-dynamic`. Stated once in the layout rather than left to each
page to remember — and forgetting would mean one school's page cached and served to another, which
is precisely what the tenancy model exists to prevent.

Client components are the exception, not the default. The forms work before JavaScript has loaded
and keep working if it never does, which is not a theoretical concern for a product used on
inexpensive phones over intermittent mobile data.

---

## 7. What this architecture deliberately does not do

- **No AI, ML or LLM.** Every figure traces to a SQL query over real rows. A grade and a finance
  report must be explainable and reproducible.
- **No self-service registration.** Accounts are issued by invitation. Anyone with an email address
  being able to create an identity inside a product holding children's records is not a feature.
- **No microservices.** One database, one process. The coordination cost of splitting is paid up
  front and the benefit is speculative at this size.
- **No soft-delete by default.** Records that must survive have explicit lifecycle states with
  meaning. A global `deleted_at` is a filter everybody forgets, which is the same failure class as
  a forgotten tenant filter.
- **No ORM-generated schema drift.** `prisma db push` is for scratch databases. Anything that
  reaches an environment goes through a migration file that is reviewed and never edited after.
