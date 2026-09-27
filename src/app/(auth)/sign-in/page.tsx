import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Panel } from '@/components/ui';
import { SignInForm } from '@/features/auth/components/sign-in-form';
import { currentSession } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Signing in.
 *
 * <p>There is no "create an account" link, and that is deliberate rather than unfinished. A
 * school account is issued by invitation: somebody with authority at a school decides that a
 * person should have access to children's records. Self-service registration would mean anyone
 * with an email address could create an identity inside the product and start knocking on doors.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await currentSession();
  const { next } = await searchParams;

  // An open-redirect check. Only a path within this application is ever followed; an absolute
  // URL supplied in the query string would let a phishing page send someone here to be logged in
  // and then bounced somewhere that looks identical.
  const callbackUrl = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (session?.userId) {
    redirect(session.activeMembershipId ? callbackUrl : '/choose-school');
  }

  return (
    <Panel className="p-6">
      <h1 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">
        Sign in to Sankofa
      </h1>
      <p className="mt-1 mb-5 text-sm text-[var(--color-ink-muted)]">
        Use the email address your school invited.
      </p>

      <SignInForm callbackUrl={callbackUrl} />

      <p className="mt-5 text-xs text-[var(--color-ink-muted)]">
        Accounts are created by your school, not here. If you cannot get in, ask whoever
        administers Sankofa at your school to check your access.
      </p>
    </Panel>
  );
}
