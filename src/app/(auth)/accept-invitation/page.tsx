import type { Metadata } from 'next';

import { AcceptInvitationForm } from '@/features/people/components/accept-invitation-form';

export const metadata: Metadata = { title: 'Accept your invitation' };

/**
 * Where an invitation link lands.
 *
 * <p>Public by necessity — the whole point is that the person has no account yet. It deliberately
 * reveals nothing: not whether the token is valid, not which school issued it, not whose address
 * it was sent to. A page that greeted somebody by name would confirm an address to anybody
 * holding a guessed link, and one that said "this school invited you" would leak the customer
 * list to anyone probing.
 *
 * <p>Whether the token is real is decided by the action, on submission, and both "no such token"
 * and "expired" come back as the same sentence.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--color-ink)]">Set your password</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          You were invited to a school on Sankofa. Choose a password to finish setting up your
          account.
        </p>
      </header>

      {token ? (
        <AcceptInvitationForm token={token} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-danger)]">
            This link is missing its invitation code. Open the link you were sent exactly as it
            was given to you, without editing it.
          </p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            If it still does not work, ask whoever invited you to send a new one.
          </p>
        </div>
      )}
    </div>
  );
}
