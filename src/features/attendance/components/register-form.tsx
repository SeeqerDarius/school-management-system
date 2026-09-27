'use client';

import { useActionState, useState } from 'react';

import { Button, FormMessage, SubmitButton, TextAreaField } from '@/components/form';
import { StatusBadge } from '@/components/ui';
import { saveRegisterAction, type ActionResult } from '@/features/attendance/actions';
import { ATTENDANCE_STATUSES, type AttendanceStatusName } from '@/features/attendance/schema';
import type { RegisterLine } from '@/features/attendance/data';
import type { RegisterCapabilities } from '@/lib/attendance';

/**
 * The register.
 *
 * <p>`TESTING.md` calls this "the highest-frequency screen in the product, at 375px", and that is
 * the constraint everything below is shaped by. A teacher stands in front of a class with a phone
 * and marks thirty children; every extra tap is thirty extra taps.
 *
 * <ul>
 *   <li>One row per child, each a group of four buttons rather than a select. A native select on
 *       Android is two taps and a scroll wheel; a radio group is one tap, and it can be reached by
 *       keyboard as a single arrow-key group per child.</li>
 *   <li><b>Mark all present</b> first, because most children are. The register then becomes the
 *       exceptions, which is how it is actually taken out loud.</li>
 *   <li>Nothing is hidden behind a disclosure: an absent child's note appears as soon as it is
 *       needed, because a teacher who has to find it will not write it.</li>
 * </ul>
 *
 * <p>The radio inputs are real radios in a real `fieldset`, not buttons with state. That is what
 * makes the whole thing work with a screen reader and what makes the form submit correctly if
 * hydration never happens — a phone on a school's connection is exactly where that matters.
 */

const STATUS_LABEL: Record<AttendanceStatusName, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
};

const STATUS_CLASS: Record<AttendanceStatusName, string> = {
  PRESENT: 'peer-checked:bg-[var(--color-success)] peer-checked:text-white',
  ABSENT: 'peer-checked:bg-[var(--color-danger)] peer-checked:text-white',
  LATE: 'peer-checked:bg-[var(--color-warning)] peer-checked:text-black',
  EXCUSED: 'peer-checked:bg-[var(--color-ink-muted)] peer-checked:text-white',
};

export function RegisterForm({
  classGroupId,
  sessionDate,
  lines,
  capabilities,
  status,
}: {
  classGroupId: string;
  sessionDate: string;
  lines: RegisterLine[];
  capabilities: RegisterCapabilities;
  status: string;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    saveRegisterAction,
    undefined,
  );

  // Held in React only so "mark all present" and the conditional note field work. The form still
  // submits the inputs themselves, so the server never depends on this state being right.
  const [marks, setMarks] = useState<Record<string, AttendanceStatusName | null>>(() =>
    Object.fromEntries(lines.map((line) => [line.studentId, line.status])),
  );

  const readOnly = !capabilities.mark;
  const unmarked = lines.filter((line) => !marks[line.studentId]).length;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="classGroupId" value={classGroupId} />
      <input type="hidden" name="sessionDate" value={sessionDate} />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() =>
              setMarks((current) =>
                Object.fromEntries(
                  lines.map((line) => [line.studentId, current[line.studentId] ?? 'PRESENT']),
                ),
              )
            }
          >
            Mark the rest present
          </Button>
          <p className="text-xs text-[var(--color-ink-muted)]" aria-live="polite">
            {unmarked === 0
              ? 'Every child has a mark.'
              : `${unmarked} child${unmarked === 1 ? '' : 'ren'} still unmarked`}
          </p>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-[var(--color-border)]">
        {lines.map((line) => (
          <li key={line.studentId} className="py-3">
            <input type="hidden" name="studentId" value={line.studentId} />

            <fieldset>
              <legend className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-[var(--color-ink)]">{line.name}</span>
                <span className="tabular-nums text-xs text-[var(--color-ink-muted)]">
                  {line.reference}
                </span>
                {line.hasMedicalAlert && (
                  <StatusBadge label="Medical alert — contact the nurse" tone="warning" />
                )}
              </legend>

              {/* One row of four at 375px, not two. `grid-cols-4` rather than wrapping flex:
                  a wrapped row makes a teacher scan twice per child, thirty times a morning,
                  and the four options are always the same four. */}
              <div className="grid grid-cols-4 gap-1.5">
                {ATTENDANCE_STATUSES.map((value) => (
                  <label key={value} className="cursor-pointer">
                    <input
                      type="radio"
                      name={`status:${line.studentId}`}
                      value={value}
                      checked={marks[line.studentId] === value}
                      disabled={readOnly}
                      onChange={() =>
                        setMarks((current) => ({ ...current, [line.studentId]: value }))
                      }
                      className="peer sr-only"
                    />
                    <span
                      className={`flex min-h-11 items-center justify-center
                                  rounded-[var(--radius-control)] border
                                  border-[var(--color-border-strong)] px-1 text-sm
                                  peer-focus-visible:outline peer-focus-visible:outline-2
                                  peer-focus-visible:outline-offset-2
                                  peer-focus-visible:outline-[var(--color-primary)]
                                  ${STATUS_CLASS[value]}`}
                    >
                      {STATUS_LABEL[value]}
                    </span>
                  </label>
                ))}
              </div>

              {marks[line.studentId] === 'LATE' && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <span className="text-[var(--color-ink-muted)]">Minutes late</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={600}
                    name={`minutesLate:${line.studentId}`}
                    defaultValue={line.minutesLate ?? ''}
                    disabled={readOnly}
                    className="min-h-9 w-20 rounded-[var(--radius-control)] border
                               border-[var(--color-border-strong)] bg-[var(--color-surface)]
                               px-2 py-1 text-sm text-[var(--color-ink)]"
                  />
                </label>
              )}

              {marks[line.studentId] === 'EXCUSED' && (
                <label className="mt-2 flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-ink-muted)]">
                    Why it is excused <span aria-hidden="true">*</span>
                    <span className="sr-only"> (required)</span>
                  </span>
                  <input
                    type="text"
                    name={`note:${line.studentId}`}
                    defaultValue={line.reason ?? ''}
                    disabled={readOnly}
                    required
                    placeholder="Ill — parent rang; hospital appointment"
                    className="min-h-9 rounded-[var(--radius-control)] border
                               border-[var(--color-border-strong)] bg-[var(--color-surface)]
                               px-2 py-1 text-sm text-[var(--color-ink)]"
                  />
                </label>
              )}
            </fieldset>
          </li>
        ))}
      </ul>

      {capabilities.correcting && (
        <TextAreaField
          label="Why this register is being corrected"
          name="correctionReason"
          required
          rows={2}
          hint="This register has been submitted. The change, the old mark and this reason all go into the audit log."
        />
      )}

      {state?.fieldErrors?.correctionReason && <FormMessage message={state.fieldErrors.correctionReason} tone="error" />}
      {state?.message && (
        <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel="Saving…" variant="secondary">
            Save
          </SubmitButton>
          {capabilities.submit && (
            <SubmitButton pendingLabel="Submitting…" name="intent" value="submit">
              Save and submit
            </SubmitButton>
          )}
          <p className="text-xs text-[var(--color-ink-muted)]">
            {capabilities.submit
              ? 'Submitting needs every child on the roll to have a mark.'
              : null}
          </p>
        </div>
      )}

      {readOnly && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          {status === 'LOCKED'
            ? 'This register is locked. Nobody can change it — that is what locking is for.'
            : 'This register has been submitted. Changing it needs the correction permission.'}
        </p>
      )}
    </form>
  );
}
