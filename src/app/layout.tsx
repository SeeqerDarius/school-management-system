import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Sankofa School Platform',
    template: '%s · Sankofa',
  },
  description: 'School management, academics, finance, HR and payroll.',
  // This application is behind authentication and holds children's records. It must not be
  // indexed, and the directive costs nothing to state explicitly.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximum-scale and no user-scalable=no: pinch-zoom is how a lot of people read, and
  // disabling it is one of the most common accessibility failures on the web (§95).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111820' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GH">
      <body className="min-h-dvh antialiased">
        {/* The first stop for a keyboard user on every page. Visually hidden until focused. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50
                     focus:rounded-md focus:bg-[var(--color-primary)] focus:px-4 focus:py-2
                     focus:text-[var(--color-primary-ink)]"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
