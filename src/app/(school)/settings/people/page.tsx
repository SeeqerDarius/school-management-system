import type { Metadata } from 'next';

import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { InviteForm } from '@/features/people/components/invite-form';
import { assignableRoles, listPeople, type PersonRow } from '@/features/people/data';
import { P } from '@/lib/permissions';
import { requireActiveSession } from '@/server/auth/session';

export const metadata: Metadata = { title: 'People' };

const PRINCIPAL_LABELS: Record<string, string> = {
  STAFF: 'Staff',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  GUARDIAN: 'Parent or guardian',
  PLATFORM: 'Platform',
  SUPPORT: 'Support',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  SUSPENDED: 'danger',
  ENDED: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  SUSPENDED: 'Suspended',
  ENDED: 'Ended',
};

/**
 * Everyone with access to this school.
 *
 * <p>A Server Component. What a person may do here comes from their permissions, resolved on the
 * server — the invite form is absent without `USER_INVITE`, and that absence is a courtesy
 * rather than the control, since the action checks the same permission again.
 */
export default async function PeoplePage() {
  const session = await requireActiveSession();

  if (!session.permissions.has(P.USER_VIEW)) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="People" />
        <ErrorState
          title="You do not have permission to see who has access to this school"
          detail="If you need it, ask whoever administers this school to grant it."
        />
      </main>
    );
  }

  const canInvite = session.permissions.has(P.USER_INVITE);
  const [people, roles] = await Promise.all([
    listPeople(),
    canInvite ? assignableRoles() : Promise.resolve([]),
  ]);

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="People"
        description="Everyone who can sign in to this school. Accounts are invited — there is no
                     public sign-up, so this list is the whole of it."
      />

      {canInvite && (
        <Panel title="Invite someone">
          <div className="px-4 py-4 sm:px-5">
            <InviteForm roles={roles} />
          </div>
        </Panel>
      )}

      <div className={canInvite ? 'mt-4' : ''}>
        <Panel title="Members" description={`${people.length} in total`}>
          {people.length === 0 ? (
            <EmptyState
              title="Nobody has been invited yet"
              description={
                canInvite
                  ? 'Invite the people who run the school first — they can invite everybody else.'
                  : 'Whoever administers this school has not invited anyone yet.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <caption className="sr-only">People with access to this school</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left">
                    <th
                      scope="col"
                      className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5"
                    >
                      Name
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                      Email
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                      At this school
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                      Role
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5"
                    >
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <PersonRowView key={person.id} person={person} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}

function PersonRowView({ person }: { person: PersonRow }) {
  const roles = person.roles.map((entry) => entry.role.name);

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <th scope="row" className="px-4 py-2 text-left font-medium text-[var(--color-ink)] sm:px-5">
        {person.user.fullName}
      </th>
      <td className="px-4 py-2 break-all text-[var(--color-ink-muted)]">{person.user.email}</td>
      <td className="px-4 py-2 whitespace-nowrap text-[var(--color-ink-muted)]">
        {PRINCIPAL_LABELS[person.principalType] ?? person.principalType}
      </td>
      <td className="px-4 py-2 text-[var(--color-ink-muted)]">
        {roles.length > 0 ? roles.join(', ') : '—'}
      </td>
      <td className="px-4 py-2 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            label={STATUS_LABEL[person.status] ?? person.status}
            tone={STATUS_TONE[person.status] ?? 'neutral'}
          />
          {person.status === 'INVITED' && (
            <span className="text-xs text-[var(--color-ink-subtle)]">
              has not set a password yet
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
