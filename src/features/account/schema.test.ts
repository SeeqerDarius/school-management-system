import { describe, expect, it } from 'vitest';

import { changePasswordInput } from '@/features/account/schema';

/**
 * The rules a password change has to satisfy before anything touches the database.
 *
 * <p>Deny side first throughout. A validator is only worth having for what it refuses.
 */

const valid = {
  currentPassword: 'the-one-i-have-now',
  newPassword: 'a-considerably-better-passphrase',
  confirmPassword: 'a-considerably-better-passphrase',
};

function errorFor(input: Record<string, string>, path: string): string | undefined {
  const result = changePasswordInput.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path[0] === path)?.message;
}

describe('changePasswordInput', () => {
  it('accepts a well-formed change', () => {
    expect(changePasswordInput.safeParse(valid).success).toBe(true);
  });

  it('refuses a new password under twelve characters', () => {
    expect(errorFor({ ...valid, newPassword: 'short', confirmPassword: 'short' }, 'newPassword')).toMatch(
      /at least 12 characters/i,
    );
  });

  it('refuses a confirmation that does not match', () => {
    expect(
      errorFor({ ...valid, confirmPassword: 'a-considerably-better-passphras' }, 'confirmPassword'),
    ).toMatch(/do not match/i);
  });

  it('refuses a new password identical to the current one', () => {
    const same = 'exactly-the-same-passphrase';
    expect(
      errorFor({ currentPassword: same, newPassword: same, confirmPassword: same }, 'newPassword'),
    ).toMatch(/different from your current one/i);
  });

  it('refuses an empty current password', () => {
    expect(errorFor({ ...valid, currentPassword: '' }, 'currentPassword')).toMatch(
      /enter your current password/i,
    );
  });

  /**
   * The regression this file exists for.
   *
   * <p>`123456789` is nine characters, which the twelve-character minimum would reject. It is
   * also exactly what an account seeded with `SEED_ADMIN_PASSWORD` can be holding, because the
   * seed writes the hash directly and never passes through `passwordInput`. Applying the
   * minimum to the CURRENT field would lock precisely those accounts out of improving
   * themselves — the rule working backwards, stopping the change it exists to encourage.
   */
  it('accepts a current password that would fail the rule for a new one', () => {
    const result = changePasswordInput.safeParse({
      currentPassword: '123456789',
      newPassword: 'something-considerably-longer',
      confirmPassword: 'something-considerably-longer',
    });
    expect(result.success).toBe(true);
  });
});
