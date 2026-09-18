import 'server-only';

import { cookies } from 'next/headers';

/**
 * The session cookie, and the rules that make it safe.
 *
 * The token itself never reaches browser JavaScript. It lives in an `httpOnly` cookie that only
 * this tier can read, and every call to the core API is made server-side with it. That is what
 * keeps an XSS bug in one dashboard from becoming account takeover across a school — script
 * running in the page simply cannot read the credential.
 *
 * The `__Host-` prefix is not decoration: browsers refuse to accept such a cookie unless it is
 * Secure, path `/`, and carries no `Domain` attribute. That last point matters most here, because
 * schools are served on subdomains — a cookie scoped to `.sankofa.school` would be sent to every
 * tenant's subdomain, which is precisely the leak the whole tenancy model exists to prevent.
 */

const SESSION_COOKIE = '__Host-sankofa-session';
const MEMBERSHIP_COOKIE = '__Host-sankofa-membership';

/**
 * In development the site is served over plain HTTP on localhost, where a `__Host-` cookie
 * cannot be set at all. The prefix is dropped there and only there.
 */
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = isProduction ? SESSION_COOKIE : 'sankofa-session';
const membershipCookieName = isProduction ? MEMBERSHIP_COOKIE : 'sankofa-membership';

export interface SessionCookieOptions {
  readonly expiresAt: Date;
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(sessionCookieName)?.value ?? null;
}

export async function readActiveMembership(): Promise<string | null> {
  const store = await cookies();
  return store.get(membershipCookieName)?.value ?? null;
}

export async function writeSession(token: string, options: SessionCookieOptions): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName, token, {
    httpOnly: true,
    secure: isProduction,
    // Lax, not None: the API is same-site, and None would make the cookie available to
    // cross-site requests for no benefit.
    sameSite: 'lax',
    path: '/',
    expires: options.expiresAt,
  });
}

/**
 * Records which school the session is acting as.
 *
 * Readable by scripts on purpose — it is a routing hint, not a credential. The server re-checks
 * the membership against the authenticated principal on every request, so a user editing this
 * cookie gains nothing but a 404.
 */
export async function writeActiveMembership(
  membershipId: string,
  options: SessionCookieOptions,
): Promise<void> {
  const store = await cookies();
  store.set(membershipCookieName, membershipId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: options.expiresAt,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(sessionCookieName);
  store.delete(membershipCookieName);
}
