'use client';

import { signOut } from 'next-auth/react';
import { useState } from 'react';

/**
 * Signing out.
 *
 * <p>A button rather than a link, because signing out changes state and a link that changes state
 * is one that a prefetcher, a crawler or a mistyped keystroke can trigger on someone's behalf.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signOut({ callbackUrl: '/sign-in' });
      }}
      className="rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm text-[var(--color-ink-muted)]
                 hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]
                 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
