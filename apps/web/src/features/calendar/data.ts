import 'server-only';

import { apiRequest, type ApiResult } from '@/server/api-client';
import {
  academicYearListSchema,
  termListSchema,
  type AcademicYear,
  type Term,
} from '@/features/calendar/schema';

/** The page to re-render after a mutation. Nothing is cached, so this is a re-fetch. */
export const CALENDAR_PATH = '/settings/calendar';

export async function listAcademicYears(): Promise<ApiResult<AcademicYear[]>> {
  return apiRequest('/api/v1/academic-years', academicYearListSchema);
}

export async function listTerms(academicYearId: string): Promise<ApiResult<Term[]>> {
  return apiRequest(`/api/v1/academic-years/${academicYearId}/terms`, termListSchema);
}
