# 0010. One Next.js application on Vercel, with Prisma and Neon PostgreSQL

> **What this is for:** it records why the separate Java service was retired, what replaced it, and
> which properties of the old design had to be rebuilt rather than abandoned. Read it before
> proposing a second runtime, a separate API service, or an ORM change.

## Status

Accepted — 2026-09-19. Supersedes [ADR 0002](0002-java-spring-boot-core-api.md) (Java and Spring
Boot for core-api) and [ADR 0008](0008-monorepo-tooling.md) (npm workspaces and Maven).

**Partly superseded by [ADR 0011](0011-supabase-as-the-postgresql-host.md) — 2026-09-19.** The
choice of Neon as the PostgreSQL host, including the alternative-considered paragraph below that
rejects Supabase, no longer describes the system: the database is hosted on Supabase. Everything
else here stands — one Next.js application on Vercel, Prisma, NextAuth, a single package at the
repository root — and so does the account of what the move from Java and Firebase cost.

[ADR 0001](0001-postgresql-as-system-of-record.md) still stands: PostgreSQL remains the system of
record. Only the thing in front of it has changed.

## Context

The system was built as two deployable units: a Next.js web tier and a Java 25 / Spring Boot API,
with Firebase Authentication in front and Flyway migrations behind. It worked. The tenant isolation
tests passed against real PostgreSQL with row-level security and a non-superuser role, which is a
stronger proof than most products have.

It could not be deployed.

Not "was difficult to deploy" — the web tier went to Vercel in one command, and then had nothing to
talk to. The API needed a container registry, a second host with its own account, environment and
billing, a managed PostgreSQL with connection details shared between two platforms, and a Firebase
project with a service account key that had to reach the API without being committed. Each of those
is tractable. Together they are four deployment surfaces, four sets of credentials, and four places
for a school's data to be exposed by a misconfiguration — maintained by one person.

The decisive point is not effort. It is that a system which cannot be deployed has no users, and a
design whose security properties are excellent and whose availability is nil protects nobody.

## Decision

**One Next.js application, deployed to Vercel, talking to Neon PostgreSQL through Prisma.**

- **Next.js 16, App Router.** Server Components read; Server Actions write. There is no HTTP API
  between the page and the database, because there is nothing on the other side of it — the same
  process renders the page and performs the write.
- **Prisma 6 against PostgreSQL on Neon.** `DATABASE_URL` is Neon's pooled endpoint for the
  application; `DIRECT_URL` is the direct one, because migrations cannot run through a transaction
  pooler. Prisma Migrate replaces Flyway. The migration files are plain SQL and a raw-SQL migration
  carries the constraints Prisma's schema language cannot express.
- **NextAuth with a credentials provider and bcrypt.** Firebase Authentication is gone.
- **Single package at the repository root.** No workspaces, no Maven, one `npm ci`, one build.

## What had to be rebuilt rather than dropped

Retiring the Java service meant retiring the mechanisms it carried. Each of these was re-created;
none was quietly written off.

| Property | Was | Is now |
| --- | --- | --- |
| Tenant scoping | Hand-written `where tenant_id = ?` plus RLS | A Prisma client extension that injects the filter into every query and create, so it cannot be forgotten (`src/server/tenant-scope.ts`) |
| Isolation proof | `TenantIsolationIT` against embedded PostgreSQL as a non-superuser | `tests/db/tenant-isolation.test.ts` against real PostgreSQL in CI |
| Authorization | `@RequiresPermission` aspect | `requirePermission(code)` in every Server Action |
| Permission catalogue | Java constants, generated into SQL | `prisma/seed-data.ts` — 142 permissions, 26 roles, 360 grants |
| Audit trail | Written in the service transaction | Written in the same Prisma transaction as the change (`src/server/audit.ts`) |
| Calendar invariants | Flyway SQL constraints | `prisma/migrations/20260919091000_calendar_and_role_constraints` |
| Architecture rules | ArchUnit | ESLint, TypeScript strictness, and the coverage test in `src/server/tenantScopeCoverage.test.ts` |

## Consequences

**What improved.** One deployment, one set of environment variables, one place a secret can leak
from. A schema change is `npm run db:migrate` rather than a Flyway file plus a JPA entity plus a
DTO plus a TypeScript type plus a Zod schema. Preview deployments now exercise the whole product
rather than a shell with no data behind it.

**What got worse, honestly.**

- **Row-level security is not in place yet.** The Java service connected as a non-superuser with RLS
  policies enforcing the tenant filter inside the database, below anything application code could
  reach. The Prisma extension is a weaker control: it is structural rather than remembered, which
  beats hand-written filters, but it lives in the application and a raw `$queryRaw` bypasses it.
  RLS is recorded as the top hardening item in `IMPLEMENTATION_STATUS.md`. This is a real
  regression and it is not being presented as anything else.
- **ArchUnit had teeth that lint does not.** "No module outside `finance` may import
  `BigDecimal`-typed money" is not expressible in ESLint. Some invariants are now guarded by review
  and by the tests named above rather than by a rule.
- **Password handling is ours now.** Firebase ran the credential store, the rate limiting and the
  breach checks. bcrypt with a work factor of 12, a constant-time failure path and
  `sessionsValidFrom` for revocation replace it — but sign-in throttling and breached-password
  rejection are ours to build, and they are tracked as gaps rather than assumed.
- **Vercel's serverless model shapes the code.** Long-running work — a payroll run, a report-card
  batch — cannot simply block a request. That is a real constraint on modules not yet built, and
  the answer is a queue rather than a longer timeout.

**What did not change.** Money stays `Decimal(19,4)` with an explicit currency and never a float.
Posted journals stay immutable. Timestamps stay UTC. Statutory rules stay effective-dated. A
tenant-isolation defect stays release-blocking. Those are properties of the product, not of the
framework, and nothing above touches them.

## Alternatives considered

**Keep the Java service and deploy it to Cloud Run or Fly.io.** Entirely workable, and it preserves
RLS. Rejected because it keeps the second deployment surface and the split credential set, which is
the specific thing that stopped this product reaching anybody.

**Keep the split, move the API into Next.js route handlers.** The worst of both: the ceremony of an
HTTP boundary with none of the isolation a separate process buys, and every call paying
serialisation to talk to itself.

**Drizzle rather than Prisma.** Closer to SQL and lighter at runtime. Prisma was chosen for the
client extension mechanism, which is what makes tenant scoping structural rather than a convention;
reproducing that in Drizzle means wrapping every query builder by hand, which is the failure mode
being designed out.

**Supabase rather than Neon.** *(Reversed the next day — see [ADR 0011](0011-supabase-as-the-postgresql-host.md). The paragraph is left exactly as written, because the cost it names was real and was simply accepted.)* Supabase would bring RLS back with its own auth integration, which is
genuinely attractive. Rejected for now because it reintroduces a second platform with its own
credentials and its own dashboard, and because Neon is already the proven path for this deployment.
Revisit if RLS is not delivered by application-level means to a satisfactory standard.
