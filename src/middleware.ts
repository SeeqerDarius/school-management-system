import { type NextRequest, NextResponse } from 'next/server';

/**
 * Content-Security-Policy, with a per-request nonce.
 *
 * <h2>Why this cannot live in next.config.ts</h2>
 * The other security headers are static and are declared there. A nonce cannot be: it has to be
 * unpredictable and different on every response, or it is not a nonce — a fixed value in the
 * config is one an attacker reads from the page source and reuses. So the CSP is issued here,
 * where each request can carry its own.
 *
 * <h2>How the nonce reaches Next's own scripts</h2>
 * Next.js reads the `Content-Security-Policy` header off the *request* and applies the nonce it
 * finds there to the script tags it emits. That is why the header is set twice: once on the
 * forwarded request headers so the framework can see it, and once on the response, which is the
 * one the browser enforces. Application code that needs it can read `x-nonce`.
 *
 * <h2>The directives, and what each is actually for</h2>
 * `'strict-dynamic'` is the load-bearing one. With it, a script the browser trusts because of
 * its nonce may load further scripts, and the host allow-list is ignored — which is what makes
 * Next's chunk loading work without listing every chunk. It also means an injected
 * `<script src>` without the nonce is refused no matter where it points, so the usual bypass of
 * finding a permissive host on the allow-list does not exist here.
 *
 * `style-src` keeps `'unsafe-inline'`, and that is a real weakening stated rather than hidden.
 * Next injects inline styles during hydration and for font loading; nonce-ing them is not
 * reliably supported, and the honest choice is between an inline-style allowance and a policy
 * so broken it gets removed in a fortnight. Injected CSS can restyle and exfiltrate through
 * selectors, but it cannot execute — so this is a smaller hole than the one being closed, not
 * an equivalent trade.
 *
 * `connect-src 'self'` holds because the browser never talks to another origin: the database is
 * reached from Server Components and Server Actions. If that ever stops being true, this line is
 * the one that will say so, loudly, in the console.
 */

/** Paths that are files rather than pages. A policy on a static asset protects nothing. */
export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

function buildPolicy(nonce: string, isDevelopment: boolean): string {
  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' is development only: React Fast Refresh compiles in the browser. It is
    // never present in a production response, and the test asserts that rather than trusting it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // No plugins, no embedded objects, and nothing may frame this application. The last one
    // duplicates X-Frame-Options on purpose: frame-ancestors is the directive browsers actually
    // honour now, and the older header stays for anything that does not support it.
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Stops an injected <base> rewriting every relative URL on the page, which is how a script
    // that cannot be injected directly gets loaded anyway.
    "base-uri 'self'",
    // A form on this application may only post back to it. Without this, injected markup can
    // exfiltrate a filled-in form — including a password — to another origin.
    "form-action 'self'",
  ];

  if (!isDevelopment) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function middleware(request: NextRequest) {
  // 16 bytes of CSPRNG, base64. Web Crypto rather than node:crypto because middleware runs on
  // the edge runtime, where node:crypto is not available.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const policy = buildPolicy(nonce, process.env.NODE_ENV === 'development');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Read by Next itself, to nonce the scripts it emits. Not what the browser enforces.
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // This one is what the browser enforces.
  response.headers.set('Content-Security-Policy', policy);

  return response;
}
