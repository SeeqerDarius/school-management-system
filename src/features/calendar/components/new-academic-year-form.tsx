'use client';

import { useActionState } from 'react';

import { Field, FormMessage, SubmitButton } from '@/components/form';
import { createAcademicYearAction, type ActionResult } from '@/features/calendar/actions';

/**
 * Creates an academic year.
 *
 * <p>A plain `<form>` bound to a Server Action, so it works before JavaScript has loaded and
 * keeps working if it never does. That is not a theoretical concern for a product used on
 * inexpensive phones over intermittent mobile data.
 */
export function NewAcademicYearForm() {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    createAcademicYearAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Code"
          name="code"
          required
          placeholder="2026/2027"
          hint="A short reference, unique within your school"
          error={state?.fieldErrors?.['code']}
        />
        <Field
          label="Name"
          name="name"
          required
          placeholder="2026/2027 Academic Year"
          error={state?.fieldErrors?.['name']}
        />
        <Field
          label="Starts on"
          name="startsOn"
          type="date"
          required
          error={state?.fieldErrors?.['startsOn']}
        />
        <Field
          label="Ends on"
          name="endsOn"
          type="date"
          required
          error={state?.fieldErrors?.['endsOn']}
        />
      </div>

      {state && !state.ok && state.message && (
        <FormMessage message={state.message} tone="error" />
      )}
      {state?.ok && <FormMessage message="Academic year created." tone="success" />}

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Creating…">Create academic year</SubmitButton>
        <p className="text-xs text-[var(--color-ink-muted)]">
          It starts as <strong>Planned</strong>. Nothing is scheduled against it until you
          activate it.
        </p>
      </div>
    </form>
  );
}
