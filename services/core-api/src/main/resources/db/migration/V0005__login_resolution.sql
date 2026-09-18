-- =====================================================================================
-- V0005 — Login resolution
--
-- THE BOOTSTRAP PROBLEM
-- ---------------------
-- identity.app_user is protected by RLS: a row is visible in platform scope, to the user
-- themselves, or to a tenant the user is a member of. At sign-in none of those hold yet —
-- we have a Firebase UID and nothing else, so `app.user_id` is not set and the policy
-- correctly hides every row.
--
-- The narrow, reviewed answer is one SECURITY DEFINER function. It is the ONLY RLS bypass
-- on the login path, it returns the minimum needed to establish a session, and it never
-- returns a row to a caller who did not already present a verified token for that UID.
--
-- Alternatives rejected:
--   * A second connection as the BYPASSRLS migration role — gives the whole login path
--     unrestricted read of every user in the platform, to solve a single lookup.
--   * A policy allowing anonymous reads of app_user — turns the user table into an
--     enumeration oracle for anyone who can reach the API.
--
-- SECURITY DEFINER DISCIPLINE
-- ---------------------------
-- search_path is pinned. Without it, a caller who can create objects in a schema earlier in
-- their search_path can shadow a table this function references and have it run against
-- their own. EXECUTE is revoked from PUBLIC and granted only to the application role.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- An invited user has no Firebase UID until they complete sign-up
--
-- Users are invited by a school, not self-registered: holding a Firebase account must never
-- be sufficient to obtain a platform identity. The invitation row therefore exists before any
-- credential does, so firebase_uid has to be nullable. The unique index still holds, because
-- PostgreSQL permits multiple NULLs in a unique index.
-- -------------------------------------------------------------------------------------

ALTER TABLE identity.app_user ALTER COLUMN firebase_uid DROP NOT NULL;

COMMENT ON COLUMN identity.app_user.firebase_uid IS
    'Provider identifier, NULL until an invited user completes sign-up and the account is '
    'linked. Users are invited, never self-registered.';

-- -------------------------------------------------------------------------------------
-- identity.resolve_login
--
-- Called once per sign-in, after the identity token has already been cryptographically
-- verified. Two paths:
--
--   1. Returning user  — matched on firebase_uid.
--   2. Invited user    — matched on email where the account is PENDING_INVITE and not yet
--                        linked to any credential. The link is written here, atomically, so
--                        two concurrent first sign-ins cannot both claim the invitation.
--
-- Anything else returns no rows, and the caller refuses the sign-in. In particular, an
-- unknown email does NOT create an account.
-- -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION identity.resolve_login(
        p_firebase_uid  text,
        p_email         text,
        p_email_verified boolean)
    RETURNS TABLE (
        user_id             uuid,
        status              text,
        sessions_valid_from timestamptz,
        mfa_required        boolean,
        newly_linked        boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = identity, platform, pg_catalog, pg_temp
AS $$
DECLARE
    v_user identity.app_user%ROWTYPE;
BEGIN
    IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN
        RAISE EXCEPTION 'resolve_login requires a verified provider uid'
            USING ERRCODE = '22023';
    END IF;

    -- Path 1: a returning user.
    SELECT * INTO v_user
      FROM identity.app_user u
     WHERE u.firebase_uid = p_firebase_uid;

    IF FOUND THEN
        RETURN QUERY SELECT v_user.id, v_user.status, v_user.sessions_valid_from,
                            v_user.mfa_required, false;
        RETURN;
    END IF;

    -- Path 2: claim a pending invitation. FOR UPDATE SKIP LOCKED is deliberate: if two
    -- sign-ins race for the same invitation, one claims it and the other finds nothing and
    -- is refused, rather than both proceeding.
    SELECT * INTO v_user
      FROM identity.app_user u
     WHERE lower(u.email) = lower(p_email)
       AND u.status = 'PENDING_INVITE'
       AND u.firebase_uid IS NULL
       FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        -- No account, or an account already bound to a different credential. Either way the
        -- sign-in is refused. Holding a provider account is not a route to a platform identity.
        RETURN;
    END IF;

    UPDATE identity.app_user
       SET firebase_uid   = p_firebase_uid,
           email_verified = p_email_verified,
           status         = 'ACTIVE',
           updated_at     = now()
     WHERE id = v_user.id;

    RETURN QUERY SELECT v_user.id, 'ACTIVE'::text, v_user.sessions_valid_from,
                        v_user.mfa_required, true;
END;
$$;

COMMENT ON FUNCTION identity.resolve_login(text, text, boolean) IS
    'The single RLS bypass on the sign-in path. Resolves a verified provider uid to a platform '
    'user, claiming a pending invitation if one matches. Never creates an account.';

REVOKE ALL ON FUNCTION identity.resolve_login(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.resolve_login(text, text, boolean) TO "${appRole}";

-- -------------------------------------------------------------------------------------
-- identity.memberships_for_user
--
-- Also SECURITY DEFINER, and for the same reason: immediately after sign-in the user must be
-- shown the schools they belong to, before any tenant is bound. Strictly scoped to one user
-- id, which the caller has just proven ownership of.
-- -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION identity.memberships_for_user(p_user_id uuid)
    RETURNS TABLE (
        membership_id   uuid,
        tenant_id       uuid,
        tenant_slug     text,
        tenant_name     text,
        principal_type  text,
        status          text)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = identity, platform, pg_catalog, pg_temp
AS $$
    SELECT m.id, m.tenant_id, t.slug, t.display_name, m.principal_type, m.status
      FROM identity.membership m
      JOIN platform.tenant t ON t.id = m.tenant_id
     WHERE m.user_id = p_user_id
       AND m.status = 'ACTIVE'
       -- A suspended or cancelled school cannot be entered, but its data is untouched and
       -- the membership is not destroyed (§10).
       AND t.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')
     ORDER BY t.display_name;
$$;

COMMENT ON FUNCTION identity.memberships_for_user(uuid) IS
    'Schools a verified user may enter. Scoped to a single user id, which the caller has just '
    'authenticated as.';

REVOKE ALL ON FUNCTION identity.memberships_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.memberships_for_user(uuid) TO "${appRole}";

-- -------------------------------------------------------------------------------------
-- Session token index
--
-- Sessions are looked up by token hash on every authenticated request, so this is the single
-- hottest query in the system. The unique index from V0002 already serves it; this partial
-- index keeps the revocation sweep cheap as the table grows.
-- -------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_user_session_membership
    ON identity.user_session (membership_id) WHERE revoked_at IS NULL;
