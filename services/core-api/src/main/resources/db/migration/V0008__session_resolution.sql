-- =====================================================================================
-- V0008 — Session resolution
--
-- The same bootstrapping problem as V0005, one step later in the request lifecycle.
--
-- SessionResolver runs on EVERY authenticated request, before any context is bound — it is
-- the thing that establishes the context. Its lookup joins identity.user_session to
-- identity.app_user to check account status and the session cut-off. user_session carries no
-- RLS, but app_user does, and with no `app.user_id` set yet the policy correctly hides every
-- row. The join therefore returned nothing and every authenticated request became a 401.
--
-- Loosening the app_user policy is not an option: it is what stops one tenant enumerating the
-- platform's user base. So, as with resolve_login, the answer is one narrow SECURITY DEFINER
-- function that returns only what establishing a session requires.
--
-- WHY THIS IS SAFE
-- ----------------
-- It is keyed on a SHA-256 of the presented session token. A caller who already holds a valid
-- token is not stopped by a row predicate — they are the session. The function returns no
-- personal data beyond what the session mechanism needs: no name, no email, no phone.
-- =====================================================================================

CREATE OR REPLACE FUNCTION identity.resolve_session(p_token_hash bytea)
    RETURNS TABLE (
        session_id          uuid,
        user_id             uuid,
        membership_id       uuid,
        issued_at           timestamptz,
        expires_at          timestamptz,
        revoked_at          timestamptz,
        mfa_satisfied       boolean,
        user_status         text,
        sessions_valid_from timestamptz)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = identity, pg_catalog, pg_temp
AS $$
    SELECT s.id, s.user_id, s.membership_id, s.issued_at, s.expires_at, s.revoked_at,
           s.mfa_satisfied, u.status, u.sessions_valid_from
      FROM identity.user_session s
      JOIN identity.app_user u ON u.id = s.user_id
     WHERE s.token_hash = p_token_hash;
$$;

COMMENT ON FUNCTION identity.resolve_session(bytea) IS
    'Resolves a session token hash to the minimum needed to establish a request context. '
    'SECURITY DEFINER because this runs before any context exists — it is what creates one. '
    'Returns no name, email or phone: only session and account-state fields.';

REVOKE ALL ON FUNCTION identity.resolve_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.resolve_session(bytea) TO "${appRole}";

-- -------------------------------------------------------------------------------------
-- identity.touch_session
--
-- Records that a session was used, for the device/session list a user can review and for
-- idle-timeout decisions. Same reason for SECURITY DEFINER: it runs during resolution.
--
-- Deliberately does NOT extend expires_at. A session has a fixed lifetime from issue; making
-- it slide on activity means a stolen token stays alive indefinitely so long as the attacker
-- keeps using it.
-- -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION identity.touch_session(p_session_id uuid)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = identity, pg_catalog, pg_temp
AS $$
    UPDATE identity.user_session
       SET last_seen_at = now()
     WHERE id = p_session_id AND revoked_at IS NULL;
$$;

COMMENT ON FUNCTION identity.touch_session(uuid) IS
    'Stamps last_seen_at. Never extends expires_at: a sliding expiry keeps a stolen token '
    'alive for as long as the attacker keeps using it.';

REVOKE ALL ON FUNCTION identity.touch_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.touch_session(uuid) TO "${appRole}";
