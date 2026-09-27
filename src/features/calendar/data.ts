import 'server-only';

import { P } from '@/lib/permissions';
import { requirePermission } from '@/server/auth/session';

/**
 * Reads for the academic calendar.
 *
 * <p>Each one checks its permission first, then queries through the tenant-scoped client. The
 * tenant filter is not written here — it is injected by the client, so it cannot be forgotten.
 */

export const CALENDAR_PATH = '/settings/calendar';

export async function listAcademicYears() {
  const { db } = await requirePermission(P.ACADEMIC_YEAR_VIEW);

  return db.academicYear.findMany({
    orderBy: { startsOn: 'desc' },
    include: {
      terms: { orderBy: { sequence: 'asc' } },
    },
  });
}

export async function getAcademicYear(id: string) {
  const { db } = await requirePermission(P.ACADEMIC_YEAR_VIEW);

  // findUnique is rewritten to a tenant-scoped findFirst by the extension, so naming another
  // school's id returns null rather than their row.
  return db.academicYear.findUnique({
    where: { id },
    include: { terms: { orderBy: { sequence: 'asc' } } },
  });
}

export async function currentAcademicYear() {
  const { db } = await requirePermission(P.ACADEMIC_YEAR_VIEW);
  return db.academicYear.findFirst({ where: { isCurrent: true } });
}

export type AcademicYearWithTerms = Awaited<ReturnType<typeof listAcademicYears>>[number];
export type TermRecord = AcademicYearWithTerms['terms'][number];
