# Implementation Status

**Last updated:** 2026-09-18

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
| Migrations | 4, applying cleanly from an empty database |
| Tests | **76 passing** — 52 unit, 24 integration |
| Build | `./mvnw verify` green on JDK 21 / Spring Boot 3.5.16 |
| RBAC | 142 permissions, 26 system roles, 360 grants, cross-validated code ↔ database |
| Architecture rules | 11 ArchUnit rules enforcing module boundaries |
| CI | Secret scan, build+test, generated-file drift, append-only migrations, dependency review, CodeQL |

The isolation guarantee is the part worth trusting: tests connect as a **non-superuser** role,
because a superuser bypasses Row Level Security unconditionally and would make every cross-tenant
assertion pass vacuously. The catalogue sweep in `TenantIsolationIT` fails any future table that
carries `tenant_id` without a forced policy, so the guarantee does not depend on anyone
remembering to extend the test.

### What does not exist

**Every business module.** Students, admissions, attendance, timetabling, assessment, grading,
fees, accounting, HR, payroll, library, inventory, procurement, assets, communications, E2EE
messaging, and the entire web application. There is also **no way to authenticate yet** — there is
no session endpoint, so the system cannot currently be used by a human.

---

## Phase 0 — Foundation

| Item | Status | Evidence |
|---|---|---|
| Monorepo structure | `FUNCTIONAL` | Directory tree; npm workspaces not yet initialised |
| Engineering conventions | `DOCUMENTED` | [AGENTS.md](AGENTS.md) — 12 prohibitions, 16-point DoD |
| Architecture definition | `DOCUMENTED` | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — invariants I-1..I-8 |
| Module boundary enforcement | `TESTED` | `ModuleBoundaryTest`, 11 rules |
| Java build | `FUNCTIONAL` | Maven Wrapper 3.3.4 / Maven 3.9.16 |
| Flyway migrations | `TESTED` | 4 migrations apply from empty on every test run |
| Embedded test database | `TESTED` | zonky PostgreSQL, non-superuser app role asserted |
| Database bootstrap | `FUNCTIONAL` | `database/bootstrap/00_roles.sql`, re-asserts role attributes |
| Environment template | `DOCUMENTED` | `.env.example`, dummy values only |
| CI pipeline | `FUNCTIONAL` | `.github/workflows/ci.yml`, `codeql.yml` — **not yet observed green on GitHub** |
| Firebase project | `NOT_STARTED` | No project provisioned, no rules written |
| Vercel deployment | `NOT_STARTED` | — |

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
| Session resolution | `IN_PROGRESS` | `SessionResolver` written; **no test, no endpoint — unreachable** |
| Firebase token verification | `NOT_STARTED` | Dependency present, no code |
| MFA enforcement | `NOT_STARTED` | Schema columns exist only |
| Support access workflow | `IN_PROGRESS` | Schema only; no service, no UI, no audit wiring |
| Outbox dispatch | `IN_PROGRESS` | Schema only; no poller |
| Subscription / entitlements | `NOT_STARTED` | — |
| School / campus / branding | `NOT_STARTED` | — |

## Phase 2 onward — business modules

Every module below is `NOT_STARTED`. No schema, no service, no endpoint, no screen.

Academics · Students · Guardians · Admissions · Enrolment & promotion · Attendance ·
Timetable · Assessments · Grading & ranking · Report cards · Transcripts · Fees ·
Invoicing · Payments · Receipts · Refunds · Accounting · Chart of accounts · Journals ·
Fiscal periods · Tax engine · Financial reports · HR · Leave · Payroll · Payslips ·
Library · Inventory · Procurement · Assets · Transport · Hostel · Health · Discipline ·
Counselling · Documents · Notifications · Email · SMS · E2EE messaging · Analytics ·
Audit log · Platform Super Admin · Web application · PWA · All portals

---

## Known gaps in what *is* built

Recorded here rather than left implicit, because an unrecorded gap becomes a surprise.

1. **Nothing can authenticate.** `SessionResolver` exists but there is no
   `POST /api/v1/sessions` endpoint and no Firebase token verification, so no human can sign in.
   This is the single largest blocker to anything being usable.
2. **The outbox has no poller.** `platform.outbox` is written by nothing and drained by nothing,
   so `ARCHITECTURE.md` §6's description of event dispatch is currently aspirational.
3. **CI has never run.** The workflows are written but the first push happened alongside them;
   they are `FUNCTIONAL` on inspection, not verified green.
4. **ADRs 0003, 0004, 0005, 0006, 0010, 0011, 0012 are referenced by `ARCHITECTURE.md` §8 but
   not written.** Likewise `docs/SECURITY.md`, `DISASTER_RECOVERY.md`, `BACKUP_RESTORE.md`,
   `ACCESSIBILITY.md`, `RELEASE_CHECKLIST.md`, `METRICS_CATALOG.md`. The links in
   `ARCHITECTURE.md` are currently dead.
5. **No `README.md`** at the repository root.
6. **JaCoCo's coverage floor is 0.00.** It is wired but enforces nothing until there is enough
   code for a floor to be meaningful.

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

1. `POST /api/v1/sessions` with Firebase ID token verification, plus its tests — without this
   nothing else can be exercised by a human.
2. School / campus / academic-year / term schema and API.
3. One module end to end as the reference pattern every later module copies: schema → repository
   → application service → controller → tests → UI.
4. `apps/web` scaffold with the session cookie BFF.
5. Outbox poller and the notification service skeleton.
6. The missing ADRs and documents listed above, and a `README.md`.
