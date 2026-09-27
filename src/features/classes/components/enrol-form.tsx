'use client';

import { useActionState } from 'react';

import { Field, FormMessage, SelectField, SubmitButton } from '@/components/form';
import { enrolStudentAction, type ActionResult } from '@/features/classes/actions';

/** Puts a child on the class roll, which is what makes them appear on its register. */
export function EnrolForm({
  classGroupId,
  students,
  terms,
  defaultDate,
}: {
  classGroupId: string;
  students: ReadonlyArray<{ id: string; label: string }>;
  terms: ReadonlyArray<{ id: string; label: string }>;
  defaultDate: string;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    enrolStudentAction,
    undefined,
  );

  if (students.length === 0) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        Every child already has an enrolment for this term. A child has one enrolment per term —
        choose another term, or close the existing one first to move them.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="classGroupId" value={classGroupId} />

      <div className="min-w-[16rem] flex-1">
        <SelectField
          label="Child"
          name="studentId"
          required
          placeholder="Choose a child"
          options={students.map((student) => ({ value: student.id, label: student.label }))}
          error={state?.fieldErrors?.['studentId']}
        />
      </div>

      <div className="min-w-[12rem]">
        <SelectField
          label="Term"
          name="termId"
          required
          placeholder="Choose the term"
          options={terms.map((term) => ({ value: term.id, label: term.label }))}
          error={state?.fieldErrors?.['termId']}
        />
      </div>

      <Field
        label="From"
        name="enrolmentDate"
        type="date"
        required
        defaultValue={defaultDate}
        error={state?.fieldErrors?.['enrolmentDate']}
      />

      <SubmitButton pendingLabel="Enrolling…">Enrol</SubmitButton>

      {state?.message && (
        <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />
      )}
    </form>
  );
}
