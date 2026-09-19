'use client';

import { useActionState, useState, useTransition } from 'react';

import { Button, Field, FormMessage, SubmitButton } from '@/components/form';
import { activateTermAction, closeTermAction, type ActionResult } from '@/features/calendar/actions';
import type { CalendarStatus } from '@/lib/calendar-status';

/** Row-level actions for a term. Mirrors {@link YearActionBar}, scaled to a table cell. */
export function TermActionBar({
  id,
  status,
  allowedTransitions,
}: {
  id: string;
  status: CalendarStatus;
  allowedTransitions: readonly CalendarStatus[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  if (status === 'CLOSED') {
    return <span className="text-xs text-[var(--color-ink-subtle)]">No further action</span>;
  }

  const canActivate = allowedTransitions.includes('ACTIVE');
  const canClose = allowedTransitions.includes('CLOSED');

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? 'That could not be completed.');
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex justify-end gap-2">
        {canActivate && (
          <Button disabled={pending} onClick={() => run(() => activateTermAction(id))}>
            Activate
          </Button>
        )}
        {canClose && (
          <Button
            variant="danger"
            disabled={pending}
            aria-expanded={closing}
            onClick={() => setClosing((open) => !open)}
          >
            Close…
          </Button>
        )}
      </div>

      {error && (
        <div className="text-right">
          <FormMessage message={error} tone="error" />
        </div>
      )}

      {closing && <CloseTermForm id={id} onCancel={() => setClosing(false)} />}
    </div>
  );
}

function CloseTermForm({ id, onCancel }: { id: string; onCancel: () => void }) {
  const boundAction = closeTermAction.bind(null, id);
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    boundAction,
    undefined,
  );

  return (
    <form
      action={formAction}
      className="w-full max-w-sm rounded-[var(--radius-control)] border border-[var(--color-danger)]
                 bg-[var(--color-danger-subtle)] p-3 text-left"
    >
      <Field
        label="Why are you closing this term?"
        name="reason"
        required
        placeholder="Term completed"
        hint="Recorded in the audit trail"
        error={state?.fieldErrors?.['reason']}
      />

      {state && !state.ok && state.message && (
        <div className="mt-2">
          <FormMessage message={state.message} tone="error" />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <SubmitButton variant="danger" pendingLabel="Closing…">
          Close term
        </SubmitButton>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
