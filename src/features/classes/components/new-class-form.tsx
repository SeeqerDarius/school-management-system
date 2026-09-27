'use client';

import { useActionState } from 'react';

import { Field, FormMessage, SelectField, SubmitButton } from '@/components/form';
import { createClassAction, type ActionResult } from '@/features/classes/actions';

/**
 * Creates a class.
 *
 * <p>No dropdown of "Basic 1 … JHS 3". §136: a school's class structure is data, and the day this
 * ships with a Ghanaian enum is the day a school in another country cannot describe its own
 * classes. `Year level` is a sort key so that Basic 10 files after Basic 9; it carries no meaning.
 */
export function NewClassForm({
  years,
  teachers,
  campuses,
}: {
  years: ReadonlyArray<{ id: string; name: string; isCurrent: boolean }>;
  teachers: ReadonlyArray<{ id: string; label: string }>;
  campuses: ReadonlyArray<{ id: string; code: string; name: string }>;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    createClassAction,
    undefined,
  );

  const current = years.find((year) => year.isCurrent);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label="Campus"
          name="campusId"
          required
          placeholder="Choose the campus"
          options={campuses.map((campus) => ({ value: campus.id, label: `${campus.code} — ${campus.name}` }))}
          error={state?.fieldErrors?.['campusId']}
        />
      </div>

      <div className="min-w-[14rem] flex-1">
        <SelectField
          label="Academic year"
          name="academicYearId"
          required
          defaultValue={current?.id}
          placeholder="Choose a year"
          options={years.map((year) => ({
            value: year.id,
            label: year.isCurrent ? `${year.name} (current)` : year.name,
          }))}
          error={state?.fieldErrors?.['academicYearId']}
        />
        <Field
          label="Code"
          name="code"
          required
          placeholder="B5A"
          hint="Short form, as on a timetable"
          error={state?.fieldErrors?.['code']}
        />
        <Field
          label="Name"
          name="name"
          required
          placeholder="Basic 5 A"
          error={state?.fieldErrors?.['name']}
        />
        <Field
          label="Year level"
          name="yearLevel"
          type="number"
          hint="Sorting only. Optional."
          error={state?.fieldErrors?.['yearLevel']}
        />
      </div>

      <SelectField
        label="Class teacher"
        name="classTeacherMembershipId"
        placeholder="Nobody yet"
        options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.label }))}
        hint="The class teacher is who may take this register and see these children. It can be set later."
      />

      <div>
        <SubmitButton pendingLabel="Creating…">Create class</SubmitButton>
      </div>

      {state?.message && (
        <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />
      )}
    </form>
  );
}
