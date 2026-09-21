# Implementation status

> **What this is for:** the honest record of what exists, what does not, and what is known to be
> weak. If a feature is not listed as built here, assume it is not built, whatever a document or a
> comment elsewhere implies.
>
> Last reviewed: 2026-09-21, after row-level security became a real control
> (`20260921030000_tenant_rls_policies`). The stack change itself is recorded in
> [ADR 0010](docs/adr/0010-nextjs-fullstack-on-vercel.md).

---

## The short version

The foundation is built and tested: tenancy, identity, authorization, the academic calendar, and
sign-in. Student, guardian and enrolment schemas plus a first student workflow are in progress and
not yet released. Attendance, fees, accounting, HR and payroll are not built.

The weakness that mattered most — tenant isolation resting entirely on application code — is
closed in the codebase as of `20260921030000_tenant_rls_policies`. It is **not** closed in any
deployment until an operator repoints `DATABASE_URL` at the restricted role — two steps, in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#5-switch-to-the-restricted-database-role).

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
| Sign-in throttling | Escalating lockout per account and per client address, counted from `security_event` and checked before the bcrypt compare; a refusal is logged under its own event type so a lock cannot be held open | `src/server/auth/throttle.ts`, `src/lib/sign-in-throttle.ts` |
| Content-Security-Policy | Per-request nonce with `strict-dynamic`, issued from middleware; `base-uri`, `form-action`, `object-src` and `frame-ancestors` closed | `src/middleware.ts` |
| Tenant isolation in the database | Per-tenant policies on every table carrying `tenantId`, read by a transaction-bound `app.tenant_id`; a `NOBYPASSRLS` role to connect as. Not live until an operator repoints `DATABASE_URL` | `prisma/migrations/20260921030000_tenant_rls_policies`, `src/server/db-context.ts` |

---

## Known weaknesses

### 1. Row-level security enforces tenancy — but only once an operator switches the role

Built in `20260921030000_tenant_rls_policies`, and proved by `tests/db/rls-policies.test.ts`,
which runs **as `sankofa_app`**, the `NOBYPASSRLS` role the application is meant to connect as:

- per-tenant policies on `academic_year`, `term`, `campus`, `branding`, `reference_sequence` and
  `membership`; membership-derived rules for `membership_role` and `membership_permission_grant`;
  read-shared-but-not-writable handling for `role`; scoped-read handling for `audit_log` and
  `security_event`; a read-only catalogue for `permission` and `role_permission`;
- `app.tenant_id`, `app.user_id` and `app.sign_in_email` bound per transaction by
  `src/server/db-context.ts`, so an unbound transaction reads nothing;
- 19 behavioural assertions: cross-tenant read, read-by-known-id, update, delete and
  write-by-claim all refused by the database, and — the control that stops the suite passing
  against a database nobody can use — a school creating and reading back its own rows.

**What is not done, and it is the half that decides whether any of it is live.** The role ships
`NOLOGIN` and without a password, because a password in a migration is a password in git. Until
somebody runs the two steps in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — grant it a password,
repoint `DATABASE_URL` — the deployed application still connects as `postgres`, which carries
`BYPASSRLS`, and every policy above is skipped in that deployment. CI proves the policies work;
CI cannot prove production is using them.

So the honest status is: **the control exists and is tested; enabling it is an operator action
that has not been taken.** Do not read a green pipeline as "production enforces tenancy".

Two smaller things worth knowing:

- `$queryRaw` still bypasses the *application* filter, but no longer the database's. There are
  currently no raw queries in `src/`.
- `app_user` has no INSERT policy, so the application cannot create users. That is correct today
  — there is no invitation flow (weakness 5) — and will need one when there is.

### 2. Throttling covers sign-in and nothing else

Sign-in is throttled: five wrong passwords against one account in fifteen minutes locks it for a
minute, and the ladder climbs steeply from there. It is counted from the security log rather than
a second table, so the limit and the audit trail cannot disagree about what happened, and it is
checked before the bcrypt comparison — verified by signing in with the *correct* password during
a lock and being refused, which is only true if the limiter sits in front.

Three limits worth knowing:

- **It covers the sign-in path only.** §84 also asks for limits on exports, messaging, SMS
  dispatch, payment initiation and file upload. Those arrive with the modules that need them.
- **It trusts the proxy's forwarded address.** `x-vercel-forwarded-for` cannot be set by a
  caller, but the fallback `x-forwarded-for` can — so the application must be unreachable except
  through Vercel. Expose it directly and a forged header earns a fresh allowance per fabricated
  address, which is worse than no limiter because the dashboard still says there is one. Recorded
  as a deployment requirement in `docs/DEPLOYMENT.md`.
- **A determined attacker can still lock one known account out** for a minute at a time by
  failing against it deliberately. That is inherent to account lockout; the mitigation here is
  that a throttled attempt is recorded as `SIGN_IN_THROTTLED` and is *not* counted as a failure,
  so the lock always decays rather than being held open indefinitely by continued knocking.

### 3. No breached-password check

Firebase did this. Nothing replaced it. A parent can currently set a password that appears in every
credential-stuffing list in circulation.

*What it takes:* the Have I Been Pwned range API — k-anonymity, so no password or full hash leaves
the server — checked at password set time.

### 4. The Content-Security-Policy still allows inline styles

`script-src` is nonce-based with `strict-dynamic`, and a browser was used to confirm it: a
parser-inserted `<script>` spliced into the page — inline and by `src` — is refused, while the
application still renders and hydrates with no violations. `base-uri`, `form-action`,
`object-src` and `frame-ancestors` are closed too.

`style-src` keeps `'unsafe-inline'`, because Next injects inline styles during hydration and for
font loading and nonce-ing them is not reliably supported. Injected CSS can restyle a page and
exfiltrate through selectors; it cannot execute. That makes it a smaller hole than the one that
closed, but it is a hole and it is not being described as anything else.

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
| `src/lib/sign-in-throttle.test.ts` | `npm test` | Every rung of the lockout ladder, on both sides of each boundary, and that a lock counts down from the most recent failure |
| `src/middleware.test.ts` | `npm test` | The CSP carries a fresh nonce per response, never allows eval in production, and keeps `base-uri`/`form-action`/`object-src` closed |
| `tests/db/sign-in-throttle.test.ts` | `npm run test:db` | The limiter counts the right rows over the right window; a nonexistent account throttles like a real one; a refusal is not counted as a failure |
| `tests/db/rls-policies.test.ts` | `npm run test:db` | Connecting **as the non-bypassing role**: an unbound transaction reads nothing, a bound one reads only its own school, cross-tenant write-by-claim is refused by PostgreSQL, and a school can still do its own work |

**Not tested yet:** the calendar actions against a database, session revocation, permission
resolution with DENY grants. Those need either a database fixture with
seeded users or a browser test, and neither exists.

There is no coverage threshold. A percentage would measure lines executed, not behaviour asserted,
and the number would be met long before the things above were tested.
