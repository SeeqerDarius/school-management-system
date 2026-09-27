import Link from 'next/link';

import { ErrorState, PageHeader } from '@/components/ui';
import { isFamilyPrincipal } from '@/lib/student-visibility';
import { hasPermission, requireActiveSession } from '@/server/auth/session';
import { P } from '@/lib/permissions';
import { getStudents } from '@/features/students/data';
import { studentListQuerySchema } from '@/features/students/schema';

/**
 * Student management page.
 * Displays a list of students with filtering and pagination.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; campusId?: string; search?: string; page?: string; created?: string }>;
}) {
  const params = await searchParams;
  const session = await requireActiveSession();

  // Said here rather than thrown from the query. Somebody without STUDENT_READ reaching this
  // page is not an error condition — it is somebody who does not do this job — and throwing
  // turned that into a 500 with a digest for six of the eight demo accounts: the headmaster,
  // the bursar, the finance manager, the registrar, both class teachers and the parent.
  if (!isFamilyPrincipal(session.principalType) && !session.permissions.has(P.STUDENT_READ)) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Students" />
        <ErrorState
          title="The student register is not part of your role"
          detail="If you need to look a child up, ask whoever administers this school."
        />
      </main>
    );
  }

  const canCreate = await hasPermission(P.STUDENT_CREATE);
  const parsed = studentListQuerySchema.safeParse({
    status: params.status || undefined,
    campusId: params.campusId || undefined,
    search: params.search || undefined,
    page: params.page ? Number(params.page) : 1,
    limit: 20,
  });
  const query = parsed.success ? parsed.data : studentListQuerySchema.parse({ page: 1, limit: 20 });

  const { students, total, page, totalPages } = await getStudents(query);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
        <h1 className="text-3xl font-bold">Students</h1>
        <p className="text-gray-600 mt-2">
          Manage student records, guardians, and enrolments
        </p>
        </div>
        {canCreate && <Link href="/students/new" className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">Add student</Link>}
      </div>

      {params.created === '1' && <p role="status" className="mb-4 rounded-md bg-green-50 p-3 text-green-900">Student admitted successfully.</p>}
      {!parsed.success && <p role="alert" className="mb-4 rounded-md bg-amber-50 p-3 text-amber-950">Some filters were invalid. Showing the full student list.</p>}

      {/* Filters */}
      <form method="get" className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor="student-search" className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <input
              type="text"
              id="student-search"
              name="search"
              defaultValue={query.search}
              placeholder="Search by name or reference..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label htmlFor="student-status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              name="status"
              id="student-status"
              defaultValue={query.status ?? ''}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">All Statuses</option>
              <option value="PROSPECTIVE">Prospective</option>
              <option value="ENROLLED">Enrolled</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="WITHDRAWN">Withdrawn</option>
              <option value="GRADUATED">Graduated</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Search
            </button>
          </div>
          <div className="hidden md:block" aria-hidden="true" />
        </div>
      </form>

      {/* Student List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reference
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campus
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Guardians
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No students found. Create your first student to get started.
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {student.reference}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {student.firstName} {student.lastName}
                      </div>
                      {student.preferredName && (
                        <div className="text-sm text-gray-500">
                        <span>&quot;{student.preferredName}&quot;</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {student.campus.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        student.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        student.status === 'PROSPECTIVE' ? 'bg-yellow-100 text-yellow-800' :
                        student.status === 'SUSPENDED' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {student.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {student.guardianships.length} guardian(s)
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link href={`/students/${student.id}`} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">View profile</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing {((page - 1) * 20) + 1} to {Math.min(page * 20, total)} of {total} results
              </div>
              <div className="flex space-x-2">
                {page > 1 && (
                  <a
                    href={`?${new URLSearchParams({ ...(query.status ? { status: query.status } : {}), ...(query.search ? { search: query.search } : {}), ...(query.campusId ? { campusId: query.campusId } : {}), page: String(page - 1) })}`}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    Previous
                  </a>
                )}
                {page < totalPages && (
                  <a
                    href={`?${new URLSearchParams({ ...(query.status ? { status: query.status } : {}), ...(query.search ? { search: query.search } : {}), ...(query.campusId ? { campusId: query.campusId } : {}), page: String(page + 1) })}`}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    Next
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
