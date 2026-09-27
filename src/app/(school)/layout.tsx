import Link from 'next/link';

import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { isFamilyPrincipal } from '@/lib/student-visibility';
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
  const may = (...codes: string[]) => codes.some((code) => session.permissions.has(code));
  const isFamily = isFamilyPrincipal(session.principalType);

  const links = [
    { href: '/settings/calendar', label: 'Academic calendar', show: may(P.ACADEMIC_YEAR_VIEW) },
    {
      href: '/students',
      label: isFamily ? 'My children' : 'Students',
      show: isFamily || may(P.STUDENT_READ),
    },
    // A class teacher holds no CLASS_VIEW — their reach over a class comes from being its class
    // teacher, which ATTENDANCE_VIEW stands in for here. Families get neither screen: both are
    // about a class as a group, and a child's own attendance is on the child's own record.
    { href: '/classes', label: 'Classes', show: !isFamily && may(P.CLASS_VIEW, P.ATTENDANCE_VIEW) },
    { href: '/attendance', label: 'Attendance', show: !isFamily && may(P.ATTENDANCE_VIEW) },
    { href: '/fees', label: 'Fees', show: may(P.FEES_VIEW) },
    { href: '/settings/people', label: 'People', show: may(P.USER_VIEW) },
  ].filter((link) => link.show);

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

          {/* Shown by permission — which is NOT how access is decided. The server refuses
              regardless of what was rendered (§98), and every one of these pages checks for
              itself. This is about not offering somebody a door that is always locked: a class
              teacher who clicks "Fees" and is told they may not is being asked to discover a
              rule the product could simply have not put in front of them. */}
          <nav aria-label="Sections">
            <ul className="flex flex-wrap items-center gap-1 text-sm">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="rounded-[var(--radius-control)] px-2.5 py-1.5
                               text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]
                               hover:text-[var(--color-ink)]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
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
