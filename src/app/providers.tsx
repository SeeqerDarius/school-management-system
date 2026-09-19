'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

/**
 * Client-side session context.
 *
 * <p>Needed only by the few components that must *change* the session from the browser — signing
 * in, and switching schools. Every page that merely reads identity does so on the server, where
 * the answer cannot be edited by whoever is holding the browser.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      // Nothing here polls. Re-fetching the session on an interval would hammer the database for
      // every open tab in every staffroom, to learn something that has almost never changed.
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
}
