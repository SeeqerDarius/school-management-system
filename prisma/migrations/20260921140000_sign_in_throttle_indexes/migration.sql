-- =====================================================================================
-- Indexes for sign-in throttling.
--
-- The limiter counts recent SIGN_IN_FAILED rows in `security_event` — by the keyed hash of
-- the address being attempted, and by the client address. That count runs on **every** sign-in
-- attempt, before the bcrypt comparison, so it has to be an index lookup. Without these it is
-- a sequential scan over the whole security log, growing with exactly the traffic the limiter
-- exists to survive: a credential-stuffing run would make each attempt more expensive than the
-- bcrypt call it was added to avoid.
--
-- Both are partial. Well over 99% of the log is not a failed sign-in, and restricting the index
-- to the rows the limiter reads keeps it small enough to stay cached.
--
-- AGENTS.md: "indexes ship with the migration that creates the query, not in a later
-- performance pass." This is that migration.
-- =====================================================================================

-- By account. `detail->>'emailHash'` is an expression index, because the hash lives in the JSON
-- payload rather than a column: the raw address is never stored (it is anonymous input at
-- sign-in time), and a dedicated column for a value only this one query reads would be a schema
-- change Prisma would then try to manage.
CREATE INDEX IF NOT EXISTS security_event_signin_account_idx
  ON public.security_event ((detail ->> 'emailHash'), "occurredAt" DESC)
  WHERE "eventType" = 'SIGN_IN_FAILED';

-- By client address.
CREATE INDEX IF NOT EXISTS security_event_signin_address_idx
  ON public.security_event ("ipAddress", "occurredAt" DESC)
  WHERE "eventType" = 'SIGN_IN_FAILED';

COMMENT ON INDEX public.security_event_signin_account_idx IS
  'Sign-in throttle: recent failures per attempted address. Keep in step with checkSignInThrottle.';
COMMENT ON INDEX public.security_event_signin_address_idx IS
  'Sign-in throttle: recent failures per client address. Keep in step with checkSignInThrottle.';
