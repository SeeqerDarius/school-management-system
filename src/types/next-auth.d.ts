import type { PrincipalType } from '@prisma/client';
import 'next-auth';
import 'next-auth/jwt';

/**
 * Shapes the session this application actually uses.
 *
 * <p>Everything here is derived server-side from the database on each request — the client
 * cannot put anything into it. `permissions` in particular is a convenience for deciding what
 * to render; it is never what decides whether an action is allowed. That check happens on the
 * server regardless of what the client believes.
 */
declare module 'next-auth' {
  interface Session {
    userId?: string;
    /** The membership this request acts through, or null before a school is chosen. */
    activeMembershipId?: string | null;
    tenantId?: string;
    tenantSlug?: string;
    /** Effective permission codes for the active membership. Render hints only. */
    permissions?: string[];
    memberships?: {
      id: string;
      tenantId: string;
      principalType: PrincipalType;
      tenant: { slug: string; displayName: string };
    }[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    activeMembershipId?: string | null;
    /** Compared against the account's session cut-off, so a revocation takes effect at once. */
    issuedAt?: number;
  }
}
