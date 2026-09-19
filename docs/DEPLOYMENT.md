# Deployment

> **What this is for:** getting this product into production, and back out again when something
> goes wrong. Read the rollback section *before* you need it.

There is one deployable unit: a Next.js application on Vercel, talking to PostgreSQL on Supabase.
That is the whole topology. An earlier design had a second Java service; why it was retired is in
[ADR 0010](adr/0010-nextjs-fullstack-on-vercel.md), and why the database moved from Neon to
Supabase is in [ADR 0011](adr/0011-supabase-as-the-postgresql-host.md).

Supabase is a larger surface than Neon was. It ships an internet-facing REST API over your tables
whether you use it or not, so §1 below is not optional setup — it is the difference between a
private database and a public one.

---

## Environments

Three, and they share nothing.

| Environment | Where | Database |
| --- | --- | --- |
| Development | Your machine | Local PostgreSQL 17, or your own Supabase project |
| Preview | Vercel, one per pull request | A **separate** Supabase project, **never** production |
| Production | Vercel, from `main` | The production Supabase project |

> Neon gave a database branch per pull request for nothing. Supabase does not: branching is a paid
> feature and the free plan has no per-pull-request equivalent. So preview points at one long-lived
> throwaway project shared by every open pull request, and that project is **seeded**, never
> restored from production.

**A credential is never shared across environments.** A preview deployment is built from whatever
is in a pull request, and a pull request can come from anywhere. If preview holds a production
credential, then a preview compromise is a production compromise, and the blast radius of a
carelessly reviewed branch is every school's data.

Preview deployments must never point at production data for the same reason: a preview is a place
people click things to see what happens.

---

## First deployment

### 1. The database

Create a Supabase project. **Choose the region before you create it** — it is fixed for the life of
the project, and the pooler hostname embeds it.

The database region is the immutable one, so it wins: set `regions` in `vercel.json` to the Vercel
region in the *same* AWS region as the project, rather than moving the database. Today that is
`eu-west-1` (Ireland) and `dub1`. A function talking to a database one region away pays that hop
on every query, and a single page render makes several in sequence — session, memberships,
permissions, then the page's own reads.

From **Connect → ORMs → Prisma**, copy both strings:

- the **transaction** pooler, port 6543 → `DATABASE_URL`
- the **session** pooler, port 5432 → `DIRECT_URL`

They are not interchangeable. The application runs in serverless functions that open and close
connections constantly, which exhausts the connection limit without a pooler in front; migrations
issue statements a transaction pooler cannot carry.

Copy them rather than composing them. The pooler hostname is not derivable from the region — newer
projects land on `aws-1-<region>`, older ones on `aws-0-<region>` — and the `db.<project-ref>.supabase.co`
host you may find elsewhere is **IPv6-only** unless the project buys the IPv4 add-on. From an
IPv4-only network, which covers most connections in Ghana and every GitHub-hosted Actions runner,
migrations against that host fail with Prisma `P1001` and the message says nothing about
addressing. Every flag on those URLs is explained in `.env.example`; `pgbouncer=true` on the 6543
string is not optional.

#### Check what the Data API can currently see

Supabase serves schema `public` over PostgREST at `https://<project-ref>.supabase.co/rest/v1/`
using the project's publishable key — which is public by design. Whether your tables are readable
from the internet depends on a toggle set when the project was created, and it is not visible in
the catalog. Run this in the SQL editor **before** the first deploy:

```sql
select defaclrole::regrole::text                      as granting_role,
       (aclexplode(defaclacl)).grantee::regrole::text as grantee,
       (aclexplode(defaclacl)).privilege_type
from pg_default_acl
where defaclnamespace = 'public'::regnamespace
  and defaclobjtype = 'r'
order by 1, 2, 3;
```

If the row for `granting_role = postgres`, `grantee = anon` lists SELECT/INSERT/UPDATE/DELETE, then
every table Prisma creates would have been world-readable. Migration
`20260919092000_data_api_lockdown` closes that and is safe to apply either way — but you should
know which state you were in, because it tells you whether anything was ever exposed.

The migration in `prisma/migrations/20260919091000_calendar_and_role_constraints` creates the
`btree_gist` extension in the `extensions` schema. The `postgres` role can do this unaided on
Supabase — no dashboard click, no superuser.

### 2. The project

Import the repository into Vercel. The settings in `vercel.json` are already correct — framework
`nextjs`, `npm ci` to install, `npm run build` to build, region `dub1`.

`dub1` is Dublin, `eu-west-1`, which is where the Supabase project lives. Co-location beats
proximity to the user here: the Ghana-to-edge hop is paid once per request, while the
function-to-database hop is paid several times in sequence within it. `lhr1` (London) is marginally
better connected to West Africa, and that is the smaller number.

Static assets do not depend on this setting at all — they are served from Vercel's global edge
network regardless. `regions` only places the serverless functions.

**If the database ever moves, move this with it.** The two being in different AWS regions is a
silent tax on every page, not an error anyone will see.

### 3. Environment variables

Set these in Vercel for **Production** and **Preview** separately.

| Variable | Production | Preview |
| --- | --- | --- |
| `DATABASE_URL` | Production project, Supavisor **transaction** mode (`:6543`) with `?pgbouncer=true&connection_limit=1&pool_timeout=20&connect_timeout=15&sslmode=require` | The preview project, same shape |
| `DIRECT_URL` | Production project, Supavisor **session** mode (`:5432`), no `pgbouncer` flag | The preview project, session mode |
| `NEXTAUTH_SECRET` | `openssl rand -base64 48` | A *different* value |
| `NEXTAUTH_URL` | Your canonical domain | Leave unset — Vercel supplies its own URL |
| `NEXT_PUBLIC_SITE_URL` | Your canonical domain | Leave unset |

`NEXT_PUBLIC_*` is inlined into the JavaScript bundle and served to every visitor. Nothing secret
goes behind that prefix, ever. CI fails the build if anything tries.

There is no `NEXT_PUBLIC_SUPABASE_URL` and no `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and there never will
be. This product does not use supabase-js, PostgREST, Supabase Auth or Supabase Storage — Prisma
speaks to PostgreSQL and nothing else does. Publishing an anon key would hand the internet a second
door into the same tables.

### 4. Migrate

Migrations do **not** run as part of the Vercel build, and that is deliberate. A build runs on every
preview, from every branch; a schema change must not be applied by whoever opened a pull request.

Apply them from your machine, with `DIRECT_URL` pointed at production:

```bash
npm run db:deploy
```

Then seed the permission catalogue and the system roles. The demo school is skipped automatically
when `NODE_ENV=production`:

```bash
NODE_ENV=production npm run db:seed
```

The seed is idempotent — CI proves it by running it twice — so this is safe to repeat after a
release that adds permissions.

Then confirm the Data API really is shut, because this is the step nobody notices is missing:

```bash
npm run test:db
```

`tests/db/data-api-lockdown.test.ts` asserts that no table in `public` lacks row-level security,
that `anon` and `authenticated` hold no privileges on any of them, and that `btree_gist` is not in
`public`. Against Supabase all three are meaningful; against plain PostgreSQL the middle one passes
vacuously because the roles do not exist.

You can also check from outside, with no credentials at all — this should return a permission
error, not data:

```bash
curl -s "https://<project-ref>.supabase.co/rest/v1/app_user?select=id&limit=1" -H "apikey: <publishable key>"
```

### 5. The first real account

There is no self-service registration, so the first administrator has to be created deliberately.
Do it with a one-off script against production using the same bcrypt work factor as
`prisma/seed.ts`, or by running the seed with `ALLOW_PRODUCTION_SEED=true` and
`SEED_ADMIN_EMAIL` set, then immediately changing the password.

**Never insert a user row by hand with a password hash from somewhere else.** A hash copied from a
development database is a development password in production.

---

## Every deployment after that

1. Open a pull request. CI runs typecheck, lint, the fast tests, a production build, and the
   database job — migrations applied to an empty PostgreSQL, drift check, seed run twice, tenant
   isolation and constraint suites.
2. Vercel builds a preview.
3. Merge to `main`. Vercel deploys production.
4. **If the release includes a migration, apply it before the code that needs it** — see below.

### Migrations and deployment order

A migration and the code that depends on it deploy at different moments, and for a few seconds both
old and new code are live. So migrations are written to be **backwards compatible with the code
currently running**:

- Adding a nullable column, a table or an index: apply any time.
- Adding a required column: add it nullable, backfill, then make it required in a *later* release.
- Removing a column: stop writing it, deploy, then remove it in a later release.
- Renaming anything: add, backfill, switch reads, stop writing, remove. Five steps, not one.

A migration that has been applied anywhere is never edited. Its checksum is recorded in every
database that ran it, and changing the file breaks them all. CI enforces this on every pull
request: modifying or deleting a file under `prisma/migrations/` fails the build. Correct a
mistake by adding another migration.

---

## Rolling back

**Code rolls back. Data does not.** Read that again before deploying a destructive migration.

### Rolling back code

In Vercel: **Deployments → the last good one → Promote to Production**. It is immediate and it is
the first thing to do in an incident. Do not try to fix forward under pressure.

### Rolling back a migration

There is no down migration, on purpose. A generated rollback that has never been run is a rollback
that does not work, and discovering that at three in the morning with a broken database is worse
than having no rollback at all.

So:

1. **Promote the previous deployment.** If the migration was backwards compatible — and it should
   have been — the old code runs fine against the new schema, and you have stopped the bleeding.
2. **Write a forward migration** that undoes what is wrong, with a clear head, reviewed.
3. **Restoring lost data depends on a plan you may not be on.** Supabase's point-in-time recovery
   is a paid add-on and the free plan has no scheduled backups at all. Neon gave this away; Supabase
   does not.

   **Confirm what this project actually has, today, before you need it** — Project Settings →
   Database → Backups. If the answer is "nothing", then a destructive migration against production
   is unrecoverable, and that fact should change how the migration is reviewed rather than being
   discovered at three in the morning.

   This is why `npm run db:reset` and `npm run db:migrate` now refuse any host that is not
   localhost (`scripts/guard-local-db.mjs`): both DROP and recreate, and against Supabase that
   destroys the project's own `auth` and `storage` schemas as well, from which it does not
   recover. It is also why destructive migrations go out on their own, never bundled with a
   feature.

[INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) covers who to tell and when, including the statutory
clock that starts when children's data is involved.

---

## Secrets

- Rotate `NEXTAUTH_SECRET` and every session is invalidated at once. That is the intended emergency
  control, not a side effect.
- A leaked database URL means resetting the database password in Supabase (Project Settings →
  Database) and updating both variables in Vercel. Rotating it invalidates both URLs at once,
  because they differ only by port and role.
- The publishable ("anon") key is public by design and is not a secret. It is also not harmless:
  it is the credential the Data API accepts, which is exactly what migration
  `20260919092000_data_api_lockdown` exists to make useless.
- A credential committed to git is compromised the moment it is pushed, whatever the repository's
  visibility. Rotate it; do not merely remove the file. CI's secret scan is a safety net, not a
  reason to be casual.

---

## What is not set up yet

Named here rather than assumed, because an operational gap you do not know about is worse than one
you do.

- **No error tracking.** Failures reach Vercel's function logs and nowhere else. Nobody is paged.
- **No uptime monitoring.** You will learn about an outage from a school.
- **No database backup.** Supabase's point-in-time recovery is a paid add-on and the free plan has
  no scheduled backups, so unless this project is on a paid tier there is no recovery path from a
  destructive migration and no independent export. This is a regression from Neon and it is the
  single most important open item in `IMPLEMENTATION_STATUS.md` after tenant-policy RLS.
- **No staging environment** distinct from preview.

These are tracked in [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).
