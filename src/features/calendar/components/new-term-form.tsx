'use client';

import { useActionState } from 'react';

import { Field, FormMessage, SubmitButton } from '@/components/form';
import { createTermAction, type ActionResult } from '@/features/calendar/actions';

/**
 * Adds a term to an academic year.
 *
 * <p>The year id is bound server-side with `bind`, so it is never a form field the browser could
 * change. Even if it were, the action resolves the year through the tenant-scoped client and
 * would find nothing for another school — but keeping it out of the form is the cheaper guarantee.
 */
export function NewTermForm({ academicYearId }: { academicYearId: string }) {
  const boundAction = createTermAction.bind(null, academicYearId);
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    boundAction,
    undefined,
  );

  return (
    <details className="group">
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-control)]
                   px-2 py-1 text-sm font-medium text-[var(--color-primary)]
                   hover:bg-[var(--color-primary-subtle)]"
      >
        <span aria-hidden="true" className="transition-transform group-open:rotate-45">
          +
        </span>
        Add a term
      </summary>

      <form action={formAction} className="mt-3 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="Code"
            name="code"
            required
            placeholder="T1"
            error={state?.fieldErrors?.['code']}
          />
          <Field
            label="Name"
            name="name"
            required
            placeholder="First Term"
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
          <Field
            label="Reports due"
            name="reportsDueOn"
            type="date"
            hint="Optional"
            error={state?.fieldErrors?.['reportsDueOn']}
          />
        </div>

        {state && !state.ok && state.message && (
          <FormMessage message={state.message} tone="error" />
        )}
        {state?.ok && <FormMessage message="Term added." tone="success" />}

        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Adding…">Add term</SubmitButton>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Terms must fall inside the academic year’s dates and may not overlap each other.
          </p>
        </div>
      </form>
    </details>
  );
}
