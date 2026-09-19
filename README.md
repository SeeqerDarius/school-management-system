# Sankofa School Platform

A multi-tenant School Management System and School ERP — student information, academics,
admissions, attendance, fees, double-entry accounting, HR and payroll, for Ghanaian schools and
architected so that Ghana is the first optimized configuration rather than the only supported one.

> **Current state:** foundation. Tenancy, identity, authorization, the academic calendar and
> sign-in are built and tested; the business modules are not.
> [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) is the honest record of exactly what
> exists — read it before assuming a feature is present.

---

## What is deliberately absent

**No AI, ML or LLM anywhere.** Every figure on every dashboard traces to a SQL query over real
rows. There is no inference, no recommendation engine, no generated text. A school's finance
report and a child's grade are things that must be explainable and reproducible, and that rules
out anything probabilistic by design, not by omission.

---

## Architecture at a glance

| Layer | Technology | Why |
| --- | --- | --- |
| Application | Next.js 16 (App Router), React 19, TypeScript strict | Server Components read, Server Actions write — no HTTP API between the page and the database |
| System of record | PostgreSQL on [Neon](https://neon.tech) | Relational integrity for ledgers, grades and payroll |
| Data access | Prisma 6, through a tenant-scoped client | The tenant filter is injected, not remembered |
| Identity | NextAuth (credentials) + bcrypt | Invitation-only accounts; no self-service registration |
| Hosting | Vercel | One deployment surface, one set of credentials |

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The decision to collapse an earlier
two-service design into this one — including what got *worse* — is recorded in
[ADR 0010](docs/adr/0010-nextjs-fullstack-on-vercel.md). The rules for changing code live in
[AGENTS.md](AGENTS.md).

### The one thing worth understanding first

Every query against a tenant-owned table goes through `forTenant(tenantId)` in
[`src/server/tenant-scope.ts`](src/server/tenant-scope.ts) — a Prisma client extension that injects
`tenantId` into every `where` and every `create`.

This is not a convenience. The usual approach is `where: { tenantId }` written by hand at each call
site, and it works right up until somebody forgets one. A forgotten filter does not throw, does not
fail a type check, and does not look wrong in review. It quietly returns every school's rows. One
missing clause on a student list is a disclosure of children's records.

So it is not written by hand. There is nothing to remember.

Two tests hold that in place, and both are release gates:

- `src/server/tenantScopeCoverage.test.ts` fails if a model gains a `tenantId` and is not scoped.
- `tests/db/tenant-isolation.test.ts` runs against real PostgreSQL and asks the questions an
  attacker would: can I read their row knowing its id, change it, delete it, write into their
  school by claiming to be them.

PostgreSQL row-level security is **not yet in place** and is the top item in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The extension is structural, which beats a
convention, but it lives in the application and RLS does not.

---

## Running it locally

You need **Node 22 or later** and a PostgreSQL database. Neon's free tier is the path of least
resistance and is what production uses.

### 1. Get a database

Sign in at [neon.tech](https://neon.tech), create a project, and open **Connection Details**. You
need two strings from there:

- the **pooled** one (its host contains `-pooler`) — this is `DATABASE_URL`
- the **direct** one — this is `DIRECT_URL`

Migrations issue statements a transaction pooler cannot carry, which is why there are two.

### 2. Configure

```bash
cp .env.example .env
```

Open `.env`, paste both connection strings, and generate a session secret:

```bash
openssl rand -base64 48
```

Put that in `NEXTAUTH_SECRET`. Leave `NEXTAUTH_URL` as `http://localhost:3000`.

### 3. Install, migrate, seed

```bash
npm ci
npm run db:deploy
npm run db:seed
```

`db:seed` prints the sign-in details for a demo school. **The admin password is generated and
printed once** — save it. Set `SEED_ADMIN_PASSWORD` beforehand if you would rather choose it. A
password committed to a repository is a password that reaches production, so there is no constant
to copy.

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with the details the seed printed, and you land on the
academic calendar.

---

## The commands that matter

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (generates the Prisma client first) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run lint` | ESLint. Separate from the build — Next 16 no longer runs it |
| `npm test` | Fast tests: pure functions, no database |
| `npm run test:db` | Tenant isolation and database constraints, against real PostgreSQL |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply existing migrations (this is what CI and production run) |
| `npm run db:seed` | Permission catalogue, system roles, and a demo school outside production |
| `npm run db:studio` | Prisma Studio, for looking at the data |

`npm test` and `npm run test:db` are deliberately separate. The database suites are excluded from
the default run rather than skipped inside it: a suite that quietly excuses itself when a variable
is missing is a suite that stops running and never says so — and tenant isolation is the one that
must never stop running.

---

## Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The short version: import the repository into Vercel,
set the five environment variables, and push. There is one deployable unit.

---

## Documentation

| Document | What it is for |
| --- | --- |
| [AGENTS.md](AGENTS.md) | The rules for changing this code. Read before writing any |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | What exists, what does not, what is known to be weak |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Structure and the load-bearing invariants |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Getting it to production and back out again |
| [docs/TESTING.md](docs/TESTING.md) | What is tested, how, and what a gate actually gates |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | What we expect to be attacked and what stops it |
| [docs/DATA_PRIVACY.md](docs/DATA_PRIVACY.md) | Children's records, retention, and the law |
| [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) | What to do at three in the morning |
| [docs/adr/](docs/adr/) | Why things are the way they are, including the decisions since reversed |
