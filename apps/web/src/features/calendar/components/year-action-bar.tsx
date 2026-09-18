'use client';

import { useActionState, useState, useTransition } from 'react';

import { Button, Field, FormMessage, SubmitButton } from '@/components/form';
import {
  activateAcademicYearAction,
  closeAcademicYearAction,
  makeAcademicYearCurrentAction,
  type ActionResult,
} from '@/features/calendar/actions';
import type { CalendarStatus } from '@/features/calendar/schema';

/**
 * What can be done to an academic year right now.
 *
 * <p>The buttons are derived from `allowedTransitions`, which the server computed from the same
 * state machine the API enforces. The UI never decides what is legal — it only stops offering
 * what would be refused, which is a courtesy to the user, not a security control (§98).
 *
 * <p>Closing is behind a typed reason rather than a confirm dialog. It is irreversible and the
 * reason is recorded in the audit trail forever, so the friction is deliberate (§132, §188).
 */
export function YearActionBar({
  id,
  status,
  current,
  allowedTransitions,
}: {
  id: string;
  status: CalendarStatus;
  current: boolean;
  allowedTransitions: readonly CalendarStatus[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const canActivate = allowedTransitions.includes('ACTIVE');
  const canClose = allowedTransitions.includes('CLOSED');
  const canMakeCurrent = status === 'ACTIVE' && !current;

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      // Invariant I-8: a failed action says so. It never silently does nothing and leaves the
      // user to work out that their click was ignored.
      if (!result.ok) setError(result.message ?? 'That could not be completed.');
    });
  }

  if (status === 'CLOSED') {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        This academic year is closed. Its records stay available to read, and it cannot be
        reopened — reopening would change what already-issued report cards mean.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canActivate && (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => run(() => activateAcademicYearAction(id))}
          >
            Activate
          </Button>
        )}

        {canMakeCurrent && (
          <Button
            disabled={pending}
            onClick={() => run(() => makeAcademicYearCurrentAction(id))}
          >
            Make current
          </Button>
        )}

        {canClose && (
          <Button
            variant="danger"
            disabled={pending}
            aria-expanded={closing}
            onClick={() => setClosing((open) => !open)}
          >
            Close year…
          </Button>
        )}

        {pending && (
          <span role="status" className="text-sm text-[var(--color-ink-muted)]">
            Working…
          </span>
        )}
      </div>

      {error && <FormMessage message={error} tone="error" />}

      {closing && <CloseYearForm id={id} onCancel={() => setClosing(false)} />}
    </div>
  );
}

function CloseYearForm({ id, onCancel }: { id: string; onCancel: () => void }) {
  const boundAction = closeAcademicYearAction.bind(null, id);
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    boundAction,
    undefined,
  );

  return (
    <form
      action={formAction}
      className="rounded-[var(--radius-control)] border border-[var(--color-danger)]
                 bg-[var(--color-danger-subtle)] p-3"
    >
      <p className="text-sm text-[var(--color-ink)]">
        Closing an academic year is permanent. Every term in it must be closed first.
      </p>

      <div className="mt-3 max-w-lg">
        <Field
          label="Why are you closing this year?"
          name="reason"
          required
          placeholder="End of the 2026/2027 session"
          hint="Recorded in the audit trail against your name"
          error={state?.fieldErrors?.['reason']}
        />
      </div>

      {state && !state.ok && state.message && (
        <div className="mt-2">
          <FormMessage message={state.message} tone="error" />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <SubmitButton variant="danger" pendingLabel="Closing…">
          Close this academic year
        </SubmitButton>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
