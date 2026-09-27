# Operator handoff

## 2026-09-24 — student foundation and RLS draft (not released)

- Added the first tenant-scoped student list, admission form, student profile view, student and
  guardian/enrolment schemas, and initial server-side operations.
- Added explicit student and enrolment status transitions, same-tenant reference checks, and
  composite database keys so student, guardian, campus and academic-period relationships cannot
  cross school boundaries.
- Drafted per-tenant RLS policies and `withRlsTransaction`. The migration creates `sankofa_app` as
  `NOLOGIN`; a strong login credential must be provisioned through the deployment secret manager.
- Updated `README.md`, `IMPLEMENTATION_STATUS.md` and `docs/ARCHITECTURE.md` to state the current
  scope and remaining release gates.

Validation performed: `npx prisma validate` passed; strict TypeScript checking passed; ESLint
passed; fast unit suite passed (51 tests). Prisma client generation failed because Windows denied
replacement of the generated query-engine files while other Node processes were running. Database
integration tests were not run because the configured `.env` endpoint is a Supabase pooler and is
not identified as a disposable test database. No migration was applied, no commit was created, and
no deployment was made.

Remaining before release: regenerate the Prisma client in an unlocked/clean environment; run the
full production build; run all database migrations and integration tests against disposable
PostgreSQL and pass the schema drift check; review the student workflow at phone and desktop widths;
finish guardian and enrolment UI; finish RLS coverage for authentication and all calendar reads
before switching `DATABASE_URL` to the non-bypassing role; then use CI, preview and production
health/log checks. Do not apply the drafted migrations to production until those gates pass.
