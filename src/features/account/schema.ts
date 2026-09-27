import { z } from 'zod';

import { passwordInput } from '@/features/people/schema';

/**
 * Input validation for a person changing their own password.
 *
 * <p>`passwordInput` is imported rather than restated. Two definitions of "a good enough
 * password" drift apart, and the one that drifts is always the one nobody is looking at — a
 * product where the invitation screen demands twelve characters and the change screen accepts
 * six has the weaker rule, not both.
 */

export const changePasswordInput = z
  .object({
    /**
     * Length is deliberately NOT checked here.
     *
     * <p>This field is checked against bcrypt, not against a policy. Applying the twelve
     * character minimum would lock out anybody whose password predates that rule — including
     * an account created by the seed, which sets the hash directly and never passes through
     * `passwordInput`. Refusing to let exactly those people change to something stronger would
     * be the rule working backwards.
     */
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordInput,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Choose a password different from your current one',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordInput>;
