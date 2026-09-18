-- =====================================================================================
-- V0006 — Recording sign-in outcomes
--
-- WHAT WENT WRONG, AND WHY IT IS WORTH WRITING DOWN
-- --------------------------------------------------
-- V0004 gave identity.security_event a correct, strict RLS policy: a row is writable when it
-- belongs to the current tenant, or when it is platform-wide and belongs to the current user.
--
-- Sign-in satisfies neither. At the moment a sign-in is refused there IS no current user and
-- no current tenant — that is the whole point of a refusal. So the very events most worth
-- recording, the failed ones, were the events the policy rejected. SessionApiIT caught it as
-- a 500 on every sign-in.
--
-- The naive fixes are both wrong:
--   * Loosening the policy to allow anonymous inserts turns the security log into somewhere
--     anyone can write arbitrary rows, which is worse than not having one.
--   * Catching and swallowing the failure would mean credential-stuffing against parent
--     accounts leaves no trace at all, and would violate Invariant I-8 besides.
--
-- The right shape is a narrow SECURITY DEFINER writer. Recording that something happened is
-- legitimately a system action that occurs *before* identity is established. These functions
-- only ever INSERT or stamp a timestamp; neither can read a row back, so neither widens what
-- any caller can see.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- identity.record_security_event
--
-- The single writer for the security log. Callable with a NULL user (a refused sign-in for
-- an email that matches no account) and a NULL tenant (before a school is chosen).
--
-- It writes only the columns passed. There is deliberately no free-form payload parameter
-- beyond `detail`, and the application never puts a token, password or session identifier
-- in it — see the logging deny-list in docs/SECURITY.md.
-- -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION identity.record_security_event(
        p_user_id    uuid,
        p_tenant_id  uuid,
        p_event_type text,
        p_severity   text,
        p_ip         text,
        p_user_agent text)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = identity, platform, pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'A security event must have a type' USING ERRCODE = '22023';
    END IF;

    -- gen_random_uuid rather than a caller-supplied id: nothing about an audit row should be
    -- chosen by the thing being audited.
    v_id := gen_random_uuid();

    INSERT INTO identity.security_event
        (id, user_id, tenant_id, event_type, severity, ip_address, user_agent)
    VALUES (v_id, p_user_id, p_tenant_id, p_event_type,
            coalesce(nullif(btrim(p_severity), ''), 'INFO'),
            -- A malformed address must not cost us the audit row. The event matters more
            -- than the field.
            CASE WHEN p_ip IS NULL OR btrim(p_ip) = '' THEN NULL
                 ELSE (CASE WHEN p_ip ~ '^[0-9a-fA-F:.]+$' THEN p_ip::inet ELSE NULL END)
            END,
            left(p_user_agent, 512));

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION identity.record_security_event(uuid, uuid, text, text, text, text) IS
    'The only writer for identity.security_event. SECURITY DEFINER because a refused sign-in '
    'has no current user or tenant, and a refused sign-in is exactly what must be recorded.';

REVOKE ALL ON FUNCTION identity.record_security_event(uuid, uuid, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.record_security_event(uuid, uuid, text, text, text, text)
    TO "${appRole}";

-- -------------------------------------------------------------------------------------
-- identity.record_sign_in
--
-- Stamps last_login_at. Same bootstrapping problem: at this point in the sign-in the user is
-- known but no context is bound yet, so the app_user write policy would filter the UPDATE to
-- zero rows — silently. A silent no-op is worse than an error, because nothing looks broken
-- while the "last seen" column quietly never moves.
-- -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION identity.record_sign_in(p_user_id uuid)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = identity, pg_catalog, pg_temp
AS $$
    UPDATE identity.app_user SET last_login_at = now() WHERE id = p_user_id;
$$;

COMMENT ON FUNCTION identity.record_sign_in(uuid) IS
    'Stamps last_login_at during sign-in, before any tenant context exists.';

REVOKE ALL ON FUNCTION identity.record_sign_in(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.record_sign_in(uuid) TO "${appRole}";

-- -------------------------------------------------------------------------------------
-- Close the direct-insert path
--
-- With a dedicated writer in place, the application role has no reason to INSERT into the
-- table directly. Revoking it means a future change cannot accidentally reintroduce the
-- unaudited path, and it keeps the SECURITY DEFINER function genuinely the only writer
-- rather than merely the recommended one.
-- -------------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON identity.security_event FROM "${appRole}";
GRANT SELECT ON identity.security_event TO "${appRole}";

DROP POLICY IF EXISTS security_event_write ON identity.security_event;

COMMENT ON TABLE identity.security_event IS
    'Append-only security log. Written only through identity.record_security_event; the '
    'application role holds SELECT and nothing else.';
