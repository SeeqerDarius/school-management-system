import type { Metadata } from 'next';

import { ErrorState, PageHeader, Panel } from '@/components/ui';
import { ownAccount } from '@/features/account/data';
import { ChangePasswordForm } from '@/features/account/components/change-password-form';
import { requireActiveSession } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Your account' };

/**
 * A person's own account.
 *
 * <p>No permission check, and no empty state. Everybody who can reach this page has an account
 * by definition — reaching it at all required a session — so there is no version of this screen
 * with nothing on it, and nobody who should be refused.
 */
export default async function AccountPage() {
  const session = await requireActiveSession();
  const account = await ownAccount();

  if (!account) {
    // Reachable only if the row went away under a live session. Said plainly rather than
    // rendered as a page with blank fields, which reads as the product losing your details.
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <PageHeader title="Your account" />
        <div className="mt-6">
          <ErrorState
            title="We could not load your account"
            detail="Sign out and in again. If it keeps happening, ask your school administrator."
          />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Your account"
        description="Your sign-in details. Only you can change your password."
      />

      <div className="mt-6 space-y-6">
        <Panel title="Signed in as">
          <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-[var(--color-ink-muted)]">Name</dt>
            <dd className="text-[var(--color-ink)]">{account.fullName}</dd>
            <dt className="text-[var(--color-ink-muted)]">Email</dt>
            <dd className="break-all text-[var(--color-ink)]">{account.email}</dd>
            <dt className="text-[var(--color-ink-muted)]">School</dt>
            <dd className="text-[var(--color-ink)]">{session.tenantName}</dd>
          </dl>
          <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
            Your name and email are held by the school. Ask an administrator to change them.
          </p>
        </Panel>

        <Panel title="Change your password" description="You will need your current one.">
          <ChangePasswordForm email={account.email} />
        </Panel>
      </div>
    </main>
  );
}
