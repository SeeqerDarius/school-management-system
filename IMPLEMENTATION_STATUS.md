# Implementation status

> **What this is for:** the honest record of what exists, what does not, and what is known to be
> weak. If a feature is not listed as built here, assume it is not built, whatever a document or a
> comment elsewhere implies.
>
> Last reviewed: 2026-09-19, after the stack change recorded in
> [ADR 0010](docs/adr/0010-nextjs-fullstack-on-vercel.md).

---

## The short version

The foundation is built and tested: tenancy, identity, authorization, the academic calendar, and
sign-in. Student, guardian and enrolment schemas plus a first student workflow are in progress and
not yet released. Attendance, fees, accounting, HR and payroll are not built.

One known weakness matters more than the rest and is at the top of the list below.

---

## Built

| Area | What exists | Where |
| --- | --- | --- |
| Tenancy | Prisma client extension injecting `tenantId` into every query and create; throws on unhandled operations; four scoping categories including shared reference data | `src/server/tenant-scope.ts` |
| Identity | NextAuth credentials provider, bcrypt (cost 12), constant-time failure path, no account enumeration, session revocation via `sessionsValidFrom` | `src/server/auth/options.ts` |
| Authorization | 142 permissions, 26 system roles, 360 grants with segregation of duties; roles + direct grants, DENY applied last | `prisma/seed-data.ts`, `src/server/auth/permissions.ts` |
| Sessions | Sign-in, school selection with server-side membership verification, sign-out | `src/app/(auth)/**`, `src/server/auth/session.ts` |
| Academic calendar | Years and terms, PLANNED → ACTIVE → CLOSED, non-overlap, "current" selection, close-with-reason | `src/features/calendar/**` |
| Audit trail | Append-only, written in the same transaction as the change it describes | `src/server/audit.ts` |
| Database invariants | Ordering, non-overlap (exclusion constraints), one-current partial unique indexes, closure recorded, system role code uniqueness | `prisma/migrations/20260919091000_*` |
| CI | Secret scan, typecheck, lint, unit tests, build, migrations against real PostgreSQL, drift check, idempotent-seed check, tenant isolation suite | `.github/workflows/ci.yml` |
| Data API lockdown | Deny-all RLS on every table plus REVOKE from `anon`/`authenticated`, idempotent and portable to plain PostgreSQL | `prisma/migrations/20260919092000_data_api_lockdown` |

---

## Known weaknesses

### 1. Row-level security does not enforce tenancy — **highest priority** - IN PROGRESS

**Status:** Migration drafted (`20260920000000_rls_tenant_isolation`) but not yet applied or
validated against a disposable PostgreSQL database. Its `sankofa_app` role is created without
login; an operator must provision login and a strong password through the deployment secret
manager before the application can connect as that role.

RLS *is* enabled on every table as of migration `20260919092000_data_api_lockdown`, with no
policies, which closes Supabase's Data API. That is worth having and it is **not** tenant
isolation.

Prisma connects as `postgres`, which carries `BYPASSRLS`. Every policy is skipped for the
application's own connection, so tenant isolation still rests entirely on the client extension in
`src/server/tenant-scope.ts` — which lives in the application, and which a `$queryRaw` bypasses.
The previous Java implementation had real RLS with a non-superuser role and proved it in tests.
That was lost in the stack change and is not being presented as anything else. See ADR 0010.

**Progress:**
- ⏳ Drafted migration with per-tenant RLS policies for all tenant-owned tables
- ⏳ Drafted sankofa_app role without BYPASSRLS or an embedded password
- ⏳ Added withRlsTransaction helper using a bound tenant value for the session variable
- ⏳ Drafted RLS test suite; database execution remains outstanding
- ⏳ Migration needs to be applied (requires local PostgreSQL for development)
- ⏳ DATABASE_URL needs to switch to sankofa_app role
- ⏳ Existing queries need to move into transactions for session variable support

**What remains:**

1. Apply the migration: `npm run db:deploy` (after testing locally)
2. Update DATABASE_URL to use sankofa_app role instead of postgres
3. Set secure password for sankofa_app role in production
4. Convert existing data.ts reads to use transactions where needed
5. Verify RLS enforcement in production environment

The migration is a draft, not ready to apply: validate it on a disposable database, finish the
transaction coverage, then provision the login role from the deployment secret manager. Keep
application-level scoping in `tenant-scope.ts` as defense-in-depth after RLS is enabled.

### 2. No sign-in throttling

`recordSecurityEvent` writes every failure, so the trail exists. Nothing acts on it. Credential
stuffing against parent accounts is currently limited only by Vercel's platform-level rate limits.

*What it takes:* a counter per account and per IP with an escalating lockout, checked before the
bcrypt compare.

### 3. No breached-password check

Firebase did this. Nothing replaced it. A parent can currently set a password that appears in every
credential-stuffing list in circulation.

*What it takes:* the Have I Been Pwned range API — k-anonymity, so no password or full hash leaves
the server — checked at password set time.

### 4. No Content-Security-Policy

`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` are set.
A nonce-based `script-src` is not, so an injected inline script would execute.

### 5. No invitation flow

`AppUser.inviteTokenHash` exists in the schema. Nothing issues, sends or redeems an invitation, so
the only way to create an account today is the seed or a manual insert. Email is unwired entirely.

### 6. No error tracking, no uptime monitoring, no independent backup

Failures reach Vercel's function logs and nowhere else; nobody is paged.

Backups are worse than they were. Neon gave point-in-time history on the free tier; on Supabase,
point-in-time recovery is a paid add-on and the free plan has no scheduled backups at all. Until
that is resolved there is **no recovery path from a destructive migration** beyond whatever the
project's plan provides — which is why `db:reset` and `db:migrate` now refuse any non-local host
(`scripts/guard-local-db.mjs`), and why `docs/DEPLOYMENT.md` no longer promises one.

### 7. CodeQL results are not enforced

`.github/workflows/codeql.yml` carries `continue-on-error: true` on the upload step, because
publishing to the Security tab on a private repository needs GitHub Advanced Security. A genuine
CodeQL failure is currently tolerated. Remove that line the moment code scanning is enabled.

### 8. Four documents still describe the retired stack

`docs/THREAT_MODEL.md`, `docs/TESTING.md`, `docs/DATA_PRIVACY.md` and
`docs/INCIDENT_RESPONSE.md` were written for the Java, Firebase and Flyway architecture. Each now
carries a banner saying which parts still hold and which do not, rather than being half-corrected —
a partly-updated security document is more dangerous than an obviously stale one, because you
cannot tell which half you are reading.

The threat model is the one that matters most: it describes row-level security as in place.

### 9. Architecture rules are weaker than they were

ArchUnit enforced module boundaries and a no-float-for-money rule that ESLint cannot express. Those
invariants are now held by review and by the tests named above.

---

## Not built

The whole product, essentially. Listed so nobody has to guess.

- Students, guardians, enrolment and admissions (in progress: schema, student list, admission and profile views; guardian and enrolment workflows remain incomplete)
- Classes, subjects, timetable
- Attendance
- Assessment, grading, report cards
- Fees, invoicing, payments, receipts
- Double-entry accounting, the ledger, bank reconciliation
- HR, leave, payroll, payslips
- Library, health, counselling, transport, hostel, inventory, procurement
- Messaging and announcements
- Campus and branding management screens (the models exist; the screens do not)
- Platform administration
- Reporting and analytics
- Data export and import
- Anything offline

The permission catalogue already names the permissions these modules will check. A code existing in
`prisma/seed-data.ts` means the authorization model anticipated the feature — not that the feature
exists.

---

## Tests

| Suite | Runs | Proves |
| --- | --- | --- |
| `src/lib/calendarStatus.test.ts` | `npm test` | The state machine, including that CLOSED is terminal; date-range rules |
| `src/lib/permissionCatalogue.test.ts` | `npm test` | Every referenced permission code exists; segregation of duties holds |
| `src/server/tenantScopeCoverage.test.ts` | `npm test` | Every model with a `tenantId` is scoped |
| `tests/db/tenant-isolation.test.ts` | `npm run test:db` | Cross-tenant read, update, delete and write-by-claim all fail, against real PostgreSQL |
| `tests/db/calendar-constraints.test.ts` | `npm run test:db` | The database, not the application, refuses overlapping and backwards periods |
| `tests/db/data-api-lockdown.test.ts` | `npm run test:db` | No table lacks RLS; the Data API roles hold nothing; btree_gist is out of `public` |
| `tests/db/rls-tenant-isolation.test.ts` | `npm run test:db` | Tenant policies deny unscoped reads, isolate School A from B, and reject cross-school student-campus links |
| `tests/db/rls-tenant-isolation.test.ts` | `npm run test:db` | Tenant policies deny unscoped reads, isolate School A from B, and reject cross-school student-campus links |

**Not tested yet:** the sign-in path end to end, the calendar actions against a database, session
revocation, permission resolution with DENY grants. Those need either a database fixture with
seeded users or a browser test, and neither exists.

There is no coverage threshold. A percentage would measure lines executed, not behaviour asserted,
and the number would be met long before the things above were tested.
