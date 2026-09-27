'use client';

import { useActionState } from 'react';

import { FormMessage, SubmitButton, TextAreaField } from '@/components/form';
import { lockRegisterAction, type ActionResult } from '@/features/attendance/actions';

/**
 * Locking a register.
 *
 * <p>The reason field asks what the register has been used for rather than why it is being
 * locked, because that is the question somebody will ask later when they want it reopened — and
 * the answer is that it cannot be. A wrong lock is corrected the way a posted journal is: by a
 * later record, never by an edit.
 */
export function LockRegisterForm({
  registerId,
}: {
  registerId: string;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    lockRegisterAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="registerId" value={registerId} />

      <TextAreaField
        label="What this register has been used for"
        name="reason"
        required
        rows={2}
        error={state?.fieldErrors?.reason}
        hint="A term summary, a statutory return, a report card. Recorded in the audit log."
      />

      {state?.message && (
        <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />
      )}

      <div>
        <SubmitButton variant="danger" pendingLabel="Locking…">
          Lock permanently
        </SubmitButton>
      </div>
    </form>
  );
}
