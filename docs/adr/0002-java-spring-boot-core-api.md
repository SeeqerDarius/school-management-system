# 0002. Java 21 and Spring Boot for core-api, with Spring Data JDBC rather than JPA

> **What this is for:** it records why the business core is Java rather than an extension of the
> Next.js app, and why persistence is Spring Data JDBC rather than Hibernate. Read it before adding a
> dependency, a repository, or an argument for moving logic into the web tier.

## Status

Superseded by [ADR 0010](0010-nextjs-fullstack-on-vercel.md) — 2026-09-19.
Accepted 2026-09-18.

The separate Java service was built and then retired. What changed was not the argument —
most of it still holds — but the constraint it was weighed against: this product has to deploy
to Vercel in one step, and a second runtime with its own host, its own image and its own
deployment path made that impossible. See ADR 0010.

The reasoning below is kept as written. It is the record of what was decided and why, not a
description of the system as it stands; ADR 0010 says what replaced it.

## Context

The frontend is Next.js and TypeScript. The obvious, cheap answer is to put the backend there too:
one language, one build, one mental model, shared types across the wire for free, and any engineer
can move end to end in a morning. That is a genuine benefit and it is the main thing this decision
gives up.

It loses anyway, because of what this backend actually does. It is not a CRUD API in front of a few
tables. It computes payroll with effective-dated statutory bands, posts balanced double-entry
journals, allocates a partial payment across invoice lines with a documented rounding rule, resolves
a grading scheme's weights to a published mark, and depreciates an asset over years. Those are
numeric, long-lived and adversarially reviewed. A payslip produced in 2026 must be explainable in
2031 by someone who has never met the person who wrote it, possibly to a labour inspector.

Three forces dominate.

**Money must be exact, in the standard library, and hard to get wrong.** Invariant I-2 requires
`numeric(19,4)` and `BigDecimal`, and AGENTS.md requires an explicit `RoundingMode` at every division.
JavaScript has no decimal type in any runtime we can deploy on today, so exactness would come from a
library (`decimal.js`, `dinero.js`) that a developer can forget to use. `parseFloat` on an amount is
one autocomplete away and looks fine in review. In Java, `BigDecimal` is the ordinary way to hold a
number that matters, `double` sticks out, and `divide` without a `RoundingMode` throws at runtime
rather than quietly truncating. The language makes the correct thing the default thing.

**Transactions are the unit of work, not an afterthought.** An enrolment writes a student, an
invoice, invoice lines, an outbox row and an audit row, and either all of it happens or none of it
does. We need a real transaction manager with declarative boundaries, working propagation,
savepoints, and deferred constraint triggers that fire at commit (Invariant I-4). Node has
transactions; the ecosystem's default idiom is not transaction-first, and the gap shows up in the
code that gets written under deadline.

**Every tenant-owned query must carry its tenant predicate explicitly** — visibly, at the call site,
even though RLS would also catch it (Invariant I-1, AGENTS.md §5). That requirement constrains the
persistence layer more than it constrains the language, and it is why the second half of this
decision exists.

Java 21 is the LTS with the features that make this bearable: `record` for DTOs and value objects,
sealed interfaces and pattern-matching `switch` for state machines that the compiler checks for
exhaustiveness, and virtual threads for the IO-bound work (outbox dispatch, SMS and email provider
calls) without an async-coloured codebase. The support horizon matters too: schools run this software
for a decade, and an LTS we can stay on for years is worth more than a faster-moving runtime.

Spring Boot 3.5.16 is pinned as the parent POM and its BOM is the single source of truth for every
dependency it manages. We do not override managed versions: the BOM is tested as a set, and a
one-off Flyway or Jackson bump to fix something is how a build starts failing for reasons nobody can
reconstruct at 2am.

## Decision

**Build `services/core-api` on Java 21 LTS and Spring Boot 3.5.x**, as a modular monolith
(`docs/ARCHITECTURE.md` §3), with constructor injection only, `@Transactional` at the
application-service layer, `record` DTOs carrying Bean Validation, and domain services free of
framework types.

**Use Spring Data JDBC for persistence. Do not add JPA, Hibernate, or any ORM with lazy loading or
automatic dirty checking.**

That second sentence is the load-bearing one, for four reasons:

| Hibernate behaviour | Why it is wrong here |
|---|---|
| **Lazy loading** issues SQL at arbitrary later points, often outside the repository you reviewed | The query that runs is not the query you wrote. A lazily-traversed association reaches a tenant-owned row without passing the repository method that carries the tenant predicate. RLS still refuses it — but I-1 requires *both* controls, and the app-layer one must be visible to a reviewer |
| **Automatic dirty checking** emits `UPDATE` for any managed entity mutated in memory | On a `POSTED` journal that is an accidental Invariant I-3 violation with no `save()` call in the diff to notice in review. With Spring Data JDBC, a write requires an explicit `save()` |
| **First-level cache** can satisfy a read without touching the database | A read that never reaches PostgreSQL never evaluates an RLS policy, which makes isolation tests quietly weaker than they look |
| **Implicit query generation** from an entity graph | Query shape becomes an emergent property of mapping annotations. We want the query shape to be a decision someone made |

Hibernate has answers — `@Filter`, `FetchType.EAGER`, `@Immutable`, stateless sessions. Each is
opt-in, each is skippable (`@Filter` does not apply to `find`-by-id or to native queries), and
security that depends on remembering an annotation is not a control. Spring Data JDBC removes the
failure mode instead of configuring around it.

What we get in exchange is a persistence layer with the properties this domain needs:

- **Explicit aggregates with real boundaries.** An `Invoice` and its lines load and save as one unit
  in one predictable set of statements. An invoice's student is an id reference, not a traversable
  object — crossing that boundary means calling the owning module's published facade, which is the
  same rule ArchUnit enforces at the package level.
- **Visible SQL.** Non-trivial reads are `@Query` with the predicate written out. A reviewer asking
  "does this carry `tenant_id`?" reads the answer instead of inferring it.
- **No schema management from the mapping.** Flyway owns the schema (AGENTS.md §8), and there is no
  entity model that could plausibly disagree with it.
- **Predictable behaviour under the RLS contract.** Every statement goes to PostgreSQL inside the
  transaction that carries `SET LOCAL app.tenant_id`, so RLS evaluates on every read, including in
  tests.

Optimistic locking stays: the `version` column is on every table and maintained by
`platform.touch_row()` (V0001), and Spring Data JDBC compares it on write.

## Consequences

### Positive

- Money arithmetic is `BigDecimal` end to end with the rounding mode forced into view, and a
  `double` in a financial path is a visible anomaly rather than a plausible line of code.
- Business rules are type-checked. A sealed state machine with pattern-matching `switch` fails to
  compile when a new state is added and a transition is unhandled — the compiler finds the case that
  a test suite might not.
- Transaction boundaries are declarative and reviewable in one place: the application service.
- Every SQL statement is attributable to code someone wrote, which makes a slow query at 2am a
  grep, not an archaeology exercise through mapping annotations.
- The Boot ecosystem brings Flyway, Actuator, Micrometer, Security and the Firebase Admin SDK without
  bespoke glue, and the BOM keeps their versions coherent.

### Negative

- **Two languages in one repository.** Two build tools (Maven and npm workspaces), two CI paths, two
  linting stories, two sets of conventions in AGENTS.md §5. A frontend engineer cannot casually fix a
  backend bug, and the "just add a field" change now spans a migration, a Java DTO, an OpenAPI
  contract and a TypeScript type.
- **We lose free end-to-end types.** Recovered partly by generating the client from the OpenAPI
  contract and validating with Zod at the boundary — but that is a build step and a discipline, not
  a compiler guarantee.
- **More ceremony.** A simple CRUD screen costs a migration, a record DTO, an aggregate, a repository,
  an application service and a controller. In a Node backend it is a route and a query. That tax is
  paid on every trivial feature to buy safety on the non-trivial ones.
- **JVM cold start on a scale-to-zero runtime.** A container that has been idle pays seconds on the
  first request, which a parent on a phone experiences as a broken app. Mitigations exist (CDS
  archives, AOT processing, a warm minimum instance). **Status: planned** — we have not measured
  startup on the target runtime yet, and the mitigation choice should follow the measurement.
- **Spring Data JDBC gives less than an ORM.** No lazy loading means writing the join or the second
  query yourself. Value-object mapping (money as amount plus currency) needs explicit converters.
  Cross-aggregate reads are deliberately awkward, which is the point, but it is still friction.

### Risks accepted

- **Boilerplate erodes under deadline.** Someone writes a wide repository method that quietly serves
  three modules, and the aggregate boundary rots. Counter-pressure is `ModuleBoundaryTest` (ArchUnit)
  plus review. **Status: planned** — the ArchUnit suite is specified in `docs/ARCHITECTURE.md` §3 but
  not yet implemented; today only `CoreApiApplication` exists in Java.
- **Explicit tenant predicates depend on people writing them.** RLS is the reason this is a defect
  rather than a breach, and the isolation tests required by AGENTS.md §7 are the reason we find out.
  **Status: planned** — no repository or isolation test exists yet.
- **We have chosen a stack with a smaller pool of engineers who also know Next.js well.** Java is
  common in Ghanaian banking and telco, so hiring for the backend is not the hard part; finding
  people comfortable on both sides of the repo is.
- **A future contributor will propose adding JPA** to make one screen easier. This ADR is the answer,
  and superseding it requires a new ADR that explains how the four behaviours in the table above are
  prevented, not merely configured away.

## Alternatives considered

**Node or TypeScript backend (NestJS with Prisma or Drizzle), sharing types with `apps/web`.** The
strongest alternative, and the one we actually wanted to be right. It lost on money — exactness
depends on remembering a library, and a `number` that holds a fee passes review. It also lost on
tenant scoping: Prisma's answer is client middleware or extensions that inject a `where` clause,
which is the same invisible-predicate problem as a Hibernate filter, in a stack where RLS is harder
to pair with because connection reuse makes `SET LOCAL` fragile.

**Kotlin on the JVM.** Close enough that this was nearly a coin flip: same `BigDecimal`, same Spring,
same transaction semantics, plus null-safety and less ceremony. It lost on ubiquity rather than
merit — a Java codebase is legible to more of the people who will maintain this, and Java 21's
records and pattern matching close much of the expressiveness gap. Reasonable to revisit; nothing in
this ADR would have to change except the language.

**C# and .NET with EF Core.** Best-in-class money story — `decimal` is a native type, not a library.
It lost on ecosystem fit (the Firebase Admin SDK is a first-class citizen on the JVM and an
afterthought elsewhere in our stack) and because EF Core's change tracking reproduces exactly the
dirty-checking and lazy-loading hazards this ADR rejects.

**Go.** Excellent operational profile, fast startup, no cold-start problem. It lost on decimal
arithmetic being a third-party concern (`shopspring/decimal`) and on how much framework — validation,
transaction management, migrations, security filters, scheduling — we would hand-roll and then own.

**Python with Django.** Django's admin is genuinely tempting for an ERP with this many CRUD surfaces,
and `Decimal` is fine. It lost on static typing over a decade-long numeric codebase, and because the
admin's convenience is exactly the kind of blanket table access that Invariant I-1 and AGENTS.md §1
forbid.

**JPA/Hibernate inside the Java choice.** The default in most Spring shops, with the largest pool of
familiar engineers, and it would make a few screens meaningfully faster to write. Rejected for the
four behaviours tabulated above. The deciding one is dirty checking against Invariant I-3: a
persistence layer that can emit an `UPDATE` to a posted journal without a write appearing in the diff
is disqualifying in an accounting system.

**jOOQ instead of Spring Data JDBC.** Better SQL ergonomics, type-safe query construction, and it
would satisfy the "predicate is visible" requirement just as well. It lost narrowly: code generation
needs a live schema during the build, which means running Flyway in CI before compiling, and the
incremental gain over Spring Data JDBC is much smaller than the gain we already took by leaving
Hibernate. Worth revisiting specifically for the `reporting` and `analytics` modules, whose queries
are complex, read-only and awkward as aggregates.
