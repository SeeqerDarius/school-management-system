import { describe, expect, it } from 'vitest';

import {
  hashInvitationToken,
  INVITATION_TTL_MS,
  invitationUrl,
  isInvitationExpired,
  issueInvitation,
} from '@/lib/invitation';

/**
 * Invitation tokens.
 *
 * <p>This token is the only thing between an anonymous visitor and an account inside a school,
 * so the properties asserted here are the ones that make it worth anything: unpredictable, never
 * stored in a usable form, and finite.
 */

describe('issuing', () => {
  it('never produces the same token twice', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => issueInvitation().token));

    expect(tokens.size).toBe(200);
  });

  it('produces a token long enough to be out of reach of guessing', () => {
    const { token } = issueInvitation();

    // 32 bytes base64url — 43 characters, 256 bits. Short enough to paste, far past brute force.
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a hash that is not the token', () => {
    const { token, tokenHash } = issueInvitation();

    // The point of the whole arrangement: a leaked database row is not a working invitation.
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('expires seven days out', () => {
    const now = new Date('2026-09-21T12:00:00Z');

    const { expiresAt } = issueInvitation(now);

    expect(expiresAt.getTime() - now.getTime()).toBe(INVITATION_TTL_MS);
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('hashing', () => {
  it('is deterministic, so redemption can find the row', () => {
    const { token, tokenHash } = issueInvitation();

    expect(hashInvitationToken(token)).toBe(tokenHash);
  });

  it('gives different tokens different hashes', () => {
    expect(hashInvitationToken('a')).not.toBe(hashInvitationToken('b'));
  });
});

describe('expiry', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms);

  it('is not expired a moment before', () => {
    expect(isInvitationExpired(at(1), now)).toBe(false);
  });

  it('is expired exactly on the boundary', () => {
    // Inclusive on purpose: at the instant it runs out, it has run out.
    expect(isInvitationExpired(at(0), now)).toBe(true);
  });

  it('is expired after', () => {
    expect(isInvitationExpired(at(-1), now)).toBe(true);
  });

  it('treats a missing expiry as expired rather than as "never expires"', () => {
    // The only way to reach this is a row written wrong, and the safe reading of a credential
    // with no stated lifetime is that it has none left.
    expect(isInvitationExpired(null, now)).toBe(true);
  });
});

describe('the link', () => {
  it('points at the accept page with the token in the query', () => {
    expect(invitationUrl('https://school.example', 'abc123')).toBe(
      'https://school.example/accept-invitation?token=abc123',
    );
  });

  it('does not produce a double slash when the origin has a trailing one', () => {
    expect(invitationUrl('https://school.example/', 'abc')).toBe(
      'https://school.example/accept-invitation?token=abc',
    );
  });

  it('escapes a token so it survives the URL intact', () => {
    // base64url never produces these, but a link that silently corrupts its own token would
    // fail in a way nobody could diagnose from the error.
    expect(invitationUrl('https://s.example', 'a+b/c=')).toContain('token=a%2Bb%2Fc%3D');
  });
});
