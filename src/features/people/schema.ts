import { z } from 'zod';

/**
 * Input validation for invitations.
 *
 * <p>Server-side, inside the actions. The forms echo these messages as a courtesy; the server
 * decides.
 */

/** The hats a school can invite somebody to wear today. */
export const INVITABLE_PRINCIPAL_TYPES = ['STAFF', 'TEACHER', 'GUARDIAN'] as const;

export const inviteMemberInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Enter an email address')
    .max(254)
    .email('That does not look like an email address'),
  fullName: z.string().trim().min(1, 'Enter their full name').max(160),
  principalType: z.enum(INVITABLE_PRINCIPAL_TYPES, {
    message: 'Choose what this person is at the school',
  }),
  // Optional: a person can be invited first and given a role afterwards. An invitation with no
  // role produces somebody who can sign in and see nothing, which is a legitimate holding state.
  roleId: z.string().uuid('Choose a role').optional().or(z.literal('')),
});

/**
 * The password an invited person sets.
 *
 * <p>Length only, deliberately. Composition rules — an uppercase, a digit, a symbol — push
 * people towards `Password1!` and its cousins, which are in every credential-stuffing list
 * there is, while banning the long passphrases that are actually strong. NIST SP 800-63B says
 * the same, and says to check against known-breached lists instead. That check does not exist
 * yet and is recorded as a gap rather than replaced by theatre here.
 */
export const passwordInput = z
  .string()
  .min(12, 'Use at least 12 characters — a short phrase you will remember works well')
  .max(200, 'That is longer than 200 characters');

export const redeemInvitationInput = z
  .object({
    token: z.string().trim().min(1, 'This link is missing its invitation code'),
    password: passwordInput,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  });

export type InviteMemberInput = z.infer<typeof inviteMemberInput>;
