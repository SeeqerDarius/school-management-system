# Deployment

> **What this is for:** getting the Sankofa School Platform running in an environment other than
> a laptop. **Who reads it:** whoever is doing that, and whoever has to undo it at 2am.

> **Status: nothing is deployed.** No Vercel project, no container host, no database, no Firebase
> project. This document describes what deployment *requires* and how to perform it. Every
> instruction below is written from the code as it stands, but **none of it has been executed**,
> and the container image has never been built — Docker was not available on the machine this was
> developed on. Treat the first run of each step as the step being tested for the first time.

---

## 1. The shape of a deployment

Three pieces, and they cannot all live on Vercel.

```mermaid
flowchart LR
    U["Browser"] --> W["apps/web<br/>Next.js on Vercel"]
    W -->|"server-to-server<br/>session bearer token"| A["services/core-api<br/>Spring Boot container"]
    A --> P[("PostgreSQL 16+<br/>managed")]
    A --> F["Firebase<br/>Auth · Storage"]
    U -->|"sign-in only"| F
```

| Piece | Runs on | Why not Vercel |
|---|---|---|
| `apps/web` | **Vercel** | — it is a Next.js app, this is the happy path |
| `services/core-api` | **Any OCI host** — Cloud Run, Railway, Fly.io, Vercel container runtime | Vercel's Node runtime cannot run a JVM. The container runtime can, but needs a paid plan |
| PostgreSQL | **Managed** — Neon, Supabase, Cloud SQL | Vercel does not host PostgreSQL |
| Firebase Auth, Storage | **Google Cloud** | — |

The image is deliberately host-agnostic: plain OCI, no platform-specific base or build hook. Its
only contract with the host is *listen on `$PORT`* and *report readiness at
`/actuator/health/readiness`*.

---

## 2. Prerequisites, in order

Each step depends on the one before it. Doing them out of order wastes time.

### 2.1 PostgreSQL — and the part that is easy to get wrong

Provision PostgreSQL 16 or later. Then **create two roles**, because the application and the
migrations must not share one:

```bash
psql "$SUPERUSER_URL" \
  -v migrate_password="'<generated>'" \
  -v app_password="'<generated>'" \
  -f database/bootstrap/00_roles.sql
```

| Role | Attributes | Used by |
|---|---|---|
| `sankofa_migrate` | owns the schemas, **BYPASSRLS** | Flyway, and system jobs that legitimately span tenants |
| `sankofa_app` | plain login role — **no ownership, no BYPASSRLS, not superuser** | the running application |

**This split is the whole basis of tenant isolation.** A superuser — and any role with
`BYPASSRLS` — ignores Row Level Security unconditionally. Point `spring.datasource` at the
migration role and every policy in the schema becomes inert: nothing errors, nothing looks
broken, and every school can read every other school's records. `00_roles.sql` re-asserts the
role attributes on every run and refuses rather than passing silently, which is the one
safeguard against this being discovered later rather than sooner.

The `btree_gist` extension is required (`V0010` installs it; it is a trusted extension, so the
schema owner can do this without superuser on PostgreSQL 13+). Confirm your provider permits it —
Neon and Supabase do; some locked-down managed offerings do not.

### 2.2 Firebase

Create **one project per environment**. Sharing a project across staging and production means a
staging compromise is a production compromise.

1. Enable **Authentication** → Email/Password.
2. Enable **Storage**, and leave the bucket **private**. Objects are served through short-lived
   signed URLs only (§68). A public bucket here exposes student photographs and staff documents.
3. Generate a service account for the API, or preferably use Application Default Credentials so
   there is no key file to leak or rotate.
4. Note the client config values for the web tier — these are public by design; they identify the
   project and authorise nothing.

**Until this exists, nobody can sign in**, and a deployed application will render the sign-in page
and stop there.

### 2.3 Secrets

Every environment gets its own. See `.env.example` for the complete list with dummy values.

| Where | Variables |
|---|---|
| Container host | `DB_URL`, `DB_APP_USER`, `DB_APP_PASSWORD`, `DB_MIGRATE_USER`, `DB_MIGRATE_PASSWORD`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `PORT` |
| Vercel | `CORE_API_BASE_URL`, `SESSION_SECRET`, `NEXT_PUBLIC_FIREBASE_*` |

`SESSION_SECRET` is 32+ random bytes, different per environment:

```bash
openssl rand -base64 48
```

Nothing secret may go behind `NEXT_PUBLIC_`. That prefix inlines the value into the client
bundle, where it is public to every visitor. CI fails the build if it finds one (see the
secret-scan job).

---

## 3. Deploying the API

```bash
docker build -t sankofa-core-api:$(git rev-parse --short HEAD) services/core-api
```

The build resolves dependencies in their own layer before copying source, so a code-only change
rebuilds in seconds. Tests are **not** run in the image build — they run in CI against a real
PostgreSQL as a non-superuser role, and an image built from a commit CI has not passed should not
be deployed at all.

Runtime requirements the host must satisfy:

- `PORT` honoured (defaults to 8080)
- Readiness probe on `/actuator/health/readiness`, with a start period of at least 45 seconds —
  Flyway runs at boot and a cold JVM is not fast
- Outbound network to PostgreSQL and to Google's token-signing endpoints
- Memory: 512 MiB is the floor, 1 GiB is comfortable. `MaxRAMPercentage=75` adapts the heap to
  whatever the platform actually granted

### Migrations

Flyway runs automatically at start-up, as `sankofa_migrate`. That is convenient and correct for a
single instance; it is **not** safe when several instances start simultaneously against an empty
database, because they will race. Before scaling beyond one instance, move migration to a
pre-deploy job and set `spring.flyway.enabled=false` on the application itself.

Migrations must be **backward compatible** with the currently running version, because during a
rolling deploy both versions are live at once. Adding a column is safe; dropping or renaming one
is not. Use expand/contract: add, deploy, backfill, switch reads, then remove in a later release.

---

## 4. Deploying the web tier

On Vercel, set the project's **Root Directory to `apps/web`**. The repository is an npm workspace
and the build must run from the workspace root; `apps/web/vercel.json` supplies the install and
build commands.

`regions: ["lhr1"]` puts the functions in London, the lowest-latency Vercel region for Ghana —
Vercel has no African region. Region pinning is a paid-plan feature; on hobby it is ignored, which
costs latency but nothing else.

Every tenant-scoped route is `force-dynamic` (see `app/(school)/layout.tsx`), so nothing is
prerendered and nothing is cached at the edge. This is deliberate: a cached page served to the
wrong school is the same disclosure the entire tenancy model exists to prevent.

---

## 5. Order of operations

Ordering matters on the first deploy and on every deploy after it.

**First deploy**

1. Provision PostgreSQL → run `00_roles.sql` → verify `sankofa_app` has neither `SUPERUSER` nor
   `BYPASSRLS`
2. Create the Firebase project
3. Set secrets on both hosts
4. Deploy the API — Flyway creates the schema
5. Verify `/actuator/health/readiness` returns `UP`
6. Deploy the web tier with `CORE_API_BASE_URL` pointing at the API
7. Provision the first tenant and invite the first administrator
8. Run the smoke test below

**Subsequent deploys**

1. CI green on the commit
2. API first, web second — the web tier tolerates an API that is ahead of it far better than an
   API that is behind it
3. Watch readiness and error rates for the first fifteen minutes

---

## 6. Production smoke test

Vercel reporting "Ready" means the build succeeded. It does not mean the system works (§198).
Run this against the deployed environment:

```bash
# 1. The API is up and can reach its database
curl -fsS "$API/actuator/health/readiness"        # expect {"status":"UP"}

# 2. An unauthenticated request to a protected endpoint is refused
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/academic-years"   # expect 401

# 3. A forged session token is refused
curl -s -o /dev/null -w '%{http_code}\n' \
     -H 'Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
     "$API/api/v1/academic-years"                 # expect 401

# 4. Errors carry no stack trace, no SQL, no class names
curl -s "$API/api/v1/academic-years" | grep -Ei 'java\.|springframework|Exception' \
  && echo 'FAIL: internals leaked' || echo 'OK: no internals in error body'

# 5. Security headers are present
curl -sI "$API/actuator/health" | grep -Ei 'strict-transport|content-type-options|frame-options'
```

Then, through the browser:

| Check | Expected |
|---|---|
| Sign in as the seeded administrator | Lands on the school chooser, not on a school |
| Choose the school | Academic calendar loads |
| Create an academic year | Appears as **Planned** |
| Add two terms with overlapping dates | Second one refused with a message naming the conflict |
| Activate the year, then a term | Both become **Active** |
| Close the year with terms still open | Refused |
| Sign in as a teacher | Calendar returns **403**, not an empty page |
| Query `audit.audit_log` | Entries for each action, with actor and reason |

The last two matter most. A calendar that renders empty for a teacher instead of refusing would
mean the permission check is not running, and an empty audit log would mean the transaction
boundary is wrong.

---

## 7. Rollback

| Situation | Action |
|---|---|
| Web tier broken | Vercel → Instant Rollback to the previous deployment |
| API broken, schema unchanged | Redeploy the previous image tag |
| API broken, schema changed | **Do not roll the database back.** Roll the application forward or back to a version compatible with the current schema. Restoring a database loses every transaction since the snapshot |
| Migration failed mid-flight | Flyway marks it failed and refuses to continue. Repair deliberately — see `RUNBOOK.md` (not yet written) |

This is the reason migrations must be backward compatible: it makes an application rollback
possible without a database rollback.

---

## 8. Not yet ready for production

Stated plainly, because a deployment guide that implies readiness it does not have is worse than
no guide.

| Gap | Consequence |
|---|---|
| **No Firebase project** | Nobody can sign in. The application is unusable |
| **No rate limiting on sign-in** | Credential stuffing against parent accounts is recorded but not slowed (§84) |
| **The container image has never been built** | The Dockerfile is verified only as far as the layered-jar extraction and launcher layout, which were tested locally without Docker |
| **Flyway runs at application start** | Unsafe above one instance |
| **No backup or restore procedure has been exercised** | A backup never restored is not a backup (`BACKUP_RESTORE.md` is not yet written) |
| **No staging environment** | Nothing catches a production-only problem before production does |
| **CodeQL results are not published** | Requires code scanning to be enabled; the gate is currently soft |
| **Only one business module exists** | See `IMPLEMENTATION_STATUS.md` |

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — not yet written — for the per-release gate.
