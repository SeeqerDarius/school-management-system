# Sankofa School Platform

A multi-tenant School Management System and School ERP — student information, academics,
admissions, attendance, fees, double-entry accounting, HR and payroll, for Ghanaian schools and
architected so that Ghana is the first optimized configuration rather than the only supported one.

> **Current state:** foundation. Tenancy, identity, authorization and sign-in are built and tested;
> the business modules are not. [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) is the honest
> record of exactly what exists — read it before assuming a feature is present.

---

## What is deliberately absent

**No AI, ML or LLM anywhere.** Every figure on every dashboard traces to a SQL query over real
rows. There is no inference, no recommendation engine, no generated text. A school's finance
report and a child's grade are things that must be explainable and reproducible, and that rules
out anything probabilistic by design, not by omission.

---

## Architecture at a glance

| Layer | Technology | Why |
|---|---|---|
| Web | Next.js (App Router), TypeScript strict | Server components by default; the BFF holds the session cookie |
| Core API | Java 25 LTS, Spring Boot 3.5, Spring Data JDBC | Auditable business logic, `BigDecimal` money, explicit SQL |
| System of record | PostgreSQL 16+ with Row Level Security | Relational integrity for ledgers, grades and payroll |
| Identity | Firebase Authentication | MFA, recovery, revocation — we never store passwords |
| Files | Firebase Storage, private bucket | Signed URLs only |
| Realtime | Firestore | E2EE chat envelopes and presence only; never a business entity |

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The eight load-bearing invariants
live there; the rules for changing code live in [AGENTS.md](AGENTS.md).

### The one thing worth understanding first

Tenant isolation is enforced **twice** — by PostgreSQL Row Level Security keyed on a session
variable, and by explicit tenant predicates in every repository. Neither is allowed to be the only
control, because the failure being guarded against is a single forgotten `WHERE`.

`platform.current_tenant_id()` **raises** when no tenant is bound, so a query that escapes scoping
fails loudly rather than quietly returning every school's rows. Tests connect as a non-superuser
role, because a superuser bypasses RLS unconditionally and would make every isolation assertion
pass whether or not a policy existed.

---

## Getting started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| JDK | 25 LTS | `java -version` |
| Node | 24+ | For the web app and the code-generation scripts |
| PostgreSQL | 16+ | Not needed for tests — they start their own |
| Docker | — | **Not required.** Integration tests use an embedded PostgreSQL |

### Backend

```bash
cd services/core-api
./mvnw verify
```

That compiles, runs unit tests, starts a real PostgreSQL, applies every migration, and runs the
integration suite including the cross-tenant isolation tests. It needs no database of your own and
no Docker daemon.

To run the service you do need a database:

```bash
cp .env.example .env          # then fill it in — every value in the template is a dummy
psql "$SUPERUSER_URL" -f database/bootstrap/00_roles.sql
cd services/core-api && ./mvnw spring-boot:run
```

`00_roles.sql` creates the two database roles. **This split is not optional**: the application
connects as a role that RLS applies to, and migrations run as a role that bypasses it. Pointing
both at the same role either breaks migrations or silently disables tenant isolation — and the
second failure looks like nothing at all.

### Regenerating the RBAC seed

`V0003__permission_catalogue.sql` is generated from the Java permission constants so the two
cannot disagree. Never hand-edit it:

```bash
node scripts/generate-rbac-seed.mjs
```

CI fails if the checked-in file differs from what the generator produces.

---

## Repository layout

```
apps/web/              Next.js application
services/core-api/     Spring Boot modular monolith
packages/              shared TypeScript: ui, types, validation, api-client
database/bootstrap/    cluster-level role setup (run once per environment)
docs/                  architecture, threat model, privacy, testing, ADRs
scripts/               code generation and operational scripts
```

Backend modules are packages under `io.sankofa.school`, with boundaries enforced in CI by
ArchUnit. A domain module never reaches into another's repositories; cross-module reads go through
a published facade, and cross-module writes go through the transactional outbox.

---

## Documentation

| Document | What it answers |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is shaped, and the invariants that cannot be broken |
| [AGENTS.md](AGENTS.md) | What you may and may not do when changing this code |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | What is actually built, and the known gaps |
| [THREAT_MODEL.md](docs/THREAT_MODEL.md) | STRIDE analysis, including child-specific threats |
| [DATA_PRIVACY.md](docs/DATA_PRIVACY.md) | Lawful basis per purpose, role-by-field visibility, retention |
| [TESTING.md](docs/TESTING.md) | The seven mandatory test categories and how to write them |
| [INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) | What to do when something is wrong in production |
| [docs/adr/](docs/adr/) | Why each significant decision was made, and what it cost |

---

## Contributing

Read [AGENTS.md](AGENTS.md) first. In particular:

- A tenant-isolation defect is **release-blocking**.
- Money is `numeric(19,4)` and `BigDecimal`. Never a float.
- A posted accounting journal is immutable; correct by reversal.
- Never delete or disable a test to make CI pass.
- Never edit a migration that has already been applied — add a new one.

A feature is not done when its screens exist. The sixteen-point Definition of Done is in
`AGENTS.md`, and `IMPLEMENTATION_STATUS.md` is expected to tell the truth about where each module
actually sits against it.

---

## Licence

Not yet determined. Treat as all rights reserved until a licence is added.
