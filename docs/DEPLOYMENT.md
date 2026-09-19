# Deployment

> **What this is for:** getting this product into production, and back out again when something
> goes wrong. Read the rollback section *before* you need it.

There is one deployable unit: a Next.js application on Vercel, talking to PostgreSQL on Neon. That
is the whole topology. An earlier design had a second Java service; why it was retired and what was
lost with it is in [ADR 0010](adr/0010-nextjs-fullstack-on-vercel.md).

---

## Environments

Three, and they share nothing.

| Environment | Where | Database |
| --- | --- | --- |
| Development | Your machine | Your own Neon project, or local PostgreSQL |
| Preview | Vercel, one per pull request | A Neon branch, **never** production |
| Production | Vercel, from `main` | The production Neon project |

**A credential is never shared across environments.** A preview deployment is built from whatever
is in a pull request, and a pull request can come from anywhere. If preview holds a production
credential, then a preview compromise is a production compromise, and the blast radius of a
carelessly reviewed branch is every school's data.

Preview deployments must never point at production data for the same reason: a preview is a place
people click things to see what happens.

---

## First deployment

### 1. The database

Create a Neon project. From **Connection Details**, take:

- the **pooled** string — its host contains `-pooler` — for `DATABASE_URL`
- the **direct** string for `DIRECT_URL`

Both are needed and they are not interchangeable. The application runs in serverless functions that
open and close connections constantly, which exhausts a database's connection limit without a
pooler in front. Migrations issue statements a transaction pooler cannot carry, so they must bypass
it.

The migration in `prisma/migrations/20260919091000_calendar_and_role_constraints` creates the
`btree_gist` extension. Neon permits this; a locked-down PostgreSQL might not, in which case a
superuser has to create it once before the first deploy.

### 2. The project

Import the repository into Vercel. The settings in `vercel.json` are already correct — framework
`nextjs`, `npm ci` to install, `npm run build` to build, region `lhr1`.

`lhr1` (London) is the default because it is the closest Vercel region to Ghana with full feature
support. **Put the database in the matching Neon region.** A function in London talking to a
database in Virginia pays the Atlantic on every query, several times per page.

### 3. Environment variables

Set these in Vercel for **Production** and **Preview** separately.

| Variable | Production | Preview |
| --- | --- | --- |
| `DATABASE_URL` | Production Neon, pooled | A Neon **branch**, pooled |
| `DIRECT_URL` | Production Neon, direct | The same branch, direct |
| `NEXTAUTH_SECRET` | `openssl rand -base64 48` | A *different* value |
| `NEXTAUTH_URL` | Your canonical domain | Leave unset — Vercel supplies its own URL |
| `NEXT_PUBLIC_SITE_URL` | Your canonical domain | Leave unset |

`NEXT_PUBLIC_*` is inlined into the JavaScript bundle and served to every visitor. Nothing secret
goes behind that prefix, ever. CI fails the build if anything tries.

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
3. **If data is lost, restore from a Neon branch.** Neon keeps point-in-time history; branch from
   a timestamp before the migration, verify it, and move the connection string. This is the only
   real recovery path for a destructive migration, and it is why destructive migrations go out on
   their own, never bundled with a feature.

[INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) covers who to tell and when, including the statutory
clock that starts when children's data is involved.

---

## Secrets

- Rotate `NEXTAUTH_SECRET` and every session is invalidated at once. That is the intended emergency
  control, not a side effect.
- A leaked database URL means rotating the Neon password and updating both variables in Vercel.
- A credential committed to git is compromised the moment it is pushed, whatever the repository's
  visibility. Rotate it; do not merely remove the file. CI's secret scan is a safety net, not a
  reason to be casual.

---

## What is not set up yet

Named here rather than assumed, because an operational gap you do not know about is worse than one
you do.

- **No error tracking.** Failures reach Vercel's function logs and nowhere else. Nobody is paged.
- **No uptime monitoring.** You will learn about an outage from a school.
- **No automated database backup beyond Neon's own retention.** Neon's point-in-time history is
  real and is the recovery path above, but there is no independent export.
- **No staging environment** distinct from preview.

These are tracked in [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).
