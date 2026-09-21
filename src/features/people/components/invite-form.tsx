'use client';

import { useActionState } from 'react';

import { Field, FormMessage, SelectField, SubmitButton } from '@/components/form';
import { inviteMemberAction, type ActionResult } from '@/features/people/actions';
import type { AssignableRole } from '@/features/people/data';
import { INVITABLE_PRINCIPAL_TYPES } from '@/features/people/schema';

const PRINCIPAL_LABELS: Record<(typeof INVITABLE_PRINCIPAL_TYPES)[number], string> = {
  STAFF: 'Staff',
  TEACHER: 'Teacher',
  GUARDIAN: 'Parent or guardian',
};

/**
 * Invites somebody to this school.
 *
 * <p>The invitation link comes back in the response and is shown once. It is not stored anywhere
 * readable and cannot be retrieved later — issuing a fresh invitation is how you get another
 * one, and doing so retires the previous link.
 */
export function InviteForm({ roles }: { roles: AssignableRole[] }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    inviteMemberAction,
    undefined,
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="teacher@school.edu.gh"
            error={state?.fieldErrors?.['email']}
          />
          <Field
            label="Full name"
            name="fullName"
            required
            autoComplete="off"
            placeholder="Ama Mensah"
            error={state?.fieldErrors?.['fullName']}
          />
          <SelectField
            label="At this school they are"
            name="principalType"
            required
            placeholder="Choose…"
            options={INVITABLE_PRINCIPAL_TYPES.map((value) => ({
              value,
              label: PRINCIPAL_LABELS[value],
            }))}
            error={state?.fieldErrors?.['principalType']}
          />
          <SelectField
            label="Role"
            name="roleId"
            placeholder="No role yet"
            hint="Decides what they can do"
            options={roles.map((role) => ({ value: role.id, label: role.name }))}
            error={state?.fieldErrors?.['roleId']}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Inviting…">Send invitation</SubmitButton>
          <p className="text-xs text-[var(--color-ink-muted)]">
            They will not be able to sign in until they set a password.
          </p>
        </div>
      </form>

      {state?.message && (
        <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />
      )}

      {state?.invitationLink && <InvitationLink link={state.invitationLink} />}
    </div>
  );
}

/**
 * The link, shown once.
 *
 * <p>Email is not wired on this deployment, so the person who issued the invitation is the one
 * who delivers it. Presented as selectable text rather than only behind a copy button, because
 * a copy button that silently fails leaves somebody with nothing and no way to tell.
 */
function InvitationLink({ link }: { link: string }) {
  return (
    <div
      className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)]
                 bg-[var(--color-surface-sunken)] p-3"
    >
      <p className="text-sm font-medium text-[var(--color-ink)]">
        Send them this link — it is shown only now
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        It works once and expires in seven days. Anyone holding it can set the password for this
        account, so send it to the person and nobody else.
      </p>
      <code
        className="mt-2 block overflow-x-auto rounded-[var(--radius-control)] bg-[var(--color-surface)]
                   px-2.5 py-2 text-xs break-all text-[var(--color-ink)]"
      >
        {link}
      </code>
    </div>
  );
}
