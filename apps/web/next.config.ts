import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next generates its own AGENTS.md and CLAUDE.md into this directory on every dev start.
  // The repository already has a normative AGENTS.md at the root, and a second, generated one
  // competing with it is worse than none: whichever an agent reads first wins, and the
  // generated file knows nothing about tenant isolation or the accounting invariants.
  agentRules: false,

  // Fail the build on a type error rather than shipping one. This is Next's default today;
  // stating it means a future default change cannot quietly weaken the gate.
  //
  // There is deliberately no `eslint` key: Next 16 removed ESLint from `next build`, so lint
  // is a separate gate now. CI runs `npm run lint` explicitly for exactly that reason — had we
  // relied on the build to run it, lint would simply have stopped happening at the upgrade
  // with nothing failing to say so.
  typescript: { ignoreBuildErrors: false },

  // The API is reached server-side only, so the browser never talks to another origin and no
  // CORS or CSP connect-src allowance is needed for it.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The web tier renders HTML, so its CSP is necessarily looser than the API's
          // `default-src 'none'`. These are the directives that cost nothing and close real
          // holes; a nonce-based script-src is the next step and is tracked as a gap.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
          },
          // Children's records. Nothing here should ever be indexed or archived.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;
