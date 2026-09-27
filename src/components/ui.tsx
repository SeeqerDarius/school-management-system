import clsx from 'clsx';
import type { ReactNode } from 'react';

import type { StatusTone } from '@/lib/calendar-status';

/**
 * The small set of presentational primitives this application is built from.
 *
 * Kept deliberately few. A component library grows fastest when nobody is watching, and the
 * result is six subtly different buttons and a product that looks assembled rather than designed.
 */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string | undefined;
  description?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        'rounded-[var(--radius-panel)] border border-[var(--color-border)]',
        'bg-[var(--color-surface-raised)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)] border-[var(--color-border-strong)]',
  success: 'bg-[var(--color-success-subtle)] text-[var(--color-success)] border-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-subtle)] text-[var(--color-warning)] border-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)] border-[var(--color-danger)]',
  info: 'bg-[var(--color-info-subtle)] text-[var(--color-info)] border-[var(--color-info)]',
};

/**
 * A status.
 *
 * <p>Always renders the word, never only the colour. Around one man in twelve cannot reliably
 * separate the red from the green, and these screens are routinely printed in monochrome (§93).
 */
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/**
 * An empty state that says what is actually missing and what to do about it.
 *
 * <p>"No data" tells a user nothing. "No academic years have been set up yet" plus the button
 * that fixes it tells them everything (§167).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center sm:px-6">
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * A failure the user needs to know about.
 *
 * <p>`role="alert"` so a screen reader announces it rather than leaving it to be discovered.
 */
export function ErrorState({
  title,
  detail,
  reference,
}: {
  title: string;
  detail?: string | undefined;
  reference?: string | undefined;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-panel)] border border-[var(--color-danger)]
                 bg-[var(--color-danger-subtle)] px-4 py-3"
    >
      <p className="text-sm font-semibold text-[var(--color-danger)]">{title}</p>
      {detail && <p className="mt-1 text-sm text-[var(--color-ink)]">{detail}</p>}
      {reference && (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Quote reference <code className="font-mono">{reference}</code> to support.
        </p>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

