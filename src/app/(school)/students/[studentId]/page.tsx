import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getStudentById } from '@/features/students/data';

function dateLabel(value: Date | null) {
  return value ? new Intl.DateTimeFormat('en-GH', { dateStyle: 'medium', timeZone: 'UTC' }).format(value) : 'Not recorded';
}

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const student = await getStudentById(studentId);
  if (!student) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/students" className="text-sm text-blue-800 underline underline-offset-2">Back to students</Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-600">{student.reference} · {student.campus.name}</p>
          <h1 className="mt-1 text-3xl font-bold">{student.preferredName || student.firstName} {student.lastName}</h1>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-900">{student.status.replaceAll('_', ' ')}</span>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="student-details" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 id="student-details" className="text-lg font-semibold">Student details</h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><dt className="text-sm text-gray-600">Date of birth</dt><dd className="mt-1 font-medium">{dateLabel(student.dateOfBirth)}</dd></div>
            <div><dt className="text-sm text-gray-600">Gender</dt><dd className="mt-1 font-medium">{student.gender.replaceAll('_', ' ')}</dd></div>
            <div><dt className="text-sm text-gray-600">Admission date</dt><dd className="mt-1 font-medium">{dateLabel(student.admissionDate)}</dd></div>
            <div><dt className="text-sm text-gray-600">Admission number</dt><dd className="mt-1 font-medium">{student.admissionNumber || 'Not assigned'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-sm text-gray-600">Previous school</dt><dd className="mt-1 font-medium">{student.previousSchool || 'Not recorded'}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="guardians" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 id="guardians" className="text-lg font-semibold">Guardians</h2>
          {student.guardianships.length === 0 ? (
            <p className="mt-3 text-sm text-gray-600">No guardian is linked to this student yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-200">
              {student.guardianships.map(({ guardian, relationshipType, isPrimary, isEmergency }) => (
                <li key={guardian.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-medium">{guardian.preferredName || guardian.firstName} {guardian.lastName}{isPrimary ? ' · Primary' : ''}</p>
                  <p className="text-sm text-gray-600">{relationshipType.replaceAll('_', ' ')}{isEmergency ? ' · Emergency contact' : ''}</p>
                  <p className="text-sm text-gray-700">{guardian.phoneE164}{guardian.email ? ` · ${guardian.email}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="enrolments" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 id="enrolments" className="text-lg font-semibold">Enrolment history</h2>
          {student.enrollments.length === 0 ? (
            <p className="mt-3 text-sm text-gray-600">No enrolments have been recorded.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead><tr className="border-b text-gray-600"><th scope="col" className="py-2 pr-4">Academic year</th><th scope="col" className="py-2 pr-4">Term</th><th scope="col" className="py-2 pr-4">Campus</th><th scope="col" className="py-2 pr-4">Grade / section</th><th scope="col" className="py-2">Status</th></tr></thead>
                <tbody>{student.enrollments.map((enrolment) => <tr key={enrolment.id} className="border-b last:border-0"><td className="py-3 pr-4">{enrolment.academicYear.name}</td><td className="py-3 pr-4">{enrolment.term.name}</td><td className="py-3 pr-4">{enrolment.campus.name}</td><td className="py-3 pr-4">{[enrolment.gradeLevel, enrolment.section].filter(Boolean).join(' / ') || 'Not assigned'}</td><td className="py-3">{enrolment.status.replaceAll('_', ' ')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
