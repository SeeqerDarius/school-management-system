import 'server-only';

import { requireActiveSession } from '@/server/auth/session';
import { withRequestContext } from '@/server/db-context';

/**
 * Reads for a person's own account.
 *
 * <p>Always the signed-in user, resolved from the session. Nothing here takes an id, so there
 * is no parameter for a caller to point at somebody else's row — and the `app_user_read`
 * policy would refuse it anyway, since it admits only `id = app.current_user_id()`.
 */

export interface AccountIdentity {
  email: string;
  fullName: string;
}

export async function ownAccount(): Promise<AccountIdentity | null> {
  const { userId } = await requireActiveSession();

  const user = await withRequestContext({ userId }, (tx) =>
    tx.appUser.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true },
    }),
  );

  return user ?? null;
}
