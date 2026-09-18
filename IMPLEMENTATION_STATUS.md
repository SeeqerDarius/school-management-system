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
rather than broadly**: tenancy, identity, authorization and the verification harness that the rest
of the system depends on being correct.

**What is genuinely proven right now:**

- Cross-tenant isolation is enforced by PostgreSQL RLS *and* application scoping, and this is
  verified by 10 passing integration tests against real PostgreSQL, running as a non-superuser
  role so the policies are actually exercised.
- An unscoped query fails closed with a database error rather than returning every tenant's rows.
- The backend compiles clean on JDK 21 / Spring Boot 3.5.16 and all 4 migrations apply.

**What does not exist yet:** every business module. Students, admissions, attendance, timetabling,
assessment, grading, fees, accounting, HR, payroll, library, inventory, procurement, assets,
communications, E2EE messaging, the web application, and CI. These are listed below as
`NOT_STARTED`, which is what they are.

---

## Phase 0 — Foundation

| Item | Status | Evidence |
|---|---|---|
| Monorepo structure | `FUNCTIONAL` | Directory tree, npm workspaces not yet initialised |
| Engineering conventions | `DOCUMENTED` | [AGENTS.md](AGENTS.md) — 12 prohibitions, 16-point DoD |
| Architecture definition | `DOCUMENTED` | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — invariants I-1..I-8 |
| Java build | `FUNCTIONAL` | Maven wrapper 3.3.4 / Maven 3.9.16, `mvnw verify` green |
| Flyway migrations | `TESTED` | 4 migrations apply cleanly from empty |
| Embedded test database | `TESTED` | zonky PostgreSQL, non-superuser app role |
| CI pipeline | `NOT_STARTED` | No `.github/workflows` content yet |
| Firebase project | `NOT_STARTED` | No project provisioned, no rules written |
| Vercel deployment | `NOT_STARTED` | — |

## Phase 1 — Identity and tenancy

| Item | Status | Evidence |
|---|---|---|
| Tenant registry schema | `FUNCTIONAL` | `platform.tenant`, RLS-protected |
| RLS substrate | `TESTED` | `platform.current_tenant_id()` raises 42501 when unbound |
| Connection-level tenant binding | `FUNCTIONAL` | `TenantAwareDataSource` — **not yet covered by its own test** |
| Cross-tenant isolation | `TESTED` | `TenantIsolationIT`, 10 tests passing |
| RLS catalogue regression sweep | `TESTED` | Fails any future table with `tenant_id` and no forced policy |
| Permission catalogue | `FUNCTIONAL` | 142 permissions, generated from Java constants |
| System role templates | `FUNCTIONAL` | 26 roles, 360 grants, least-privilege mapped |
| Permission enforcement | `IN_PROGRESS` | `@RequiresPermission` + aspect exist; **no test yet** |
| Session resolution | `IN_PROGRESS` | `SessionResolver` written; **no test, no endpoint** |
| Firebase token verification | `NOT_STARTED` | Dependency present, no code |
| MFA enforcement | `NOT_STARTED` | Schema columns exist only |
| Support access workflow | `IN_PROGRESS` | Schema only; no service, no UI, no audit wiring |
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

1. ~~`Money` has no unit tests.~~ **Resolved** — 32 tests covering exact arithmetic, rounding
   modes, allocation losslessness (including zero-decimal currencies such as JPY) and currency
   mismatch. The `hashCode` implementation was corrected in the process: it had used
   `stripTrailingZeros()`, whose behaviour on zero has varied across JDKs, which would have made
   `Money` unreliable as a `HashMap` key.
2. **`TenantAwareDataSource` is untested.** Isolation is proven at the SQL layer; the Java wrapper
   that binds and *clears* the session on pooled connections is not yet covered. The clearing
   path matters most — a connection returned to the pool still carrying a tenant is the exact
   leak the class exists to prevent.
3. **`SessionResolver` is untested and unreachable.** There is no `POST /api/v1/sessions`
   endpoint, so nothing can authenticate yet.
4. **`PermissionAspect` is untested.** The permission-matrix tests required by AGENTS.md §7 do
   not exist.
5. **No ArchUnit module-boundary test**, although ARCHITECTURE.md §3 claims CI enforces it. The
   claim is currently aspirational and is flagged here rather than left to mislead.
6. **`PermissionCatalogueIT` does not exist**, although V0003's header references it. The
   Java↔SQL agreement is currently guaranteed only by the generator, not verified at test time.
7. **ADRs 0003, 0004, 0005, 0006, 0010, 0011, 0012 are referenced by ARCHITECTURE.md §8 but not
   written.** Likewise `docs/SECURITY.md`, `DISASTER_RECOVERY.md`, `BACKUP_RESTORE.md`,
   `ACCESSIBILITY.md`, `RELEASE_CHECKLIST.md`, `METRICS_CATALOG.md`.
8. **`database/bootstrap/00_roles.sql` is referenced by V0001 but does not exist.** The role
   creation currently lives only in the test harness.
9. **No `.env.example`**, although `application.yml` and AGENTS.md reference it.

---

## Next actions, in priority order

2. `TenantAwareDataSourceIT` — prove bind and clear across a pooled connection handover.
3. `PermissionCatalogueIT` and a permission-matrix test.
4. `database/bootstrap/00_roles.sql` and `.env.example`.
5. CI workflow: compile, test, migration validation, dependency scan.
6. School / campus / academic-year schema, then students and guardians.
7. The missing ADRs and documents listed above.
