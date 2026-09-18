import 'server-only';

import { z } from 'zod';

import { serverEnv } from '@/env';
import { readActiveMembership, readSessionToken } from '@/server/session';

/**
 * The only path from this application to the core API.
 *
 * Server-only, always. A Client Component that could call the API directly would need the
 * session token in the browser, which is the one thing the `httpOnly` cookie exists to prevent.
 *
 * Every response is parsed with a Zod schema before it is used. The API is our own service, but
 * it is still a trust boundary: a deployment skew where the API has been updated and the web
 * tier has not should surface as a clear parse error naming the field, not as `undefined`
 * rendering into a page as "NaN" next to a fee balance.
 */

/** The canonical error shape the core API returns (`ApiError` on the Java side). */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
  timestamp: z.string().optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError; readonly status: number };

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /** Bearer token to use instead of the session cookie, for the sign-in exchange itself. */
  readonly token?: string;
  /** Membership to act through; defaults to the one on the session cookie. */
  readonly membershipId?: string | null;
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const env = serverEnv();
  const method = options.method ?? 'GET';

  const token = options.token ?? (await readSessionToken());
  const membershipId =
    options.membershipId !== undefined ? options.membershipId : await readActiveMembership();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // A *request* to act as this membership, not an assertion of it: the API verifies it against
  // the memberships the principal actually holds and refuses otherwise.
  if (membershipId) headers['X-Active-Membership'] = membershipId;

  const init: RequestInit = {
    method,
    headers,
    // Never cache anything tenant-scoped. A cached response served to the wrong school is
    // the same disclosure the whole isolation model exists to prevent — which is also why
    // there are no cache tags here: there is nothing cached for them to invalidate.
    cache: 'no-store',
  };
  // Assigned rather than passed as `body: undefined`. Under exactOptionalPropertyTypes an
  // explicit undefined is not the same as an absent property, and `fetch` rejects it.
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${env.CORE_API_BASE_URL}${path}`, init);
  } catch {
    // The API being unreachable is an operational failure, not a user error, and the user
    // should be told that rather than shown an empty page.
    return {
      ok: false,
      status: 503,
      error: {
        code: 'API_UNREACHABLE',
        message: 'The service is temporarily unavailable. Please try again shortly.',
      },
    };
  }

  if (response.status === 204) {
    const empty = schema.safeParse(undefined);
    return empty.success
      ? { ok: true, data: empty.data }
      : { ok: true, data: undefined as T };
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeJsonParse(text) : null;

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    return {
      ok: false,
      status: response.status,
      error: parsed.success
        ? parsed.data
        : {
            code: 'UNEXPECTED_ERROR',
            message: 'Something went wrong. Please try again.',
          },
    };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // A shape mismatch means the web tier and the API disagree about the contract. Failing
    // visibly here beats rendering undefined into a page.
    return {
      ok: false,
      status: 500,
      error: {
        code: 'RESPONSE_SHAPE_MISMATCH',
        message: 'The service returned data this page could not read.',
      },
    };
  }

  return { ok: true, data: parsed.data };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
