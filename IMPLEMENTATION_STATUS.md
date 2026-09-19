# Implementation Status

**Last updated:** 2026-09-19

This file is the honest record of what exists. It is not a plan and not a wish list.

A module is only marked at a level when that level is **demonstrably true** — `TESTED` means
tests exist and pass, not that tests are intended. `COMPLETE` requires all sixteen points of the
Definition of Done in [AGENTS.md](AGENTS.md). Screens existing is not `FUNCTIONAL`.

## Status vocabulary

| Status | Means |
|---|---|
| `NOT_STARTED` | No schema, no code |
| `IN_PROGRESS` | Partially built; not usable end to end |
| `FUNCTIONAL` | Works end to end for its primary path |
| `TESTED` | Unit + integration tests exist and pass, including tenant isolation |
| `SECURITY_REVIEWED` | Reviewed against the module's threat notes; findings resolved |
| `DOCUMENTED` | Module documentation current and accurate |
| `COMPLETE` | All sixteen Definition of Done points hold |

---

## Honest summary

The specification this was built from describes a system of roughly the scope of a commercial
School ERP — a multi-person-year programme. What exists today is **the foundation, built properly
rather than broadly**: tenancy, identity, authorization, and the verification harness the rest of
the system depends on being correct.

### Verified as of this commit

| | |
|---|---|
| Migrations | 10, applying cleanly from an empty database |
| Tests | **199 passing** — 126 unit, 73 integration |
| Backend build | `./mvnw clean verify` green on JDK 25 LTS / Spring Boot 3.5.16 |
| Web build | `typecheck`, `lint` and `next build` all clean on Next 16.3.5 / React 19 |
| RBAC | 142 permissions, 26 system roles, 360 grants, cross-validated code ↔ database |
| Architecture rules | 12 ArchUnit rules enforcing module boundaries and money typing |
| CI | Secret scan, backend build+test, web build, generated-file drift, append-only migrations, dependency review, CodeQL |

One business module exists end to end — the **academic calendar** — and it is deliberately the
reference pattern the rest copy: schema with RLS, domain state machine, repository with explicit
tenant predicates, application service carrying the permission and the audit write, controller,
and a test file covering isolation, the permission matrix, the state machine, the database
constraints and the audit entries.

### A note on the toolchain

The project targets **Java 25 LTS**. It was originally built on 21; an automated upgrade agent
bumped `java.version` to 25 mid-build, and rather than reverting it the combination was verified —
the full suite passes on JDK 25 with Spring Boot 3.5.16. The only observed friction is a Mockito
self-attachment warning, which is advisory and not a failure.

That same agent auto-stashed uncommitted work when it switched branches; twelve files were
recovered from `stash@{0}^3`. Nothing was lost, but it is the reason several commits landed in
larger batches than intended.

The isolation guarantee is the part worth trusting: tests connect as a **non-superuser** role,
because a superuser bypasses Row Level Security unconditionally and would make every cross-tenant
assertion pass vacuously. The catalogue sweep in `TenantIsolationIT` fails any future table that
carries `tenant_id` without a forced policy, so the guarantee does not depend on anyone
remembering to extend the test.

### What does not exist

**Almost every business module.** Students, admissions, attendance, timetabling, assessment,
grading, fees, accounting, HR, payroll, library, inventory, procurement, assets, communications
and E2EE messaging. The web application has exactly one screen.

A human still cannot use this system, but the reason has changed: sign-in is built and tested,
and what is missing is a **Firebase project** for it to verify tokens against.

---

## Phase 0 — Foundation

| Item | Status | Evidence |
|---|---|---|
| Monorepo structure | `FUNCTIONAL` | npm workspaces: `apps/web`, `services/core-api`, `packages/*` |
| Engineering conventions | `DOCUMENTED` | [AGENTS.md](AGENTS.md) — 12 prohibitions, 16-point DoD |
| Architecture definition | `DOCUMENTED` | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — invariants I-1..I-8 |
| Module boundary enforcement | `TESTED` | `ModuleBoundaryTest`, 11 rules |
| Java build | `FUNCTIONAL` | Maven Wrapper 3.3.4 / Maven 3.9.16 |
| Flyway migrations | `TESTED` | 10 migrations apply from empty on every test run |
| Embedded test database | `TESTED` | zonky PostgreSQL, non-superuser app role asserted |
| Database bootstrap | `FUNCTIONAL` | `database/bootstrap/00_roles.sql`, re-asserts role attributes |
| Environment template | `DOCUMENTED` | `.env.example`, dummy values only |
| CI pipeline | `TESTED` | Observed green on GitHub: secret scan, backend, web, generated-file drift |
| Firebase project | `NOT_STARTED` | No project provisioned, no rules written |
| Container image | `FUNCTIONAL` | Dockerfile written; layered extraction and launcher layout verified locally. **Image never built — no Docker available** |
| Deployment documentation | `DOCUMENTED` | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), including a production smoke test |
| Release workflow | `FUNCTIONAL` | `.github/workflows/release.yml` — tag or manual only; publishes to GHCR, deploys nothing |
| Vercel deployment | `NOT_STARTED` | No project linked. Nothing is deployed anywhere |

## Phase 1 — Identity and tenancy

| Item | Status | Evidence |
|---|---|---|
| Tenant registry schema | `FUNCTIONAL` | `platform.tenant`, RLS-protected |
| RLS substrate | `TESTED` | `current_tenant_id()` raises 42501 when unbound |
| Connection-level tenant binding | `TESTED` | `TenantAwareDataSourceIT`, 6 tests incl. pooled-connection clearing |
| Cross-tenant isolation | `TESTED` | `TenantIsolationIT`, 10 tests |
| RLS catalogue regression sweep | `TESTED` | Fails any table with `tenant_id` and no forced policy |
| Permission catalogue | `TESTED` | `PermissionCatalogueIT`, code ↔ database both directions |
| System role templates | `TESTED` | Segregation-of-duties asserted for payroll, journals, teacher, platform admin |
| Permission enforcement | `TESTED` | `PermissionAspectTest`, 9 tests, allow **and** deny for each rule |
| Session establishment | `TESTED` | `SessionApiIT`, 9 tests over real HTTP: sign in, choose school, act, sign out |
| Session resolution | `TESTED` | `SessionResolver` + `identity.resolve_session`; covered by `SessionApiIT` |
| Invitation-only sign-up | `TESTED` | A verified provider account with no invitation is refused, not provisioned |
| Firebase token verification | `FUNCTIONAL` | `FirebaseIdentityTokenVerifier`; **exercised only through a stub — never against a live Firebase project** |
| MFA enforcement | `IN_PROGRESS` | `mfa_required` is checked at sign-in and returns `MFA_REQUIRED`; **no enrolment flow, no test** |
| Support access workflow | `IN_PROGRESS` | Schema only; no service, no UI, no audit wiring |
| Outbox dispatch | `IN_PROGRESS` | Schema only; no poller |
| Sign-in rate limiting | `TESTED` | `RateLimitIT` + `InMemoryRateLimiterTest`; **per-instance only** |
| Subscription / entitlements | `NOT_STARTED` | — |

## Phase 2 — School structure

| Item | Status | Evidence |
|---|---|---|
| Academic year lifecycle | `TESTED` | `AcademicCalendarApiIT` — permissions, isolation, transitions, constraints, audit |
| Term lifecycle | `TESTED` | Same suite; terms cannot outlive their year or overlap each other |
| Calendar state machine | `TESTED` | `CalendarStatusTest` — every legal and illegal transition, exhaustively |
| Audit log | `FUNCTIONAL` | `audit.audit_log`, append-only by trigger *and* by revoked privilege |
| Academic calendar UI | `FUNCTIONAL` | Renders at desktop and phone width, light and dark; **happy path unverified in-browser** |
| Campus and branding UI | `NOT_STARTED` | API exists; no screens yet |
| Campus | `TESTED` | `SchoolSettingsApiIT` — first-campus-is-main, main cannot be closed, isolation, permissions |
| Branding | `TESTED` | Colour constrained to accessible use (§94); logo by storage path, never URL |
| Brand colour accessibility | `TESTED` | `BrandColorTest`, 47 tests incl. a full greyscale sweep of the contrast curve |

## Phase 3 onward — business modules

Every module below is `NOT_STARTED`. No schema, no service, no endpoint, no screen.

Students · Guardians · Admissions · Enrolment & promotion · Attendance · Timetable ·
Subjects & classes · Assessments · Grading & ranking · Report cards · Transcripts · Fees ·
Invoicing · Payments · Receipts · Refunds · Accounting · Chart of accounts · Journals ·
Fiscal periods · Tax engine · Financial reports · HR · Leave · Payroll · Payslips ·
Library · Inventory · Procurement · Assets · Transport · Hostel · Health · Discipline ·
Counselling · Documents · Notifications · Email · SMS · E2EE messaging · Analytics ·
Platform Super Admin · PWA · Every portal except the one calendar screen

---

## Known gaps in what *is* built

Recorded here rather than left implicit, because an unrecorded gap becomes a surprise.

1. **Firebase verification has never run against a real project**, and this now blocks more than
   itself. The sign-in path is tested end to end, but only through `StubIdentityTokenVerifier`;
   signature, audience, issuer and revocation checking are delegated to the Admin SDK and are
   correct by construction, not by observation.

   The knock-on effect is that the **web-to-API seam cannot be exercised in a browser**. The
   calendar UI has been verified rendering its layout, theming, responsive behaviour and error
   state, but never its populated happy path — signing in requires a Firebase ID token that does
   not exist. The API's own happy path is covered by the integration suite, so what is unproven
   is specifically the join between the two tiers. Provisioning a Firebase project is the single
   highest-value next step.
2. **Rate limiting is per-instance and in-memory.** Sign-in is now throttled (§84), but each
   process keeps its own buckets: behind a load balancer with three instances the effective
   limit is three times the policy. It is a real weakening, not a rounding error, and it must be
   replaced with a shared store (Redis, or bucket4j over PostgreSQL) before scaling past one
   instance. It also assumes the API is **unreachable except through the trusted proxy** — expose
   the container directly and a forged `X-Forwarded-For` earns a fresh bucket per fabricated
   address, bypassing the limiter entirely while the dashboard still says one exists.

   Only sign-in, membership switching and public endpoints are covered. §84 also calls for
   limits on exports, messaging, SMS dispatch, payment initiation and file upload; those are
   added as each module lands.
3. **The outbox has no poller.** `platform.outbox` is written by nothing and drained by nothing,
   so `ARCHITECTURE.md` §6's description of event dispatch is currently aspirational.
4. **CodeQL results are not published, and its gate is currently soft.** The analysis runs and
   its findings appear in the job log, but uploading to the Security tab requires code scanning
   to be enabled — which for a private repository means GitHub Advanced Security. The analyze
   step carries `continue-on-error: true` so CI is not permanently red over a billing
   entitlement. **This weakens the gate**: a genuine CodeQL failure is tolerated while that line
   is there. Remove it as soon as code scanning is enabled.
5. **ADRs 0003, 0004, 0005, 0006, 0010, 0011, 0012 are referenced by `ARCHITECTURE.md` §8 but
   not written.** Likewise `docs/SECURITY.md`, `DISASTER_RECOVERY.md`, `BACKUP_RESTORE.md`,
   `ACCESSIBILITY.md`, `RELEASE_CHECKLIST.md`, `METRICS_CATALOG.md`. Those links are dead.
6. **JaCoCo's coverage floor is 0.00.** It is wired but enforces nothing until there is enough
   code for a floor to be meaningful.
7. **`LoginPathProbeIT` is a diagnostic, not a product test.** It was written to find the
   bootstrapping bug below and is kept because it would catch a recurrence, but it asserts
   plumbing rather than behaviour.

### Three real defects found by testing, and what they were

Recorded because each was invisible until something executed it, and each would have reached
production looking fine:

- **A `FOR ALL` policy's `USING` clause is evaluated on `SELECT` too.** Mine called the *raising*
  tenant accessor, so every membership lookup on the sign-in path — which is unscoped by
  definition — threw SQLSTATE 42501 and surfaced as an opaque 500. Fixed in `V0007`.
- **RLS made the security log unwritable exactly when it mattered.** A *refused* sign-in has no
  user and no tenant, which is precisely what the write policy rejected. Fixed in `V0006` with a
  narrow `SECURITY DEFINER` writer, and the application role's direct `INSERT` was revoked so the
  function is the only writer rather than merely the recommended one.
- **`@ConditionalOnProperty` treats an empty value as present.** With `${FIREBASE_PROJECT_ID:}`
  defaulting to an empty string, a developer without Firebase would have failed at boot. Replaced
  with an explicit non-blank condition.

### Resolved since first draft

- ~~`Money` untested~~ → 32 tests; also fixed a `hashCode` defect (`stripTrailingZeros()`
  behaviour on zero has varied across JDKs, which would have made `Money` unreliable as a
  `HashMap` key).
- ~~`TenantAwareDataSource` untested~~ → 6 tests, including the pooled-connection handover that
  proves a returned connection does not carry the previous tenant.
- ~~`PermissionAspect` untested~~ → 9 tests, allow and deny for every rule, including the
  fail-closed case where no context is bound.
- ~~No ArchUnit boundary test~~ → 11 rules. Writing them immediately exposed a real violation:
  `SecurityConfig` sat in `platform.config` while importing `identity`, making the shared kernel
  depend on a domain module. Fixed by moving the wiring to a `config` composition root.
- ~~`PermissionCatalogueIT` missing~~ → 8 tests, including segregation-of-duties assertions.
- ~~`database/bootstrap/00_roles.sql` missing~~ → written, and it re-asserts the role attributes
  on every run rather than trusting that an existing role is still correct.
- ~~No `.env.example`~~ → written.

---

## Next actions, in priority order

**Blocked on you, and blocking the most:**

1. **Provision a Firebase project.** Nobody can sign in without one, so the web tier cannot be
   driven end to end in a browser and the production smoke test cannot be run. Everything below
   is verifiable without it; the seam between the two tiers is not.

**Unblocked:**

2. Screens for campus and branding — the APIs exist and are tested; there are no UI screens.
3. Outbox poller and the notification service skeleton. Until this exists,
   `ARCHITECTURE.md` §6's description of event dispatch is aspirational, and nothing writes to
   `platform.outbox` either.
4. The seven missing ADRs and six missing documents. `ARCHITECTURE.md` §8 links to all of them
   and every link is currently dead.
5. Students and guardians — the first module with genuinely sensitive personal data, and the
   first real test of the role-by-field visibility matrix in `DATA_PRIVACY.md`.
6. Replace the in-memory rate limiter with a shared store, before any multi-instance deployment.
