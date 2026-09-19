'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, FormMessage } from '@/components/form';

/**
 * Signing in.
 *
 * <p>One message for every kind of failure — wrong password, unknown address, suspended account.
 * Distinguishing them would let anyone with a list of email addresses learn which of them hold
 * accounts at a school, and for a product holding children's records that is not a small thing.
 *
 * <p>The fields are plain `email` and `password` inputs with the right `autoComplete` values, so
 * a password manager fills them. Fighting password managers is how people end up with passwords
 * they can remember, which is to say bad ones.
 */
export function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);

    try {
      const result = await signIn('credentials', {
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        redirect: false,
      });

      if (!result?.ok) {
        setError('Those details were not recognised.');
        return;
      }

      // Signed in, but no school is chosen yet — that is a separate, server-verified step.
      router.replace(`/choose-school?next=${encodeURIComponent(callbackUrl)}`);
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-[var(--color-ink)]">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="min-h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)]
                     bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-ink)]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-[var(--color-ink)]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)]
                     bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-ink)]"
        />
      </div>

      {error && <FormMessage message={error} tone="error" />}

      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
