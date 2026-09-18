import { z } from 'zod';

/**
 * Environment configuration, validated at module load.
 *
 * <p>A missing `CORE_API_BASE_URL` should stop the process at start-up with a message naming
 * the variable, not surface twenty minutes later as an unexplained fetch failure in a bursar's
 * browser. Validating here is the difference between the two.
 *
 * The split below is a security boundary, not a naming convention. Anything under
 * `NEXT_PUBLIC_` is inlined into the client bundle and is therefore public to every visitor;
 * everything in `serverEnv` must never be imported from a Client Component.
 */

const serverSchema = z.object({
  /** The core API. Server-to-server only — the browser never talks to it directly. */
  CORE_API_BASE_URL: z.url(),
  /**
   * Signs the session cookie. At least 32 bytes, different in every environment.
   * Generate with: openssl rand -base64 48
   */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/**
 * Firebase's client configuration is public by design: it identifies the project, it does not
 * authorise anything. Access is decided by Firebase security rules and by the core API, never
 * by possession of these values.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

/**
 * Reads and validates the server environment.
 *
 * Deliberately a function rather than a module-level constant: `next build` evaluates modules
 * without the runtime environment present, and a top-level throw would make the build fail for
 * a variable that will exist perfectly well at run time.
 */
export function serverEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `Server environment is not configured correctly — ${detail}. ` +
        'See .env.example at the repository root.',
    );
  }
  return parsed.data;
}

/**
 * Firebase's public configuration, or `null` when the project is not configured.
 *
 * Returning null rather than throwing lets the sign-in page say "authentication is not
 * configured in this environment" instead of rendering a form that cannot possibly work.
 */
export function firebaseConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
} | null {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });

  if (!parsed.success) return null;

  const { NEXT_PUBLIC_FIREBASE_API_KEY: apiKey } = parsed.data;
  const { NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: authDomain } = parsed.data;
  const { NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId } = parsed.data;
  const { NEXT_PUBLIC_FIREBASE_APP_ID: appId } = parsed.data;

  if (!apiKey || !authDomain || !projectId || !appId) return null;

  return { apiKey, authDomain, projectId, appId };
}
