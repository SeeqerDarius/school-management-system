'use client';

import { useEffect } from 'react';

import { Button } from '@/components/form';

/**
 * The last line of defence for a page in the school workspace.
 *
 * <p>Says what happened in plain words and offers the one useful next step. It deliberately
 * shows no message from the error itself: those are written for engineers and routinely contain
 * table names, constraint names and identifiers that nobody outside the team should be handed.
 * The digest is Next.js's own reference for the server-side log entry, which is what support
 * actually needs quoted.
 */
export default function SchoolError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error in the school workspace', error);
  }, [error]);

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
      <div
        role="alert"
        className="rounded-[var(--radius-panel)] border border-[var(--color-danger)]
                   bg-[var(--color-danger-subtle)] px-4 py-4"
      >
        <h1 className="text-base font-semibold text-[var(--color-danger)]">
          This page could not be loaded
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink)]">
          Nothing was changed. Try again, and if it keeps happening let your school administrator
          know.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Quote reference <code className="font-mono">{error.digest}</code> to support.
          </p>
        )}
        <div className="mt-4">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
