import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { NewClassForm } from '@/features/classes/components/new-class-form';
import {
  assignableTeachers,
  listClasses,
  selectableCampuses,
  selectableYears,
} from '@/features/classes/data';
import { P } from '@/lib/permissions';
import { requireActiveSession } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Classes' };

/**
 * The classes.
 *
 * <p>A teacher sees the ones they are class teacher of; a registrar sees them all. That narrowing
 * happens in the query, not here — see `attendanceReach`.
 */
export default async function ClassesPage() {
  const session = await requireActiveSession();
  const canManage = session.permissions.has(P.CLASS_MANAGE);

  // Said here rather than thrown from the query. Somebody without either permission reaching
  // this page is not an error condition — it is somebody who does not do this job, and they
  // should be told so in a sentence rather than shown a 500 with a support reference.
  if (!session.permissions.has(P.CLASS_VIEW) && !session.permissions.has(P.ATTENDANCE_VIEW)) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Classes" />
        <ErrorState
          title="Classes are not part of your role"
          detail="Class lists belong to the people who teach and organise them. If you need access, ask whoever administers this school."
        />
      </main>
    );
  }

  const classes = await listClasses();
  const [years, teachers, campuses] = canManage
    ? await Promise.all([selectableYears(), assignableTeachers(), selectableCampuses()])
    : [[], [], []];

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Classes"
        description="A class is a group of children for one academic year. It is what a register is taken for, and what decides which children a teacher can see."
      />

      {canManage && (
        <Panel
          title="Create a class"
          description={years.length === 0 ? 'There is no open academic year to put one in.' : undefined}
        >
          <div className="px-4 py-4 sm:px-5">
            {years.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                Add an academic year first, under{' '}
                <Link href="/settings/calendar" className="text-[var(--color-primary)] hover:underline">
                  Academic calendar
                </Link>
                .
              </p>
            ) : (
              <NewClassForm
                campuses={campuses}
                years={years}
                teachers={teachers.map((teacher) => ({
                  id: teacher.id,
                  label: teacher.user.preferredName ?? teacher.user.fullName,
                }))}
              />
            )}
          </div>
        </Panel>
      )}

      <div className={canManage ? 'mt-4' : ''}>
        <Panel title="Classes" description={`${classes.length}`}>
          {classes.length === 0 ? (
            <EmptyState
              title="No classes yet"
              description={
                canManage
                  ? 'Create one above. A class needs an academic year, a code and a name — what you call it is up to the school.'
                  : 'You are not the class teacher of any class. If you expect to be, ask whoever administers this school.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">Classes</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left">
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5">
                      Code
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                      Name
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                      Year
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                      Class teacher
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5">
                      On roll
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((classGroup) => (
                    <tr key={classGroup.id} className="border-b border-[var(--color-border)] last:border-0">
                      <th scope="row" className="px-4 py-2 text-left font-medium sm:px-5">
                        <Link
                          href={`/classes/${classGroup.id}`}
                          className="text-[var(--color-primary)] hover:underline"
                        >
                          {classGroup.code}
                        </Link>
                        {classGroup.isClassTeacher && (
                          <span className="ml-2 align-middle">
                            <StatusBadge label="Yours" tone="success" />
                          </span>
                        )}
                      </th>
                      <td className="px-4 py-2 text-[var(--color-ink)]">{classGroup.name}</td>
                      <td className="px-4 py-2 text-[var(--color-ink-muted)]">
                        {classGroup.academicYearName}
                      </td>
                      <td className="px-4 py-2 text-[var(--color-ink-muted)]">
                        {classGroup.classTeacherName ?? 'Nobody'}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-[var(--color-ink-muted)] sm:px-5">
                        {classGroup.rollSize}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
