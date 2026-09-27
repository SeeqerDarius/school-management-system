import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { today } from '@/features/attendance/data';
import { AssignTeacherForm } from '@/features/classes/components/assign-teacher-form';
import { EndEnrolmentForm } from '@/features/classes/components/end-enrolment-form';
import { EnrolForm } from '@/features/classes/components/enrol-form';
import {
  assignableTeachers,
  enrollableStudents,
  getClass,
  selectableTerms,
} from '@/features/classes/data';

export const metadata: Metadata = { title: 'Class' };

export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const classGroup = await getClass(id);
  if (!classGroup) notFound();

  const schoolToday = await today();

  const teachers = classGroup.canManage ? await assignableTeachers() : [];
  const terms = classGroup.canEnrol ? await selectableTerms(classGroup.academicYearId) : [];
  // Offering children already enrolled for a term the database would refuse is a form that
  // fails after the click rather than before it, so the list is scoped to the first open term.
  const enrollable = classGroup.canEnrol && terms[0] ? await enrollableStudents(terms[0].id) : [];

  const live = classGroup.roll.filter((entry) => entry.status === 'PENDING' || entry.status === 'ACTIVE');
  const past = classGroup.roll.filter((entry) => entry.status !== 'PENDING' && entry.status !== 'ACTIVE');

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`${classGroup.code} — ${classGroup.name}`}
        description={`${classGroup.academicYearName} · ${live.length} on roll`}
      />

      <p className="mb-4 flex flex-wrap gap-4 text-sm">
        <Link href="/classes" className="text-[var(--color-primary)] hover:underline">
          ← All classes
        </Link>
        <Link
          href={`/attendance/${classGroup.id}?date=${schoolToday}`}
          className="text-[var(--color-primary)] hover:underline"
        >
          Take today’s register →
        </Link>
      </p>

      {classGroup.canManage && (
        <Panel title="Class teacher">
          <div className="px-4 py-4 sm:px-5">
            <AssignTeacherForm
              classGroupId={classGroup.id}
              current={classGroup.classTeacherMembershipId}
              teachers={teachers.map((teacher) => ({
                id: teacher.id,
                label: teacher.user.preferredName ?? teacher.user.fullName,
              }))}
            />
          </div>
        </Panel>
      )}

      {classGroup.canEnrol && (
        <div className={classGroup.canManage ? 'mt-4' : ''}>
          <Panel
            title="Enrol a child"
            description="A child has one enrolment per term. The database refuses a second."
          >
            <div className="px-4 py-4 sm:px-5">
              <EnrolForm
                classGroupId={classGroup.id}
                defaultDate={schoolToday}
                terms={terms.map((term: { id: string; name: string }) => ({ id: term.id, label: term.name }))}
                students={enrollable.map((student) => ({
                  id: student.id,
                  label: `${student.reference} — ${[
                    student.preferredName ?? student.firstName,
                    student.lastName,
                  ]
                    .filter(Boolean)
                    .join(' ')}`,
                }))}
              />
            </div>
          </Panel>
        </div>
      )}

      <div className="mt-4">
        <Panel title="On roll" description={`${live.length}`}>
          {live.length === 0 ? (
            <EmptyState
              title="Nobody is enrolled yet"
              description={
                classGroup.canEnrol
                  ? 'Enrol children above. Until then this class has no register to take.'
                  : 'Once children are enrolled they appear here, and on the register.'
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {live.map((entry) => (
                <li
                  key={entry.enrolmentId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/students/${entry.studentId}`}
                      className="font-medium text-[var(--color-primary)] hover:underline"
                    >
                      {entry.name}
                    </Link>
                    <span className="ml-2 tabular-nums text-xs text-[var(--color-ink-muted)]">
                      {entry.reference}
                    </span>
                  </div>
                  {classGroup.canEnrol && (
                    <EndEnrolmentForm
                      enrolmentId={entry.enrolmentId}
                      defaultDate={schoolToday}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {past.length > 0 && (
        <div className="mt-4">
          <Panel
            title="No longer in this class"
            description="Kept, not deleted — past registers have to keep saying who was in the room."
          >
            <ul className="divide-y divide-[var(--color-border)]">
              {past.map((entry) => (
                <li key={entry.enrolmentId} className="flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm sm:px-5">
                  <span className="min-w-0 flex-1 text-[var(--color-ink-muted)]">{entry.name}</span>
                  <StatusBadge
                    label={`${entry.status[0]}${entry.status.slice(1).toLowerCase()}${
                      entry.completionDate ? ` ${entry.completionDate.toISOString().slice(0, 10)}` : ''
                    }`}
                    tone="neutral"
                  />
                  {entry.remarks && (
                    <span className="text-xs text-[var(--color-ink-muted)]">{entry.remarks}</span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </main>
  );
}
