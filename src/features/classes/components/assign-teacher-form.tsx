'use client';

import { useActionState } from 'react';

import { FormMessage, SelectField, SubmitButton } from '@/components/form';
import { assignClassTeacherAction, type ActionResult } from '@/features/classes/actions';

/**
 * Assigns the class teacher.
 *
 * <p>An authorization change in ordinary clothes: the person named here gains the ability to take
 * this register and to see these children, and whoever held it loses both. The hint says so,
 * because a screen that reads like an address-book edit invites one.
 */
export function AssignTeacherForm({
  classGroupId,
  current,
  teachers,
}: {
  classGroupId: string;
  current: string | null;
  teachers: ReadonlyArray<{ id: string; label: string }>;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    assignClassTeacherAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="classGroupId" value={classGroupId} />

      <div className="min-w-[16rem] flex-1">
        <SelectField
          label="Class teacher"
          name="membershipId"
          defaultValue={current ?? ''}
          placeholder="Nobody"
          options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.label }))}
          hint="Changes who may take this register and see these children. Recorded in the audit log."
        />
      </div>

      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>

      {state?.message && (
        <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />
      )}
    </form>
  );
}
