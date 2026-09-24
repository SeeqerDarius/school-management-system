import Link from 'next/link';

import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { requireActiveSession } from '@/server/auth/session';
import { P } from '@/lib/permissions';

/**
 * The school workspace shell.
 *
 * <p>Every page in this group is scoped to one school and one signed-in person, so none of them
 * may ever be statically prerendered or cached at the edge. `force-dynamic` states that once,
 * here, rather than leaving each page to remember — and forgetting would mean one school's
 * calendar served to another, which is precisely the disclosure the tenancy model exists to
 * prevent.
 */
export const dynamic = 'force-dynamic';

export default async function SchoolLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Resolved here as well as in each page. The layout naming the school in its header is reason
  // enough, but it also means an expired session is turned away at the shell rather than after a
  // page has already begun querying.
  const session = await requireActiveSession();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-[var(--color-ink)]"
          >
            Sankofa
          </Link>

          {/* Role-aware navigation replaces this as the modules land. Hiding a link is never
              authorization — the server refuses regardless of what was rendered (§98). */}
          <nav aria-label="School settings">
            <ul className="flex items-center gap-1 text-sm">
              <li>
                <Link
                  href="/settings/calendar"
                  className="rounded-[var(--radius-control)] px-2.5 py-1.5
                             text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]
                             hover:text-[var(--color-ink)]"
                >
                  Academic calendar
                </Link>
              </li>
              {session.permissions.has(P.STUDENT_READ) && (
                <li>
                  <Link
                    href="/students"
                    className="rounded-[var(--radius-control)] px-2.5 py-1.5
                               text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]
                               hover:text-[var(--color-ink)]"
                  >
                    Students
                  </Link>
                </li>
              )}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* Which school you are acting in, always on screen. Someone holding memberships at
                three schools should never have to guess which one they are about to change. */}
            <span className="max-w-[12rem] truncate text-sm text-[var(--color-ink-muted)]">
              {session.tenantName}
            </span>
            <Link
              href="/choose-school"
              className="rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm
                         text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]
                         hover:text-[var(--color-ink)]"
            >
              Switch
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
