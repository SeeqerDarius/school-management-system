'use client';

import { useActionState } from 'react';

import { Field, FormMessage, SelectField, SubmitButton } from '@/components/form';
import { endEnrolmentAction, type ActionResult } from '@/features/classes/actions';

/**
 * Ends one child's enrolment.
 *
 * <p>Ends rather than removes. Last term's register has to keep saying who was in the room, and
 * deleting the enrolment would leave marks attached to a child nobody can explain the presence
 * of.
 */
export function EndEnrolmentForm({
  enrolmentId,
  defaultDate,
}: {
  enrolmentId: string;
  defaultDate: string;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    endEnrolmentAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="enrolmentId" value={enrolmentId} />

      <Field
        label="Last day"
        name="completionDate"
        type="date"
        required
        defaultValue={defaultDate}
        error={state?.fieldErrors?.['completionDate']}
      />
      <div className="min-w-[10rem]">
        <SelectField
          label="Outcome"
          name="status"
          required
          defaultValue="COMPLETED"
          options={[
            { value: 'COMPLETED', label: 'Completed the term' },
            { value: 'WITHDRAWN', label: 'Withdrawn' },
            { value: 'SUSPENDED', label: 'Suspended' },
          ]}
          error={state?.fieldErrors?.['status']}
        />
      </div>
      <div className="min-w-[12rem] flex-1">
        <Field
          label="Why"
          name="remarks"
          required
          placeholder="Moved to B5B"
          error={state?.fieldErrors?.['remarks']}
        />
      </div>

      <SubmitButton variant="danger" pendingLabel="Ending…">
        End
      </SubmitButton>

      {state?.message && (
        <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />
      )}
    </form>
  );
}
