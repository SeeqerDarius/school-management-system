# 0011. Supabase as the PostgreSQL host, in place of Neon

> **What this is for:** it records why the database moved to Supabase one day after
> [ADR 0010](0010-nextjs-fullstack-on-vercel.md) chose Neon, what that brings, and — more
> importantly — what it exposes that Neon did not. Read it before touching a connection string, a
> grant, or anything to do with row-level security.

## Status

Accepted — 2026-09-19. Supersedes the database-host decision in
[ADR 0010](0010-nextjs-fullstack-on-vercel.md) only. The rest of ADR 0010 stands: one Next.js
application on Vercel, Prisma, NextAuth, single package at the repository root.

## Context

ADR 0010 was written on 2026-09-19 and considered Supabase explicitly. It said:

> Supabase would bring RLS back with its own auth integration, which is genuinely attractive.
> Rejected for now because it reintroduces a second platform with its own credentials and its own
> dashboard, and because Neon is already the proven path for this deployment.

That reasoning was sound and it has been overtaken by a fact rather than refuted by an argument:
the project owner created a Supabase project for this product. The deciding input is that this is
the platform the work is going to live on. It is worth being plain about that — this ADR is not a
discovery that Neon was wrong.

ADR 0010 also said "revisit if RLS is not delivered by application-level means to a satisfactory
standard". That is *not* what happened here, and the distinction matters: the RLS opportunity
below is a consequence of the move, not its cause.

## Decision

**PostgreSQL is hosted on Supabase.** Prisma connects through Supavisor, Supabase's connection
pooler:

- `DATABASE_URL` — transaction mode, port 6543, with `pgbouncer=true`
- `DIRECT_URL` — session mode, port 5432, for `prisma migrate` only

Nothing else about the stack changes. This product does **not** use supabase-js, PostgREST,
Supabase Auth, Supabase Storage, Realtime or Edge Functions. Prisma speaks to PostgreSQL; nothing
else speaks to anything.

## The consequence that mattered most

Supabase is not a PostgreSQL host in the way Neon is. It is a platform that *includes* one, and
several of its parts are on by default.

**PostgREST serves schema `public` over the internet.** Every table Prisma creates is potentially
reachable at `https://<project-ref>.supabase.co/rest/v1/<table>` using the project's publishable
("anon") key — a credential that is public by design and ships in client bundles. Authorization is
plain PostgreSQL privileges plus row-level security, and Prisma emits neither: its schema language
has no concept of a `GRANT` or a policy, so `prisma migrate deploy` produces tables with
`relrowsecurity = false`.

Whether those tables are *granted* to `anon` depends on a toggle set by a human when the project
was created. Supabase changed the platform default on 2026-05-30 so that new tables are no longer
exposed automatically — but we confirmed against two live projects that the old, wide-open state
still occurs on projects created after that date. It is not visible in the catalog and cannot be
inferred from the project's age.

So the position had to be: **assume exposed, and close it unconditionally.** Left alone, a single
unauthenticated `GET` would have returned every row of `app_user`, bcrypt hashes included, and
`PATCH`/`DELETE` would have reached the ledger.

`prisma/migrations/20260919092000_data_api_lockdown` does that, idempotently and identically on
Supabase, on the bare PostgreSQL container CI uses, and on a laptop:

1. deny-all row-level security on every table in `public`;
2. `REVOKE` from `anon` and `authenticated` on existing tables, sequences and routines;
3. `ALTER DEFAULT PRIVILEGES` so tables created by future migrations inherit nothing.

Step 3 is the one that lasts. Steps 1 and 2 describe the tables that exist today; only default
privileges carry forward, and RLS does not carry forward at all — which is why
`tests/db/data-api-lockdown.test.ts` fails the build if any table lacks it.

## What this does *not* buy us

**It is not tenant isolation.** Prisma connects as `postgres`, which carries `BYPASSRLS`. Every
policy is skipped for this application's own connection. The deny-all RLS is a wall around the Data
API roles and nothing else; a missing tenant filter in our own code is still caught only by
`src/server/tenant-scope.ts`.

Real RLS is now *reachable* — `postgres` also has `CREATEROLE`, so a non-bypassing role can be
created — but it is a staged piece of work, not a switch:

1. per-tenant policies first,
2. `SET LOCAL app.tenant_id` inside every transaction,
3. only then a connection role without `BYPASSRLS`.

Doing (3) before (1) points a non-bypassing role at policy-less tables, and every query in the
product returns nothing. The staging is written out in `IMPLEMENTATION_STATUS.md`.

Note also that Supabase's own Prisma guide instructs you to create the application role
`with ... bypassrls`. Following the vendor's documented happy path would reintroduce precisely the
hole this work exists to close.

## Other consequences, honestly

**What got better.** RLS is now achievable at all, which ADR 0010 listed as the stack change's
worst regression. The dashboard's SQL editor and log viewer are genuinely useful. Extensions are
plentiful — `btree_gist` installs unaided, so the calendar's exclusion constraints work without a
support ticket.

**What got worse.**

- **Backups.** Neon gave point-in-time history on the free tier. On Supabase, PITR is a paid
  add-on and the free plan has no scheduled backups. Until that is resolved there is no recovery
  path from a destructive migration, which is why `db:reset` and `db:migrate` now refuse any
  non-local host.
- **No per-pull-request database.** Neon branching was free and gave every preview its own
  database. Supabase branching is paid. Preview now shares one long-lived throwaway project.
- **`prisma migrate dev` does not work against Supabase.** The `postgres` role has no `CREATEDB`,
  so the shadow database cannot be created (`P3014`). Migrations are developed against local
  PostgreSQL and applied with `migrate deploy`.
- **A second dashboard and a second set of credentials** — exactly the cost ADR 0010 named when it
  rejected Supabase. That cost is real and has simply been accepted.
- **Connection strings are now load-bearing and non-obvious.** The `db.<ref>.supabase.co` host is
  IPv6-only; `pgbouncer=true` is mandatory on 6543 or the app fails under concurrency with
  `prepared statement "s0" already exists`. Both failures are silent until they are not, and
  neither error message names its cause.

## Alternatives considered

**Stay on Neon.** Simpler, better backups on the free tier, free per-PR branching, and none of the
Data API surface. Rejected because the project owner has chosen Supabase; there is no engineering
argument here that outweighs that, and Neon's advantages are real enough that this ADR records them
rather than pretending the move was a straight upgrade.

**Use Supabase properly — supabase-js, Supabase Auth, PostgREST.** This is the platform's intended
shape and would make RLS the natural authorization mechanism. Rejected because it is a rewrite of
the identity layer, the data layer and the tenancy model for a product that already has all three
working, and because PostgREST as the query path would put authorization decisions in policies for
a permission model with 142 codes and per-membership DENY grants. Keeping Prisma and switching the
host is a change of address; this would be a change of architecture.

**Move the application's tables out of `public` into a non-exposed schema.** This is the cleanest
structural answer to the Data API problem — PostgREST only serves schemas it is configured to serve
— and it is recorded as a possible later refactor rather than done now. It needs Prisma's
`multiSchema` preview feature and a `@@schema` on all 15 models, and the lockdown migration already
closes the hole without that churn.
