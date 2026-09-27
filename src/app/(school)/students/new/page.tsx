import Link from 'next/link';

import { createStudentFromForm } from '@/features/students/actions';
import { getStudentCampuses } from '@/features/students/data';

export default async function NewStudentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, campuses] = await Promise.all([searchParams, getStudentCampuses()]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/students" className="text-sm text-blue-800 underline underline-offset-2">Back to students</Link>
      <h1 className="mt-4 text-3xl font-bold">Admit a student</h1>
      <p className="mt-2 text-gray-600">Enter the student’s core information. Add guardians and enrolment details from the student profile.</p>
      {error === 'invalid' && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-red-900">Check the required fields and try again.</p>}
      {campuses.length === 0 ? (
        <p className="mt-6 rounded-md bg-amber-50 p-4 text-amber-950">This school has no active campus. Ask a school administrator to activate a campus before admitting students.</p>
      ) : (
        <form action={createStudentFromForm} className="mt-6 space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
          <div>
            <label htmlFor="campusId" className="mb-1 block text-sm font-medium">Campus</label>
            <select id="campusId" name="campusId" required className="w-full rounded-md border border-gray-300 px-3 py-2">
              {campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name} ({campus.code})</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className="mb-1 block text-sm font-medium">First name</label>
              <input id="firstName" name="firstName" required maxLength={100} autoComplete="given-name" className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label htmlFor="lastName" className="mb-1 block text-sm font-medium">Last name</label>
              <input id="lastName" name="lastName" required maxLength={100} autoComplete="family-name" className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label htmlFor="preferredName" className="mb-1 block text-sm font-medium">Preferred name <span className="font-normal text-gray-500">(optional)</span></label>
              <input id="preferredName" name="preferredName" maxLength={100} className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label htmlFor="dateOfBirth" className="mb-1 block text-sm font-medium">Date of birth</label>
              <input id="dateOfBirth" name="dateOfBirth" type="date" required className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label htmlFor="gender" className="mb-1 block text-sm font-medium">Gender</label>
              <select id="gender" name="gender" required className="w-full rounded-md border border-gray-300 px-3 py-2">
                <option value="">Choose an option</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
                <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label htmlFor="admissionDate" className="mb-1 block text-sm font-medium">Admission date <span className="font-normal text-gray-500">(optional)</span></label>
              <input id="admissionDate" name="admissionDate" type="date" className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="previousSchool" className="mb-1 block text-sm font-medium">Previous school <span className="font-normal text-gray-500">(optional)</span></label>
              <input id="previousSchool" name="previousSchool" maxLength={255} className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
          </div>
          <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
            <Link href="/students" className="rounded-md border border-gray-300 px-4 py-2 text-center font-medium">Cancel</Link>
            <button type="submit" className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">Create student record</button>
          </div>
        </form>
      )}
    </main>
  );
}
