import type { PrincipalType } from '@prisma/client';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Panel } from '@/components/ui';
import { SchoolPicker, type SchoolChoice } from '@/features/auth/components/school-picker';
import { currentSession } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Choose a school' };

/**
 * Choosing which school to act in.
 *
 * <p>A person can legitimately hold several memberships — a teacher at one school whose own
 * children attend another, a proprietor running three. They are separate identities with separate
 * permissions, and this page is where one of them is picked. It is never inferred from a
 * subdomain or a header; the tenant of a request is the tenant of the verified membership.
 */
export default async function ChooseSchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await currentSession();
  if (!session?.userId) redirect('/sign-in');

  const { next } = await searchParams;
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const choices: SchoolChoice[] = (session.memberships ?? []).map((membership) => ({
    membershipId: membership.id,
    displayName: membership.tenant.displayName,
    slug: membership.tenant.slug,
    role: principalLabel(membership.principalType),
  }));

  return (
    <Panel className="p-6">
      <h1 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">
        {choices.length > 1 ? 'Choose a school' : 'Opening your school'}
      </h1>
      {choices.length > 1 && (
        <p className="mt-1 mb-5 text-sm text-[var(--color-ink-muted)]">
          You have access to more than one. What you can do differs in each.
        </p>
      )}

      <div className={choices.length > 1 ? '' : 'mt-3'}>
        <SchoolPicker choices={choices} next={destination} />
      </div>
    </Panel>
  );
}

function principalLabel(principalType: PrincipalType): string {
  switch (principalType) {
    case 'STAFF':
      return 'Staff';
    case 'TEACHER':
      return 'Teacher';
    case 'STUDENT':
      return 'Student';
    case 'GUARDIAN':
      return 'Parent or guardian';
    case 'PLATFORM':
      return 'Platform';
    case 'SUPPORT':
      return 'Support';
  }
}
