import { createHash, randomBytes } from 'node:crypto';

/**
 * Invitation tokens.
 *
 * <p>Accounts are invited, never self-registered, so this token is the only thing standing
 * between an anonymous visitor and an account inside a school. It is treated accordingly.
 *
 * <h2>Why a plain SHA-256 and not bcrypt</h2>
 * A password is low-entropy and guessable, which is what bcrypt's work factor defends against.
 * This token is 32 bytes from a CSPRNG — 256 bits, with no structure to attack — so the cost of
 * guessing it is already beyond reach and a slow hash would buy nothing while making every
 * redemption lookup expensive. What matters is that the *database* stores only the digest, so a
 * leaked table or a stray backup does not hand anybody a working invitation.
 *
 * <h2>Why it expires</h2>
 * An invitation is a standing offer of access. One issued for a teacher who then never joined is
 * a credential nobody is tracking and nobody will revoke, sitting in an inbox indefinitely.
 */

/**
 * Seven days.
 *
 * <p>Long enough for somebody who was invited on a Friday and reads it after the weekend, or who
 * is offline for a few days — which in the schools this is built for is ordinary rather than
 * exceptional. Short enough that a forgotten invitation stops working within a term.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssuedInvitation {
  /** Handed to the person once, and never stored. */
  token: string;
  /** What goes in the database. */
  tokenHash: string;
  expiresAt: Date;
}

/** 32 random bytes, URL-safe, plus the digest to store and the moment it stops working. */
export function issueInvitation(now: Date = new Date()): IssuedInvitation {
  const token = randomBytes(32).toString('base64url');

  return {
    token,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
  };
}

/** The digest stored against the user. Deterministic, so redemption can look the row up. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether an invitation has run out.
 *
 * <p>A null expiry is treated as expired rather than as "never expires". The safe reading of
 * missing data on a credential is that it is not valid — and the only way to get a null here is
 * a row that was written wrong.
 */
export function isInvitationExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}

/** The link a person follows. Built from the configured origin, never from a request header. */
export function invitationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(token)}`;
}
