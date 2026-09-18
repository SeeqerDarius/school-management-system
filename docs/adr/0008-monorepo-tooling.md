# 0008. Monorepo tooling: npm workspaces and Maven

*What this is for: deciding how the JavaScript and Java halves of this repository are built and wired together. Read it before adding a build tool, a package manager, or a task runner.*

## Status

Accepted — 2026-09-18

**Implementation status: partly built.** `services/core-api/pom.xml` exists and is the real
Maven build. The workspace directories (`apps/web`, `packages/api-client`, `packages/config`,
`packages/shared`, `packages/types`, `packages/ui`, `packages/validation`) exist, but the root
`package.json` declaring the `workspaces` array is **planned** and not yet written. `.nvmrc`
pins Node 24.

## Context

This is one repository with two build universes in it:

```
/                        npm workspaces root (planned)
├── apps/web             Next.js App Router — deployed to Vercel
├── packages/shared      money, dates, formatting — used by web and tests
├── packages/types       generated and hand-written API types
├── packages/api-client  typed client over /api/v1
├── packages/validation  Zod schemas shared across trust boundaries
├── packages/ui          component library
├── packages/config      eslint / tsconfig / tailwind presets
├── services/core-api    Java 21 + Spring Boot — Maven, its own world
├── tests/               e2e (Playwright), load, security
├── database/            bootstrap, seeds, documentation
└── infrastructure/      docker, firebase, vercel, security config
```

The two halves barely interact at build time. Java produces a container image; the web app
produces a Vercel deployment. They share an HTTP contract (OpenAPI, from springdoc) and
nothing else — no shared compilation, no shared artifact registry, no cross-language codegen
that runs in both builds.

The team is small. Ghanaian schools are the first market, which means some contributors will
work on laptops with modest hardware and intermittent connectivity. Whatever we choose, a new
contributor has to get from `git clone` to a running dev server without learning a build
system first.

There is a standing temptation in this space: Nx, Turborepo, Bazel, pnpm with a workspace
protocol, Rush, Lerna. Each solves a real problem that a large monorepo has. We do not have
those problems yet, and every one of those tools is a thing that breaks at an inconvenient
moment and that only one person on the team understands.

## Decision

**npm workspaces for everything JavaScript. Maven for everything Java. No third build system
on top of either.**

Concretely:

| Concern | Tool | Notes |
|---|---|---|
| JS dependency resolution and linking | npm workspaces | One lockfile at the root, one `node_modules` |
| JS task running | npm scripts + `--workspaces` | `npm run lint --workspaces --if-present` |
| Java build, test, package | Maven (`./mvnw`) | Spring Boot BOM is the version source of truth |
| Node version | `.nvmrc` (24) | Matched by the Vercel project setting and by CI |
| Cross-language orchestration | none | Two pipelines, two artifacts, one HTTP contract |

Internal packages are referenced by workspace name (`@sankofa/shared`), which npm symlinks
into the root `node_modules`. They are TypeScript source consumed directly by Next.js; they
do not pre-compile to `dist/` unless something outside Next.js needs them, because a build
step per package is exactly the cost we are declining to pay.

The Java build stays a single Maven module for now. `services/core-api` is a modular
monolith (ADR-0002), and its module boundaries are enforced by ArchUnit in
`ModuleBoundaryTest`, not by Maven reactor modules. Splitting the POM buys nothing today and
costs a multi-module build everyone has to reason about.

### Vercel is a real constraint, not an afterthought

Vercel supports npm workspaces natively: point the project at `apps/web` as the root
directory, let it detect the workspace root, and it installs from the root lockfile and
builds the one app. No custom install command, no `--ignore-scripts` incantation, no shim to
make a task runner's cache work inside a build container. Turborepo also works on Vercel —
it is Vercel's own tool — but it works by adding a layer, and the layer is what we are
avoiding.

### When we revisit this

Not on a feeling that the repo is "getting big". On one of these, measured:

- A clean `npm run build` at the root exceeds roughly 10 minutes and the bottleneck is
  rebuilding packages that did not change.
- CI spends more than half its wall-clock time redoing work that a content hash would have
  let it skip.
- We add a second deployable Next.js app and genuinely need a task graph to order builds.
- More than one person independently asks for remote caching because they are waiting on it.

At that point Turborepo is the likely answer: it layers on top of npm workspaces rather than
replacing them, so this decision is additive rather than a migration. Adopting it is a new
ADR with numbers in it.

## Consequences

### Positive

- Onboarding is `nvm use && npm install && npm run dev`. Nothing to explain, nothing to
  install globally, no daemon.
- One lockfile means one dependency resolution to audit. `npm audit` and Dependabot work
  without configuration.
- Vercel's default path works, so deployment configuration stays close to empty and does not
  drift from what the platform actually supports.
- Every tool involved ships with Node or with the JDK. No bootstrap step that can fail behind
  a slow or filtered network connection.
- Debugging a build failure means reading npm output and Maven output, not a task
  orchestrator's interpretation of them.

### Negative

- **No remote caching.** CI rebuilds everything every run. Today that is minutes, not hours.
- **No task graph.** Order is expressed by hand in npm scripts. If package A must build
  before B, a human writes that down and a human can get it wrong.
- **No affected-project detection.** A change to a README runs the same CI as a change to the
  payroll calculator. Partially mitigated with path filters in the workflow.
- **npm workspaces is less sophisticated than pnpm** at deduplication and at preventing
  phantom dependencies — a package can import something it did not declare, because the root
  `node_modules` is flat.
- **Two commands to run everything.** `npm run test` at the root, `./mvnw verify` in
  `services/core-api`. A contributor can forget the second one; CI cannot.

### Risks accepted

- **Phantom dependencies.** Flat hoisting lets an undeclared import work locally and fail in
  a different install order. Mitigated by `depcheck` in CI (planned) and by review; not
  eliminated.
- **Build times grow silently** until someone notices. Mitigated by tracking CI duration as a
  number we look at, so the revisit trigger above is measured rather than argued.
- **A future contributor "fixes" this** by adding Nx in a Friday afternoon PR. This ADR is the
  answer: the choice was deliberate, and changing it requires a new ADR, not a preference.
- **npm workspaces gains a breaking change** across a major Node release. Mitigated by the
  pinned `.nvmrc` and by CI matching it exactly.

## Alternatives considered

**Turborepo.** The strongest alternative and the most likely successor. Remote caching, task
graph, affected detection, first-class Vercel support. Rejected today because our slowest
build is minutes long, the cache is only worth having when you are waiting on it, and every
contributor would need to learn `turbo.json` before their first change. The migration path
stays open precisely because Turborepo sits on top of workspaces.

**Nx.** More capable still — generators, dependency graph visualisation, plugin ecosystem.
Rejected as considerably more machinery than a seven-package repository justifies. Nx
configuration becomes its own maintenance surface, and the failure modes require Nx-specific
knowledge to diagnose at 2am.

**pnpm workspaces.** Better disk usage, strict non-flat `node_modules` that would kill the
phantom-dependency risk above, faster installs. Rejected on a narrower margin than the
others: it requires an extra global install on every developer machine and in every CI image,
Vercel support is good but not the default path, and the strictness that is a benefit also
breaks packages that rely on hoisting. If the phantom-dependency risk turns into a real
incident, this is the first thing to reconsider.

**Bazel.** Genuinely solves polyglot monorepos, including the Java/JS split. Rejected as
wildly disproportionate. The cost is measured in engineer-months of build engineering, and we
would be paying it for a repository with two deployables.

**Separate repositories for web and core-api.** Rejected. The API contract changes on both
sides in the same pull request more often than not, and splitting the repo turns that into
coordinated releases across two change histories — the exact coupling problem, moved somewhere
harder to see.

**Maven multi-module for core-api.** Deferred. Module boundaries are enforced by ArchUnit,
which fails fast in CI without making everyone reason about a reactor. Worth revisiting if a
module ever needs to be published or deployed independently.
