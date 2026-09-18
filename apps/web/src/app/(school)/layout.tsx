import Link from 'next/link';

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

export default function SchoolLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-[var(--color-ink)]"
          >
            Sankofa
          </Link>

          {/* Role-aware navigation replaces this as the modules land. Hiding a link is never
              authorization — the API refuses regardless of what is rendered (§98). */}
          <nav aria-label="School settings" className="ml-2">
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
            </ul>
          </nav>
        </div>
      </header>

      {children}
    </div>
  );
}
