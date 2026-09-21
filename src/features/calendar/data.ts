import 'server-only';

import { P } from '@/lib/permissions';
import { requirePermission } from '@/server/auth/session';

/**
 * Reads for the academic calendar.
 *
 * <p>Each one checks its permission first, then queries inside a tenant-bound transaction. The
 * tenant filter is not written here — the client injects it and the database's policies enforce
 * it, so it cannot be forgotten in either place.
 */

export const CALENDAR_PATH = '/settings/calendar';

export async function listAcademicYears() {
  const { transaction } = await requirePermission(P.ACADEMIC_YEAR_VIEW);

  return transaction((db) =>
    db.academicYear.findMany({
      orderBy: { startsOn: 'desc' },
      include: {
        terms: { orderBy: { sequence: 'asc' } },
      },
    }),
  );
}

export async function getAcademicYear(id: string) {
  const { transaction } = await requirePermission(P.ACADEMIC_YEAR_VIEW);

  // The extension adds the tenant to the where clause, so naming another school's id returns
  // null rather than their row. The policies refuse it a second time inside the database.
  return transaction((db) =>
    db.academicYear.findUnique({
      where: { id },
      include: { terms: { orderBy: { sequence: 'asc' } } },
    }),
  );
}

export async function currentAcademicYear() {
  const { transaction } = await requirePermission(P.ACADEMIC_YEAR_VIEW);
  return transaction((db) => db.academicYear.findFirst({ where: { isCurrent: true } }));
}

export type AcademicYearWithTerms = Awaited<ReturnType<typeof listAcademicYears>>[number];
export type TermRecord = AcademicYearWithTerms['terms'][number];
