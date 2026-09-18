# AGENTS.md — rules for anyone (human or agent) writing code in this repository

Read this before your first edit. Read `docs/ARCHITECTURE.md` before your second.

This file is **normative**. Where it conflicts with convenience, convenience loses.

---

## 1. Absolute prohibitions

These are not style preferences. A pull request violating any of them is rejected on sight.

| # | Never | Why |
|---|---|---|
| 1 | **Never bypass authorization for convenience** — no "temporarily allow all", no `permitAll()` added to make a screen work | Authorization holes are the top cause of real breaches in school systems |
| 2 | **Never remove or `@Disabled` a test to make CI pass** | Fix the code or fix the test's premise; deleting evidence is not a fix |
| 3 | **Never disable TypeScript strictness** — no `any`, no `@ts-ignore`, no `strict: false` | Types are the cheapest correctness tool available |
| 4 | **Never weaken Firestore or Storage rules to fix a feature** | Rules are a security boundary, not a configuration knob |
| 5 | **Never expose service credentials** — no service-account JSON in the repo, in `NEXT_PUBLIC_*`, or in a client bundle | One leak compromises every tenant |
| 6 | **Never mutate a posted accounting entry** | Invariant I-3. Correct by reversal |
| 7 | **Never bypass tenant scoping** — no query without a tenant predicate, no `SET app.tenant_id` from user input | Invariant I-1. A cross-tenant leak is release-blocking |
| 8 | **Never use floating point for money** | Invariant I-2 |
| 9 | **Never add AI, ML, LLM or "smart insight" features** | Product rule §1. Everything is deterministic and auditable |
| 10 | **Never ship fake data in a production code path** — no hardcoded `const students = 500` outside seed files | §102 |
| 11 | **Never swallow an exception to keep a screen looking successful** | Invariant I-8 |
| 12 | **Never edit a Flyway migration that has been merged** | Add a new one. Applied history is immutable |

---

## 2. Definition of Done

A feature is **not** done when its screens exist. It is done when all sixteen hold:

1. Schema exists, with a reviewed Flyway migration
2. Backend implementation exists
3. Authorization is enforced server-side with a granular permission
4. Validation exists on the server (client validation is UX only)
5. Frontend exists
6. The UI works at phone width, not just desktop
7. Error states exist
8. Loading states exist
9. Empty states exist, and say something useful (§167)
10. Tests exist — unit plus at least one integration test
11. Tenant isolation is covered by an automated test
12. Audit entries are written where the action is sensitive
13. Documentation is updated
14. Accessibility considered — keyboard, labels, contrast, focus
15. Security reviewed against the module's threat notes
16. Production build succeeds

Update `IMPLEMENTATION_STATUS.md` honestly. `FUNCTIONAL` means it works.
`COMPLETE` means all sixteen above. Do not conflate them.

---

## 3. Commands

```bash
# Frontend (from repo root)
npm install                 # install all workspaces
npm run dev                 # Next.js dev server
npm run lint                # ESLint across workspaces
npm run typecheck           # tsc --noEmit, strict
npm run test                # Vitest unit + component
npm run build               # production build
npm run test:e2e            # Playwright

# Backend (from services/core-api)
./mvnw verify               # compile + unit + integration tests
./mvnw spring-boot:run      # run locally (dev profile, embedded PostgreSQL)
./mvnw test -Dtest=TenantIsolation*   # focused run
./mvnw flyway:validate      # migration validation

# Database
npm run db:migrate          # apply migrations
npm run db:seed             # development seed (refuses non-dev environments)
npm run db:reset            # destroy + recreate (refuses non-dev environments)
```

---

## 4. Architectural boundaries

- `platform` and `tenancy` are shared kernels. Everything may import them; they import no domain.
- A domain module **never** imports another domain module's `repository`, `entity` or `internal`
  package. Cross-module reads use the owner's published `*Facade`. Cross-module *writes* go through
  the outbox.
- ArchUnit enforces this in `ModuleBoundaryTest`. If it fails, the design is wrong — not the test.
- The web tier never contains business rules. If a calculation decides money, a grade or an
  approval, it lives in Java.

---

## 5. Code conventions

### Java

- Constructor injection only. No `@Autowired` on fields.
- `@Transactional` at the application-service layer, never on a controller or repository.
- DTOs are `record` types with Bean Validation annotations. Entities never cross the HTTP boundary.
- `BigDecimal` for money, always with an explicit `RoundingMode` at every division.
- No checked exceptions in domain code; map to typed domain exceptions handled centrally.
- Package-private by default. `public` is a deliberate act that widens a module's contract.
- Every `select` in a tenant-owned repository carries its tenant predicate **explicitly**, even
  though RLS would also catch it. Defence in depth means both, visibly.

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`. No `any`, no non-null `!` on API data.
- Money is a `string` end-to-end; format with the `Money` helpers in `packages/shared`.
  Never `parseFloat` an amount.
- Zod schema at every trust boundary — API responses included.
- Server Components by default; `"use client"` requires a reason a reviewer would accept.
- No `fetch` to the core API from a Client Component. Go through `server/api-client`.

### SQL

- One migration per logical change, named `V{NNNN}__{snake_case}.sql`.
- Every tenant-owned table gets `tenant_id`, the standard audit columns, RLS enabled **and forced**,
  and the `tenant_isolation` policy — in the same migration that creates it.
- Indexes ship with the migration that creates the query, not in a later "performance" pass.
- Destructive migrations carry a comment explaining the mitigation and a rollback note.

---

## 6. Security requirements for every change

Ask these before opening a pull request:

- Can a user of School A reach this data, this file, this export or this identifier?
- Is the permission checked **server-side**, with a granular permission rather than a role string?
- Does this write an audit record? Sensitive actions require one, plus a reason where §188 applies.
- Does any log line, error message or metric now carry a password, token, key, full payment
  detail, medical note or plaintext message?
- Is anything client-supplied trusted — a price, a balance, a grade, a tenant id, an approval flag?
- Does a new upload path validate MIME, size and filename, and stay out of a public bucket?
- Does a new webhook verify its signature, and is it idempotent against replay?

---

## 7. Testing requirements

| Change touches | Minimum required |
|---|---|
| Any tenant-owned table | a cross-tenant isolation test proving School A cannot read/write/export School B |
| Any permission | a permission-matrix test asserting both the allow and the deny |
| Money | a test asserting exact `BigDecimal` values, including rounding and a partial payment |
| A journal | a test asserting debits equal credits, and that a posted journal rejects mutation |
| Grading | deterministic fixture tests for weighting, ties, absent and exempt students |
| A state machine | tests for every legal transition and at least one illegal one |
| A Firestore or Storage rule | an emulator test proving the deny case |

Tests that only assert "no exception thrown" do not count.

---

## 8. Migration requirements

- Never edit a merged migration. Add a new one.
- Test that the migration applies to an empty database **and** to a seeded one.
- `flyway:validate` runs in CI. Checksum drift fails the build.
- Schema changes to a table with RLS must re-state the policy if the tenant column changes.
- Reconcile anything applied out-of-band (a console, an MCP tool, a psql session) back into a
  migration file **immediately** — drift is how staging and production stop matching.

---

## 9. Git

- Conventional commits: `feat(scope):`, `fix(scope):`, `test(scope):`, `docs(scope):`,
  `chore(scope):`, `refactor(scope):`, `perf(scope):`, `build(scope):`, `ci(scope):`.
- Atomic commits. One logical change each. Never knowingly commit a broken `main`.
- Keep `IMPLEMENTATION_STATUS.md` and `CHANGELOG.md` current in the same commit as the change.

---

## 10. When the specification is silent

1. Choose the most conventional professional implementation.
2. Record the decision as an ADR in `docs/adr/`.
3. Keep it configurable if a school, a country or a regulator would plausibly want it different.

Ghana is the first optimized configuration, never the only supported one. Anything Ghana-specific —
class structures, PAYE bands, SSNIT rates, GHS, term shapes — is **data**, not code (§136, §137).
