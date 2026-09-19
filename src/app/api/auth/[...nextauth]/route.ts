import NextAuth from 'next-auth';

import { authOptions } from '@/server/auth/options';

/**
 * NextAuth's route handler. Sign-in, sign-out, session and CSRF all live here.
 *
 * <p>Nothing else in the application should import `next-auth` directly on the server; use the
 * helpers in `src/server/auth/session.ts`, which return a checked session rather than a
 * possibly-null one.
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
