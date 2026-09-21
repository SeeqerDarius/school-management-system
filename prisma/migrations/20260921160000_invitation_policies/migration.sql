-- =====================================================================================
-- Row-level security for the invitation flow.
--
-- `20260921030000_tenant_rls_policies` deliberately gave app_user no INSERT policy, and noted
-- that an invitation flow would need one. This is that migration.
--
-- Two new pieces of request context, bound per transaction like the others:
--
--   app.invite_email        the one address an invitation is being issued to
--   app.invite_token_hash   the hashed token an anonymous visitor is redeeming
--
-- Both exist for the same reason app.sign_in_email does: a transaction that has no session yet
-- still has to touch exactly one user row, and naming which one in the request context is what
-- lets the database enforce "that one and no other" instead of trusting the query to be careful.
-- =====================================================================================

CREATE OR REPLACE FUNCTION app.current_invite_email() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$ SELECT NULLIF(current_setting('app.invite_email', true), '') $$;

CREATE OR REPLACE FUNCTION app.current_invite_token_hash() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$ SELECT NULLIF(current_setting('app.invite_token_hash', true), '') $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sankofa_app;

-- -------------------------------------------------------------------------------------
-- Reading a user.
--
-- Adds two cases to the existing three (self, and the address being authenticated):
--
--   * the address being invited — so issuing an invitation can ask "does this person already
--     have an account?", which matters because one human with children at two schools is one
--     user with two memberships, not two users;
--   * the row holding a specific invite token hash — so redemption can find who the token
--     belongs to without being told, and without being able to enumerate anyone else.
--
-- Both are narrow by construction. The caller does not choose a predicate; it names one address
-- or one token hash in the request context, and that is the only row the policy admits.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS app_user_read ON public.app_user;
CREATE POLICY app_user_read ON public.app_user
  AS PERMISSIVE FOR SELECT TO sankofa_app
  USING (
    id = app.current_user_id()
    OR email = app.current_sign_in_email()
    OR email = app.current_invite_email()
    OR "inviteTokenHash" = app.current_invite_token_hash()
  );

-- -------------------------------------------------------------------------------------
-- Creating a user.
--
-- Only the address the transaction declared it was inviting. A bug that built the wrong row —
-- or a compromised action asked to create an administrator under an attacker's address — is
-- refused by the database unless that address is the one already named in the context.
--
-- Note what this does NOT grant: nothing here lets the application set a password hash, a
-- status, or a membership. Those are separate columns and separate tables with their own rules,
-- and an invited user is created with no password at all — `passwordHash` stays null until the
-- invitation is redeemed, which is the only path that sets it.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS app_user_invite ON public.app_user;
CREATE POLICY app_user_invite ON public.app_user
  AS PERMISSIVE FOR INSERT TO sankofa_app
  WITH CHECK (email = app.current_invite_email());

COMMENT ON POLICY app_user_invite ON public.app_user IS
  'An invitation may create exactly the address it declared in app.invite_email, and no other.';

-- -------------------------------------------------------------------------------------
-- Updating a user during redemption.
--
-- No new policy. Redemption finds the row by its token hash and then binds `app.user_id` to the
-- id it just read, so the existing self-update policy applies for the rest of the transaction.
--
-- That re-bind is safe for the same reason sign-in's is: the value comes from a row the
-- transaction has already authenticated — against a 256-bit single-use token here, against a
-- bcrypt comparison there — and never from anything the caller sent.
-- -------------------------------------------------------------------------------------
