'use client';

import clsx from 'clsx';
import { useId } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Form primitives.
 *
 * <p>Two things here are load-bearing rather than cosmetic:
 *
 * <ul>
 *   <li>Every input is associated with a real {@code <label>} and, when invalid, with its error
 *       message through {@code aria-describedby}. A red outline alone tells a screen-reader user
 *       nothing (§145).</li>
 *   <li>Submit buttons disable themselves while pending. Double submission on "Record payment"
 *       is not a cosmetic problem.</li>
 * </ul>
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-[var(--color-primary-ink)] hover:bg-[var(--color-primary-hover)] border-transparent',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-ink)] border-[var(--color-border-strong)] hover:bg-[var(--color-surface-sunken)]',
  danger:
    'bg-[var(--color-surface)] text-[var(--color-danger)] border-[var(--color-danger)] hover:bg-[var(--color-danger-subtle)]',
};

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] border',
        'px-3 py-1.5 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        // 44px is the comfortable touch target on a phone, which is where a lot of this
        // product is actually used.
        'min-h-9',
        VARIANT_CLASS[variant],
        className,
      )}
    />
  );
}

/**
 * A submit button that reflects the form's pending state.
 *
 * <p>`pendingLabel` is announced as well as shown, so the wait is perceptible to someone who
 * cannot see the button change.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant = 'primary',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-live="polite">
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
  error,
  hint,
  placeholder,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: 'text' | 'date' | 'number' | 'email' | 'password';
  defaultValue?: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string;
  placeholder?: string;
  /**
   * Passed through so password managers behave. `new-password` on a field somebody is choosing
   * a password in is what makes a manager offer to generate and store one, and leaving it off
   * is a large part of why people type the same password everywhere.
   */
  autoComplete?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // Only reference ids that exist — pointing aria-describedby at a missing node makes some
  // screen readers announce nothing at all.
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-ink)]">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-[var(--color-danger)]">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>

      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={clsx(
          'rounded-[var(--radius-control)] border bg-[var(--color-surface)] px-2.5 py-1.5',
          'text-sm text-[var(--color-ink)] min-h-9',
          error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
        )}
      />

      {hint && (
        <p id={hintId} className="text-xs text-[var(--color-ink-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** A form-level message. `role="alert"` so a failure is announced, not merely displayed. */
export function FormMessage({ message, tone }: { message: string; tone: 'error' | 'success' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'text-sm',
        tone === 'error'
          ? 'font-medium text-[var(--color-danger)]'
          : 'text-[var(--color-success)]',
      )}
    >
      {message}
    </p>
  );
}

/**
 * A labelled select.
 *
 * <p>Same wiring as {@link Field}: a real label, and errors associated through
 * `aria-describedby` rather than signalled by colour alone.
 */
export function SelectField({
  label,
  name,
  options,
  defaultValue,
  required,
  error,
  hint,
  placeholder,
}: {
  label: string;
  name: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  defaultValue?: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string;
  /** Shown as a non-selectable first row when nothing is chosen yet. */
  placeholder?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-ink)]">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-[var(--color-danger)]">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>

      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ''}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={clsx(
          'rounded-[var(--radius-control)] border bg-[var(--color-surface)] px-2.5 py-1.5',
          'text-sm text-[var(--color-ink)] min-h-9',
          error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
        )}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {hint && (
        <p id={hintId} className="text-xs text-[var(--color-ink-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
