'use server';

import { revalidatePath } from 'next/cache';

import { apiRequest } from '@/server/api-client';
import { CALENDAR_PATH } from '@/features/calendar/data';
import {
  academicYearSchema,
  createAcademicYearInput,
  createTermInput,
  reasonInput,
  termSchema,
} from '@/features/calendar/schema';

/**
 * Server actions for the academic calendar.
 *
 * <p>Each one validates its input, calls the API, and returns a result the form can render.
 * None of them decides anything: the API re-checks the permission, the state transition and the
 * tenant regardless of what was submitted here. Client-side validation exists so a typo is
 * caught before a round trip — never instead of one.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
}

const SUCCESS: ActionResult = { ok: true };

export async function createAcademicYearAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createAcademicYearInput.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    startsOn: formData.get('startsOn'),
    endsOn: formData.get('endsOn'),
  });

  if (!parsed.success) {
    return { ok: false, message: 'Check the highlighted fields', fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const result = await apiRequest('/api/v1/academic-years', academicYearSchema, {
    method: 'POST',
    body: parsed.data,
  });

  if (!result.ok) return fromApiError(result.error, result.status);

  revalidatePath(CALENDAR_PATH);
  return SUCCESS;
}

export async function createTermAction(
  academicYearId: string,
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const reportsDueOn = formData.get('reportsDueOn');
  const parsed = createTermInput.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    startsOn: formData.get('startsOn'),
    endsOn: formData.get('endsOn'),
    // An empty date input submits "", which is not an absent value and not a valid date.
    ...(typeof reportsDueOn === 'string' && reportsDueOn.length > 0 ? { reportsDueOn } : {}),
  });

  if (!parsed.success) {
    return { ok: false, message: 'Check the highlighted fields', fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const result = await apiRequest(
    `/api/v1/academic-years/${academicYearId}/terms`,
    termSchema,
    { method: 'POST', body: parsed.data },
  );

  if (!result.ok) return fromApiError(result.error, result.status);

  revalidatePath(CALENDAR_PATH);
  return SUCCESS;
}

export async function activateAcademicYearAction(id: string): Promise<ActionResult> {
  const result = await apiRequest(`/api/v1/academic-years/${id}/activate`, academicYearSchema, {
    method: 'POST',
  });
  if (!result.ok) return fromApiError(result.error, result.status);
  revalidatePath(CALENDAR_PATH);
  return SUCCESS;
}

export async function makeAcademicYearCurrentAction(id: string): Promise<ActionResult> {
  const result = await apiRequest(
    `/api/v1/academic-years/${id}/make-current`,
    academicYearSchema,
    { method: 'POST' },
  );
  if (!result.ok) return fromApiError(result.error, result.status);
  revalidatePath(CALENDAR_PATH);
  return SUCCESS;
}

export async function closeAcademicYearAction(
  id: string,
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = reasonInput.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const result = await apiRequest(`/api/v1/academic-years/${id}/close`, academicYearSchema, {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return fromApiError(result.error, result.status);
  revalidatePath(CALENDAR_PATH);
  return SUCCESS;
}

export async function activateTermAction(id: string): Promise<ActionResult> {
  const result = await apiRequest(`/api/v1/terms/${id}/activate`, termSchema, { method: 'POST' });
  if (!result.ok) return fromApiError(result.error, result.status);
  revalidatePath(CALENDAR_PATH);
  return SUCCESS;
}

export async function closeTermAction(
  id: string,
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = reasonInput.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const result = await apiRequest(`/api/v1/terms/${id}/close`, termSchema, {
    method: 'POST',
    body: parsed.data,
  });
  if (!result.ok) return fromApiError(result.error, result.status);
  revalidatePath(CALENDAR_PATH);
  return SUCCESS;
}

// ---------------------------------------------------------------------------------------

function toFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

/**
 * Turns an API error into something a person can act on.
 *
 * <p>The API's own message is used where it exists, because it is written for the person on the
 * other end — "The term ends after the academic year does" is far more useful than "Conflict".
 * The correlation id is appended only for genuine server failures, which is when someone will
 * actually need to quote it.
 */
function fromApiError(error: { code: string; message: string; correlationId?: string | undefined; fieldErrors?: Record<string, string> | undefined }, status: number): ActionResult {
  const isServerFailure = status >= 500;
  const reference = isServerFailure && error.correlationId ? ` (reference ${error.correlationId})` : '';

  if (status === 403) {
    return { ok: false, message: 'You do not have permission to do this.' };
  }
  if (status === 401) {
    return { ok: false, message: 'Your session has ended. Sign in again to continue.' };
  }

  return {
    ok: false,
    message: `${error.message}${reference}`,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
  };
}
