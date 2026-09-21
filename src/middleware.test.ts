import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { middleware } from '@/middleware';

/**
 * The Content-Security-Policy.
 *
 * <p>A browser proved this policy refuses a parser-inserted script during development. This
 * suite exists to keep it refusing: the failure mode of a CSP is silent and gradual, because
 * every weakening makes some immediate problem go away and nothing fails when it does.
 */

function policyFor(url = 'http://localhost:3000/sign-in'): string {
  const response = middleware(new NextRequest(url));
  const policy = response.headers.get('content-security-policy');
  if (!policy) throw new Error('No Content-Security-Policy header was set');
  return policy;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the policy', () => {
  it('carries a nonce, and a different one on every response', () => {
    const first = policyFor().match(/'nonce-([^']+)'/)?.[1];
    const second = policyFor().match(/'nonce-([^']+)'/)?.[1];

    expect(first).toBeTruthy();
    // A nonce that repeats is not a nonce: an attacker reads it off one page and reuses it.
    expect(first).not.toBe(second);
  });

  it('gives Next the nonce on the request as well, so it can nonce its own scripts', () => {
    // Next reads the CSP off the request headers and applies the nonce it finds to the script
    // tags it emits. Without this the framework's own scripts are refused and nothing renders.
    const response = middleware(new NextRequest('http://localhost:3000/sign-in'));

    expect(response.headers.get('content-security-policy')).toContain('nonce-');
  });

  it('refuses inline and injected scripts by requiring the nonce', () => {
    const policy = policyFor();

    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-inline' 'nonce"); // never in script-src
    const scriptSrc = policy.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('closes the directives an injected tag would otherwise reach for', () => {
    const policy = policyFor();

    // base-uri: an injected <base> rewrites every relative URL on the page.
    expect(policy).toContain("base-uri 'self'");
    // form-action: without it, injected markup can post a filled-in password to another origin.
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("default-src 'self'");
  });

  it('does not allow eval in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const policy = policyFor();

    // Development needs it for React Fast Refresh. Production must never carry it — with
    // 'unsafe-eval' a string can become code, which is most of what a CSP exists to prevent.
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('allows eval in development only, where Fast Refresh compiles in the browser', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(policyFor()).toContain("'unsafe-eval'");
  });
});
