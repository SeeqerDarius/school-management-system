# Build and Release Plan

**Product direction:** Build the school platform in safe, usable stages from the existing repository. This plan replaces the Firebase-specific parts of the pasted master prompt. It does not reset working code or claim unfinished modules are complete.

## Decisions we are keeping

- One website and one deployment: Next.js on Vercel.
- PostgreSQL on Supabase, accessed by the website through Prisma.
- NextAuth for staff sign-in and the existing school-membership permission model.
- No Firebase services, no separate Java service, and no AI features.
- Protect student and family information, school-to-school separation, academic records, and money before expanding the number of screens.
- Ghana is the first setup; country-specific dates, currency, payroll and school rules must remain configurable.

These choices follow the current application and the accepted architecture records. They keep the number of services and dashboards an owner has to manage small.

## Where the work stands

The repository currently has sign-in, school selection, roles and permissions, the academic calendar, audit logging, database safeguards, and the first student/admissions work. The honest feature-by-feature record is in [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

It is not yet a complete school system. In particular, the current record says the database's row-level security has not been proved as the application's isolation layer, recovery and backup arrangements are unresolved, sign-in protections need more work, and most school and finance workflows are not built. The production website also needs to be lined up with the current application before release.

## Delivery stages

A stage is called complete only when a real user can finish the whole task, permission checks work on the server, the data stays inside that user's school, helpful empty/error/loading screens exist, and the release checks pass.

1. **Make the foundation safe and releasable.** Prove school-to-school data separation in PostgreSQL; safely complete the RLS change; decide and rehearse a database recovery path; finish the important sign-in protections; make the production site use this application and show a working sign-in page. Do not use real children's records until these gates pass.
2. **Finish student records and admissions.** Complete student records, guardians, family links, applications/admission decisions, enrolment, transfers and the everyday school-office flow.
3. **Run the school day.** Build school years/classes/subjects, timetables, attendance and leave/absence corrections, with clear staff responsibilities.
4. **Teach and report results.** Build assessments, configurable grading, review/approval, published results, report cards and transcripts, preserving a history of changes.
5. **Collect and account for money.** Build fee schedules, family invoices, payments, receipts, refunds, accounting journals, period close and the reports needed by a bursar. Never record a real payment during a deployment check.
6. **Manage staff and payroll.** Build staff records, contracts, leave, configurable Ghana payroll rules, payslips and approved payroll-to-accounting posting.
7. **Add school operations.** Deliver library, inventory, procurement, assets, transport, boarding, health and safeguarding workflows in separately releasable pieces.
8. **Connect families and staff.** Add role-appropriate parent/student/teacher/headteacher workspaces, announcements and notifications, secure documents, imports/exports and useful reports. Add messaging only after its privacy and support rules are settled.
9. **Finish operational readiness.** Complete onboarding, school setup, help material, accessibility and mobile checks, backup restoration practice, incident response, monitoring and the final security review.

## How each release will work

- Work on one small, named outcome at a time; preserve other in-progress files.
- Use a preview deployment and non-production data first.
- Review schema changes before applying them. Never test with the production database and never rewrite a migration that has already been used.
- Commit each finished, coherent piece with a clear description.
- Release to production only after the change has passed its applicable quality and database checks.
- After release, confirm the site is ready, sign-in or the changed workflow behaves correctly, health checks succeed, and new errors are reviewed.
- Report what is finished, what is not, and anything the owner must still do in ordinary language.

## First release gate

The next implementation outcome is **safe foundation and deployment alignment**, not a new dashboard. Before student data is entered, the tenant-isolation migration and database role must be proved on a disposable database, the application must be shown to work with the restricted database role, a recovery method must be agreed and rehearsed, and Vercel must serve the current Next.js application with its required private settings. Production database changes and production release happen only after those checks are concrete and reviewable.
