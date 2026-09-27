/**
 * Normalising the database URL before Prisma sees it.
 *
 * <h2>The failure this exists to prevent</h2>
 * Supabase's Supavisor on port 6543 is a TRANSACTION-mode pooler, and transaction mode does
 * not support prepared statements. Prisma uses them by default. Connect to 6543 without
 * `pgbouncer=true` and the first query under any concurrency fails with:
 *
 * <pre>prepared statement "s0" already exists</pre>
 *
 * <p>`.env.example` has said this is "NOT OPTIONAL" since the refactor landed. It still
 * happened in production, because a connection string is pasted by a human into a dashboard
 * and a comment in a file the human never opened cannot stop them.
 *
 * <h2>Why the fix is here rather than in the runbook</h2>
 * The flag is not a tuning preference. On 6543 it is the difference between a working
 * application and one that fails intermittently, under load, with an error naming no cause
 * anybody would connect to a missing query parameter. That makes it an invariant, and this
 * codebase's habit is to make invariants unbreakable rather than documented — the same
 * reasoning that puts the attendance rules in triggers instead of in a Server Action.
 *
 * <p>So: if the URL points at the transaction pooler and does not mention `pgbouncer`, it is
 * added. Everything else is passed through untouched.
 *
 * <h2>Why the string is edited rather than parsed</h2>
 * A database password can contain anything, and `new URL()` re-encodes the userinfo when it
 * serialises. Round-tripping a URL through it can silently change the password, which fails
 * authentication in a way that looks nothing like a URL-encoding bug. Only the query string
 * is touched here; every byte before the `?` is left exactly as it arrived.
 */

/** Supavisor in transaction mode. Session mode (5432) supports prepared statements and is left alone. */
const TRANSACTION_POOLER_PORT = '6543';

export function poolerSafeDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;

  // Everything is anchored past the final '@', which is where the userinfo ends. A password
  // is allowed to contain '?', ':' and '/' — percent-encoded in a well-formed URL, but not
  // always in one typed by hand — and each of those would otherwise be mistaken for the
  // query separator, the port or the path.
  const authorityStart = raw.lastIndexOf('@') + 1;

  const separator = raw.indexOf('?', authorityStart);
  const base = separator === -1 ? raw : raw.slice(0, separator);
  const query = separator === -1 ? '' : raw.slice(separator + 1);

  // The port: the :NNNN in the authority, followed by the path or by the end of it.
  const authority = base.slice(authorityStart);
  const port = /:(\d+)(?:\/|$)/.exec(authority)?.[1];

  if (port !== TRANSACTION_POOLER_PORT) return raw;

  // An explicit `pgbouncer=false` is somebody's deliberate choice, and overriding a deliberate
  // choice silently is worse than the bug. Only absence is corrected.
  if (/(?:^|&)pgbouncer=/.test(query)) return raw;

  return query === '' ? `${base}?pgbouncer=true` : `${base}?${query}&pgbouncer=true`;
}
