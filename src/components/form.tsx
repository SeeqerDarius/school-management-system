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
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  /**
   * Submits this name/value pair alongside the form, so one form can have two submit buttons
   * that mean different things — "save" and "save and submit" on a register. The browser sends
   * only the button that was pressed, which is how the server tells them apart without a hidden
   * field that some other control has to keep in step.
   */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      aria-live="polite"
      {...(name ? { name } : {})}
      {...(value ? { value } : {})}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * A multi-line field, for the places where a person is asked to say why.
 *
 * <p>Every one of those is a reason attached to something irreversible — a correction to a
 * submitted register, a locked register, a closed enrolment — so the label says what it is for
 * rather than "Notes".
 */
export function TextAreaField({
  label,
  name,
  hint,
  error,
  required,
  rows = 3,
  maxLength,
  defaultValue,
}: {
  label: string;
  name: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean;
  rows?: number;
  maxLength?: number;
  defaultValue?: string | undefined;
}) {
  const id = `field-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-ink)]">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--color-ink-muted)]">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)]
                   bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]
                   focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
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
  inputMode,
}: {
  label: string;
  name: string;
  type?: 'text' | 'date' | 'number' | 'email' | 'password';
  defaultValue?: string | undefined;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
  /**
   * Passed through so password managers behave. `new-password` on a field somebody is choosing
   * a password in is what makes a manager offer to generate and store one, and leaving it off
   * is a large part of why people type the same password everywhere.
   */
  autoComplete?: string | undefined;
  /**
   * The on-screen keyboard to offer, independently of the input's type.
   *
   * <p>An amount is `type="text"` with `inputMode="decimal"`, never `type="number"`. A number
   * input hands back a value the browser has already parsed and re-rendered, and money in this
   * product is a string from end to end precisely so nothing ever does that to it.
   */
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email';
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
        inputMode={inputMode}
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
  defaultValue?: string | undefined;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  /** Shown as a non-selectable first row when nothing is chosen yet. */
  placeholder?: string | undefined;
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

/** A single checkbox with its label and hint, for a setting rather than a value. */
export function CheckboxField({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: string | undefined;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        aria-describedby={hint ? hintId : undefined}
        className="mt-0.5 size-4 rounded border-[var(--color-border-strong)]
                   accent-[var(--color-primary)]"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-[var(--color-ink)]">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-xs text-[var(--color-ink-muted)]">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
