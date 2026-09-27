'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { Field, FormMessage, SubmitButton } from '@/components/form';
import { changePasswordAction, type ActionResult } from '@/features/account/actions';

/**
 * The change-password form.
 *
 * <p>On success it does NOT return to the form. The change advanced `sessionsValidFrom`, so the
 * session that submitted it is already dead — re-rendering the form would hand somebody a
 * screen whose every control fails on use. A plain statement and a link to sign in is the
 * honest end of this flow.
 */
export function ChangePasswordForm({ email }: { email: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    changePasswordAction,
    undefined,
  );

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <FormMessage message={state.message ?? 'Your password is changed.'} tone="success" />
        <Link
          href="/sign-in"
          className="inline-flex min-h-9 items-center justify-center rounded-[var(--radius-control)]
                     border border-transparent bg-[var(--color-primary)] px-3 py-1.5 text-sm
                     font-medium text-[var(--color-primary-ink)] hover:bg-[var(--color-primary-hover)]"
        >
          Sign in again
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      {/* Not read by the action — the account is resolved from the session, never from the
          form. It is here for password managers: without a username field they cannot tell
          which account the new password belongs to, and either save it against the wrong one
          or not offer at all. Hidden, because the page already shows the address above. */}
      <input type="text" name="username" value={email} autoComplete="username" readOnly hidden />

      <Field
        label="Current password"
        name="currentPassword"
        type="password"
        required
        autoComplete="current-password"
        error={state?.fieldErrors?.['currentPassword']}
      />
      <Field
        label="New password"
        name="newPassword"
        type="password"
        required
        autoComplete="new-password"
        hint="At least 12 characters. A short phrase you will remember works well."
        error={state?.fieldErrors?.['newPassword']}
      />
      <Field
        label="Type the new one again"
        name="confirmPassword"
        type="password"
        required
        autoComplete="new-password"
        error={state?.fieldErrors?.['confirmPassword']}
      />

      {state?.message && !state.ok && <FormMessage message={state.message} tone="error" />}

      <p className="text-xs text-[var(--color-ink-muted)]">
        Changing your password signs you out on every device, including this one.
      </p>

      <SubmitButton pendingLabel="Changing your password…">Change password</SubmitButton>
    </form>
  );
}
