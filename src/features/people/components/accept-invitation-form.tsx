'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { Field, FormMessage, SubmitButton } from '@/components/form';
import { redeemInvitationAction, type ActionResult } from '@/features/people/actions';

/**
 * Sets a password against an invitation.
 *
 * <p>The token rides in a hidden field rather than being read from the URL inside the action,
 * because a Server Action does not get the page's query string. It is not a secret from the
 * person using this page — they followed a link containing it.
 */
export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    redeemInvitationAction,
    undefined,
  );

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <FormMessage message={state.message ?? 'Your password is set.'} tone="success" />
        <Link
          href="/sign-in"
          className="inline-flex min-h-9 items-center justify-center rounded-[var(--radius-control)]
                     border border-transparent bg-[var(--color-primary)] px-3 py-1.5 text-sm
                     font-medium text-[var(--color-primary-ink)] hover:bg-[var(--color-primary-hover)]"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Field
        label="Choose a password"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        hint="At least 12 characters. A short phrase you will remember works well."
        error={state?.fieldErrors?.['password']}
      />
      <Field
        label="Type it again"
        name="confirmPassword"
        type="password"
        required
        autoComplete="new-password"
        error={state?.fieldErrors?.['confirmPassword']}
      />

      {state?.message && !state.ok && <FormMessage message={state.message} tone="error" />}
      {state?.fieldErrors?.['token'] && (
        <FormMessage message={state.fieldErrors['token']} tone="error" />
      )}

      <SubmitButton pendingLabel="Setting your password…">Set password</SubmitButton>
    </form>
  );
}
