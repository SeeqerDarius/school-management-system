'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button, FormMessage } from '@/components/form';

export interface SchoolChoice {
  membershipId: string;
  displayName: string;
  slug: string;
  /** How this person relates to the school — staff, parent, student. */
  role: string;
}

/**
 * Choosing which school to act in.
 *
 * <p>The choice is sent to the server, which checks the membership belongs to this user before
 * putting it in the token. The list rendered here is a convenience; it is not what grants access,
 * and a request naming a membership that is not theirs is simply refused.
 */
export function SchoolPicker({ choices, next }: { choices: SchoolChoice[]; next: string }) {
  const { update } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One school is not a choice. React runs effects twice in development, so this guards against
  // firing the switch twice.
  const autoSelected = useRef(false);
  const only = choices.length === 1 ? choices[0] : undefined;

  useEffect(() => {
    if (!only || autoSelected.current) return;
    autoSelected.current = true;
    void choose(only.membershipId);
    // `choose` is stable for the lifetime of this component; re-running on its identity would
    // re-trigger the switch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only]);

  async function choose(membershipId: string) {
    setError(null);
    setPending(membershipId);
    try {
      await update({ activeMembershipId: membershipId });
      router.replace(next);
      router.refresh();
    } catch {
      setError('That school could not be opened. Try again.');
      setPending(null);
    }
  }

  if (choices.length === 0) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        Your account is not linked to a school yet. Whoever invited you can add you to one.
      </p>
    );
  }

  if (only) {
    return (
      <p role="status" className="text-sm text-[var(--color-ink-muted)]">
        Opening {only.displayName}…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <FormMessage message={error} tone="error" />}

      <ul className="space-y-2">
        {choices.map((choice) => (
          <li key={choice.membershipId}>
            <Button
              className="w-full justify-between text-left"
              disabled={pending !== null}
              onClick={() => void choose(choice.membershipId)}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{choice.displayName}</span>
                <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                  {choice.role}
                </span>
              </span>
              {pending === choice.membershipId && (
                <span role="status" className="ml-3 text-xs text-[var(--color-ink-muted)]">
                  Opening…
                </span>
              )}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
