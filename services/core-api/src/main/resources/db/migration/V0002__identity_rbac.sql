-- =====================================================================================
-- V0002 — Identity, roles, permissions, memberships
--
-- Firebase Authentication owns credentials, MFA, recovery and session revocation.
-- This schema owns *authorization*, and it is authoritative (§13). Firebase custom
-- claims may cache a coarse summary for edge routing, but a claim is never consulted
-- for an access decision — the tables below are.
--
-- SHAPE
-- -----
--   app_user           one row per human, platform-wide. A parent with children in two
--                      subscribing schools is ONE user with TWO memberships.
--   permission         the global catalogue of granular capabilities (§12).
--   role               a named bundle of permissions. System roles (tenant_id IS NULL)
--                      are templates; a tenant may also define its own (§11).
--   membership         user x tenant. The unit that authorization actually resolves to.
--   membership_role    roles held within one membership.
--   permission_grant   individual allow/deny at membership level, so a sensitive
--                      permission can be granted to one person without minting a role.
--
-- Roles are never string comparisons scattered through the code (§11). The only thing
-- application code ever asks is: does this membership hold this permission code?
-- =====================================================================================

CREATE SCHEMA IF NOT EXISTS identity;

COMMENT ON SCHEMA identity IS
    'Users, memberships, roles and granular permissions. Authoritative for authorization.';

-- -------------------------------------------------------------------------------------
-- Users
-- -------------------------------------------------------------------------------------

CREATE TABLE identity.app_user (
    id               uuid        PRIMARY KEY,
    firebase_uid     text        NOT NULL,
    email            text        NOT NULL,
    email_verified   boolean     NOT NULL DEFAULT false,
    phone_e164       text,
    phone_verified   boolean     NOT NULL DEFAULT false,
    full_name        text        NOT NULL,
    preferred_name   text,
    avatar_path      text,
    locale           text,
    timezone         text,
    status           text        NOT NULL DEFAULT 'PENDING_INVITE',
    mfa_enrolled     boolean     NOT NULL DEFAULT false,
    -- Privileged roles can be required to enrol MFA before the session is usable (§13).
    mfa_required     boolean     NOT NULL DEFAULT false,
    last_login_at    timestamptz,
    -- Any Firebase session issued before this instant is rejected, so a compromised
    -- account can be cut off without waiting for token expiry.
    sessions_valid_from timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid,
    updated_at       timestamptz,
    updated_by       uuid,
    version          bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_app_user_status CHECK (status IN (
        'PENDING_INVITE','ACTIVE','DISABLED','LOCKED','CLOSED')),
    CONSTRAINT ck_app_user_email CHECK (position('@' IN email) > 1),
    CONSTRAINT ck_app_user_phone CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

CREATE UNIQUE INDEX uq_app_user_firebase_uid ON identity.app_user (firebase_uid);
CREATE UNIQUE INDEX uq_app_user_email ON identity.app_user (lower(email));
CREATE INDEX ix_app_user_status ON identity.app_user (status);

CREATE TRIGGER trg_app_user_stamp BEFORE INSERT ON identity.app_user
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_app_user_touch BEFORE UPDATE ON identity.app_user
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

COMMENT ON TABLE identity.app_user IS
    'Platform-wide human identity, keyed to a Firebase UID. Credentials live in Firebase; '
    'this row never stores a password or a token.';
COMMENT ON COLUMN identity.app_user.sessions_valid_from IS
    'Session cut-off. Advancing this instant revokes every outstanding session (§13).';

-- -------------------------------------------------------------------------------------
-- Permissions
--
-- Codes are MODULE_NOUN_VERB, stable forever, and referenced by code in @RequiresPermission.
-- Seeded in V0003 so the catalogue is reviewable as data, not scattered through code.
-- -------------------------------------------------------------------------------------

CREATE TABLE identity.permission (
    id           uuid        PRIMARY KEY,
    code         text        NOT NULL,
    module       text        NOT NULL,
    description  text        NOT NULL,
    -- Sensitive permissions must be individually assignable and are excluded from
    -- "grant the whole module" conveniences (§12).
    is_sensitive boolean     NOT NULL DEFAULT false,
    -- Permissions touching children's health, discipline or counselling records (§58, §88).
    is_child_sensitive boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_permission_code CHECK (code ~ '^[A-Z][A-Z0-9_]{2,79}$')
);

CREATE UNIQUE INDEX uq_permission_code ON identity.permission (code);
CREATE INDEX ix_permission_module ON identity.permission (module);

COMMENT ON TABLE identity.permission IS
    'Global catalogue of granular capabilities. The only unit an access check consults.';

-- -------------------------------------------------------------------------------------
-- Roles
-- -------------------------------------------------------------------------------------

CREATE TABLE identity.role (
    id           uuid        PRIMARY KEY,
    -- NULL means a system role template, available to every tenant (§11).
    tenant_id    uuid        REFERENCES platform.tenant(id) ON DELETE CASCADE,
    code         text        NOT NULL,
    name         text        NOT NULL,
    description  text,
    scope        text        NOT NULL DEFAULT 'SCHOOL',
    -- System roles cannot be edited or deleted by a tenant; they can be copied.
    is_system    boolean     NOT NULL DEFAULT false,
    is_assignable boolean    NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid,
    updated_at   timestamptz,
    updated_by   uuid,
    version      bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_role_scope CHECK (scope IN ('PLATFORM','SCHOOL')),
    CONSTRAINT ck_role_code CHECK (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    -- A system role belongs to no tenant; a tenant role must not claim to be a system role.
    CONSTRAINT ck_role_system_has_no_tenant CHECK (
        (is_system AND tenant_id IS NULL) OR (NOT is_system AND tenant_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_role_system_code ON identity.role (code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX uq_role_tenant_code ON identity.role (tenant_id, code) WHERE tenant_id IS NOT NULL;

CREATE TRIGGER trg_role_stamp BEFORE INSERT ON identity.role
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_role_touch BEFORE UPDATE ON identity.role
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE identity.role ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.role FORCE  ROW LEVEL SECURITY;

-- System templates are readable by everyone; tenant roles only within their tenant.
CREATE POLICY role_read ON identity.role
    FOR SELECT
    USING (tenant_id IS NULL
           OR platform.is_platform_scope()
           OR tenant_id = platform.current_tenant_id_or_null());

CREATE POLICY role_write ON identity.role
    FOR ALL
    USING (platform.is_platform_scope()
           OR (tenant_id IS NOT NULL AND tenant_id = platform.current_tenant_id()))
    WITH CHECK (platform.is_platform_scope()
           OR (tenant_id IS NOT NULL AND tenant_id = platform.current_tenant_id()));

CREATE TABLE identity.role_permission (
    role_id       uuid        NOT NULL REFERENCES identity.role(id) ON DELETE CASCADE,
    permission_id uuid        NOT NULL REFERENCES identity.permission(id) ON DELETE RESTRICT,
    granted_at    timestamptz NOT NULL DEFAULT now(),
    granted_by    uuid,

    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX ix_role_permission_permission ON identity.role_permission (permission_id);

-- -------------------------------------------------------------------------------------
-- Memberships
--
-- The join between a human and a tenant. Authorization always resolves through here,
-- which is what makes "the browser cannot choose its tenant" structurally true (§7).
-- -------------------------------------------------------------------------------------

CREATE TABLE identity.membership (
    id            uuid        PRIMARY KEY,
    tenant_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    user_id       uuid        NOT NULL REFERENCES identity.app_user(id) ON DELETE RESTRICT,
    -- Optional campus restriction for multi-campus tenants (§138). NULL = whole tenant.
    campus_id     uuid,
    status        text        NOT NULL DEFAULT 'INVITED',
    -- What kind of principal this membership represents, so the portal can route.
    principal_type text       NOT NULL,
    -- Set once the corresponding domain row exists (staff / student / guardian).
    principal_id  uuid,
    display_title text,
    started_on    date,
    ended_on      date,
    invited_at    timestamptz,
    accepted_at   timestamptz,
    last_active_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid,
    updated_at    timestamptz,
    updated_by    uuid,
    version       bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_membership_status CHECK (status IN (
        'INVITED','ACTIVE','SUSPENDED','ENDED')),
    CONSTRAINT ck_membership_principal CHECK (principal_type IN (
        'STAFF','TEACHER','STUDENT','GUARDIAN','PLATFORM','SUPPORT')),
    CONSTRAINT ck_membership_dates CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);

-- One membership per user per tenant per principal type: a person may be both a member
-- of staff and a parent at the same school, and those are genuinely different hats.
CREATE UNIQUE INDEX uq_membership_user_tenant_type
    ON identity.membership (tenant_id, user_id, principal_type);
CREATE INDEX ix_membership_user ON identity.membership (user_id) WHERE status = 'ACTIVE';
CREATE INDEX ix_membership_tenant_status ON identity.membership (tenant_id, status);
CREATE INDEX ix_membership_principal ON identity.membership (tenant_id, principal_type, principal_id);

CREATE TRIGGER trg_membership_stamp BEFORE INSERT ON identity.membership
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_membership_touch BEFORE UPDATE ON identity.membership
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE identity.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership FORCE  ROW LEVEL SECURITY;

-- Sign-in must enumerate a user's memberships *before* a tenant is known, so the
-- self-read case is explicit here. It is limited to the acting user's own rows.
CREATE POLICY membership_self_read ON identity.membership
    FOR SELECT
    USING (user_id = platform.current_user_id()
           OR platform.is_platform_scope()
           OR tenant_id = platform.current_tenant_id_or_null());

CREATE POLICY membership_write ON identity.membership
    FOR ALL
    USING      (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id())
    WITH CHECK (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id());

COMMENT ON TABLE identity.membership IS
    'User x tenant. The effective tenant of a request is the tenant of the verified '
    'membership — never a subdomain, header or parameter (Invariant I-1).';

CREATE TABLE identity.membership_role (
    membership_id uuid        NOT NULL REFERENCES identity.membership(id) ON DELETE CASCADE,
    role_id       uuid        NOT NULL REFERENCES identity.role(id) ON DELETE RESTRICT,
    granted_at    timestamptz NOT NULL DEFAULT now(),
    granted_by    uuid,

    PRIMARY KEY (membership_id, role_id)
);

CREATE INDEX ix_membership_role_role ON identity.membership_role (role_id);

-- Individual allow/deny, so a single sensitive capability can be given to one person
-- without inventing a bespoke role — and so it can be explicitly taken away (§12).
CREATE TABLE identity.membership_permission_grant (
    membership_id uuid        NOT NULL REFERENCES identity.membership(id) ON DELETE CASCADE,
    permission_id uuid        NOT NULL REFERENCES identity.permission(id) ON DELETE RESTRICT,
    effect        text        NOT NULL,
    reason        text        NOT NULL,
    granted_at    timestamptz NOT NULL DEFAULT now(),
    granted_by    uuid        NOT NULL,
    expires_at    timestamptz,

    PRIMARY KEY (membership_id, permission_id),
    CONSTRAINT ck_grant_effect CHECK (effect IN ('ALLOW','DENY'))
);

COMMENT ON TABLE identity.membership_permission_grant IS
    'Per-person overrides. DENY always wins over any role-derived ALLOW.';

-- -------------------------------------------------------------------------------------
-- Effective permission resolution
--
-- One definition, used by the application and by tests, so there is no second
-- implementation to drift. DENY beats ALLOW; expired grants are ignored.
-- -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION identity.effective_permissions(p_membership_id uuid)
    RETURNS TABLE (code text)
    LANGUAGE sql
    STABLE
AS $$
    WITH from_roles AS (
        SELECT p.code
          FROM identity.membership_role mr
          JOIN identity.role_permission rp ON rp.role_id = mr.role_id
          JOIN identity.permission p       ON p.id = rp.permission_id
         WHERE mr.membership_id = p_membership_id
    ),
    direct AS (
        SELECT p.code, g.effect
          FROM identity.membership_permission_grant g
          JOIN identity.permission p ON p.id = g.permission_id
         WHERE g.membership_id = p_membership_id
           AND (g.expires_at IS NULL OR g.expires_at > now())
    )
    SELECT DISTINCT c.code
      FROM (
            SELECT code FROM from_roles
            UNION
            SELECT code FROM direct WHERE effect = 'ALLOW'
           ) c
     WHERE c.code NOT IN (SELECT code FROM direct WHERE effect = 'DENY');
$$;

COMMENT ON FUNCTION identity.effective_permissions(uuid) IS
    'Single authoritative definition of what a membership may do. DENY overrides ALLOW.';

-- -------------------------------------------------------------------------------------
-- User visibility
--
-- A school administrator may read the users who are members of their school, and nobody
-- else. This stops a tenant enumerating the platform's user base through a bare id lookup.
-- The policy is non-recursive: membership's own policy does not reference app_user.
-- -------------------------------------------------------------------------------------

ALTER TABLE identity.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.app_user FORCE  ROW LEVEL SECURITY;

CREATE POLICY app_user_read ON identity.app_user
    FOR SELECT
    USING (
        platform.is_platform_scope()
        OR id = platform.current_user_id()
        OR EXISTS (
            SELECT 1
              FROM identity.membership m
             WHERE m.user_id = app_user.id
               AND m.tenant_id = platform.current_tenant_id_or_null())
    );

CREATE POLICY app_user_write ON identity.app_user
    FOR ALL
    USING (
        platform.is_platform_scope()
        OR id = platform.current_user_id()
        OR EXISTS (
            SELECT 1
              FROM identity.membership m
             WHERE m.user_id = app_user.id
               AND m.tenant_id = platform.current_tenant_id_or_null())
    )
    WITH CHECK (
        platform.is_platform_scope()
        OR id = platform.current_user_id()
        OR EXISTS (
            SELECT 1
              FROM identity.membership m
             WHERE m.user_id = app_user.id
               AND m.tenant_id = platform.current_tenant_id_or_null())
    );

-- -------------------------------------------------------------------------------------
-- Sessions and security events
-- -------------------------------------------------------------------------------------

CREATE TABLE identity.user_session (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL REFERENCES identity.app_user(id) ON DELETE CASCADE,
    -- The membership this session is currently acting through; switching tenant
    -- re-binds it, and the switch is authorized against the user's membership list.
    membership_id  uuid        REFERENCES identity.membership(id) ON DELETE SET NULL,
    -- SHA-256 of the session token. The token itself is never stored (§85).
    token_hash     bytea       NOT NULL,
    issued_at      timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    last_seen_at   timestamptz,
    revoked_at     timestamptz,
    revoked_reason text,
    ip_address     inet,
    user_agent     text,
    device_label   text,
    mfa_satisfied  boolean     NOT NULL DEFAULT false,

    CONSTRAINT ck_session_expiry CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX uq_user_session_token ON identity.user_session (token_hash);
CREATE INDEX ix_user_session_user_active ON identity.user_session (user_id)
    WHERE revoked_at IS NULL;
CREATE INDEX ix_user_session_expiry ON identity.user_session (expires_at)
    WHERE revoked_at IS NULL;

COMMENT ON COLUMN identity.user_session.token_hash IS
    'SHA-256 of the opaque session token. Storing the token itself would make a database '
    'read equivalent to account takeover.';

-- Append-only: notifications for password reset, MFA change, new device, privileged
-- grant, API key creation (§179). Never updated, never deleted by the application.
CREATE TABLE identity.security_event (
    id           uuid        PRIMARY KEY,
    user_id      uuid        REFERENCES identity.app_user(id) ON DELETE SET NULL,
    tenant_id    uuid        REFERENCES platform.tenant(id) ON DELETE SET NULL,
    event_type   text        NOT NULL,
    severity     text        NOT NULL DEFAULT 'INFO',
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    ip_address   inet,
    user_agent   text,
    detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    correlation_id text,

    CONSTRAINT ck_security_event_severity CHECK (severity IN ('INFO','NOTICE','WARNING','CRITICAL'))
);

CREATE INDEX ix_security_event_user ON identity.security_event (user_id, occurred_at DESC);
CREATE INDEX ix_security_event_tenant ON identity.security_event (tenant_id, occurred_at DESC);
CREATE INDEX ix_security_event_type ON identity.security_event (event_type, occurred_at DESC);

CREATE TRIGGER trg_security_event_immutable
    BEFORE UPDATE OR DELETE ON identity.security_event
    FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

-- -------------------------------------------------------------------------------------
-- Support access (§74)
--
-- Platform Support never gets invisible, unlimited impersonation. Access is requested
-- with a reason, time-boxed, permission-limited, visibly banners the UI, and is fully
-- audited. Revocation is immediate.
-- -------------------------------------------------------------------------------------

CREATE TABLE identity.support_access_grant (
    id              uuid        PRIMARY KEY,
    tenant_id       uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    support_user_id uuid        NOT NULL REFERENCES identity.app_user(id) ON DELETE RESTRICT,
    reason          text        NOT NULL,
    status          text        NOT NULL DEFAULT 'REQUESTED',
    -- Explicit, narrow permission list. Never "all permissions".
    permission_codes text[]     NOT NULL,
    requested_at    timestamptz NOT NULL DEFAULT now(),
    approved_by     uuid        REFERENCES identity.app_user(id),
    approved_at     timestamptz,
    starts_at       timestamptz,
    expires_at      timestamptz,
    revoked_at      timestamptz,
    revoked_by      uuid        REFERENCES identity.app_user(id),

    CONSTRAINT ck_support_status CHECK (status IN (
        'REQUESTED','APPROVED','ACTIVE','EXPIRED','REVOKED','DENIED')),
    CONSTRAINT ck_support_window CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at),
    CONSTRAINT ck_support_reason CHECK (length(btrim(reason)) >= 10),
    CONSTRAINT ck_support_permissions CHECK (cardinality(permission_codes) > 0)
);

CREATE INDEX ix_support_grant_tenant ON identity.support_access_grant (tenant_id, requested_at DESC);
CREATE INDEX ix_support_grant_active ON identity.support_access_grant (expires_at)
    WHERE status = 'ACTIVE';

ALTER TABLE identity.support_access_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.support_access_grant FORCE  ROW LEVEL SECURITY;

-- A school can always see who has had support access to its data, and why.
CREATE POLICY support_grant_visibility ON identity.support_access_grant
    USING      (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id())
    WITH CHECK (platform.is_platform_scope());

COMMENT ON TABLE identity.support_access_grant IS
    'Time-boxed, reasoned, permission-limited support access. The school can always read '
    'its own history of who entered and why (§74).';

-- -------------------------------------------------------------------------------------
-- Grants
-- -------------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA identity TO "${appRole}";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO "${appRole}";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA identity TO "${appRole}";

ALTER DEFAULT PRIVILEGES IN SCHEMA identity
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}";
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
    GRANT EXECUTE ON FUNCTIONS TO "${appRole}";
