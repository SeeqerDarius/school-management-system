-- =====================================================================================
-- V0001 — Platform core
--
-- Establishes the tenancy substrate every other migration depends on:
--   * the tenant registry
--   * the session-variable contract that Row Level Security is keyed on
--   * the shared helper functions and triggers (audit columns, guarded numbering)
--   * the transactional outbox
--
-- SESSION VARIABLE CONTRACT
-- -------------------------
-- The application sets these per transaction, via SET LOCAL, from the *verified*
-- membership — never from a header, body, query parameter or subdomain (Invariant I-1):
--
--   app.tenant_id      uuid   active tenant; unset in platform scope
--   app.user_id        uuid   acting principal, used to fill audit columns
--   app.platform_scope 'true' when acting in Platform Super Admin scope
--
-- WHY THERE IS NO PLATFORM BYPASS ON TENANT DATA
-- ----------------------------------------------
-- Tenant-owned tables have exactly one policy: tenant_id = platform.current_tenant_id().
-- There is deliberately no "platform admin sees everything" escape hatch, because §105
-- requires that Platform Super Admin does not routinely browse school records. Platform
-- reporting reads the aggregate counters in platform.tenant_usage, which the outbox
-- maintains. This keeps least privilege structural rather than procedural.
--
-- ROLES
-- -----
-- Two database roles, created by database/bootstrap/00_roles.sql (cluster-level, so it is
-- not a Flyway concern):
--   ${appRole}      runtime. NOT the table owner, NOT superuser, NOT BYPASSRLS.
--   ${migrateRole}  owns the schemas, runs Flyway, has BYPASSRLS for system jobs.
--
-- A superuser bypasses RLS unconditionally, which would make every isolation test vacuous.
-- Tests therefore connect as ${appRole}. See docs/adr/0012-testing-database-strategy.md.
-- =====================================================================================

CREATE SCHEMA IF NOT EXISTS platform;

COMMENT ON SCHEMA platform IS
    'Cross-tenant substrate: tenant registry, RLS contract, numbering, outbox, jobs.';

-- -------------------------------------------------------------------------------------
-- Session context accessors
-- -------------------------------------------------------------------------------------

-- Raises when the tenant is not set, so an unscoped query fails loudly rather than
-- silently returning every tenant's rows. This is the whole point.
CREATE OR REPLACE FUNCTION platform.current_tenant_id()
    RETURNS uuid
    LANGUAGE plpgsql
    STABLE
    PARALLEL SAFE
AS $$
DECLARE
    raw text;
BEGIN
    raw := current_setting('app.tenant_id', true);
    IF raw IS NULL OR raw = '' THEN
        RAISE EXCEPTION
            'app.tenant_id is not set: refusing to execute an unscoped tenant query'
            USING ERRCODE = '42501';
    END IF;
    RETURN raw::uuid;
END;
$$;

COMMENT ON FUNCTION platform.current_tenant_id() IS
    'Active tenant for RLS. Raises 42501 when unset so unscoped queries fail closed.';

-- Non-raising variant, for the few places that legitimately tolerate an absent tenant
-- (audit triggers on platform-scope tables, for example).
CREATE OR REPLACE FUNCTION platform.current_tenant_id_or_null()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
AS $$
    SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION platform.current_user_id()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION platform.is_platform_scope()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
AS $$
    SELECT coalesce(nullif(current_setting('app.platform_scope', true), ''), 'false')::boolean;
$$;

-- -------------------------------------------------------------------------------------
-- Shared triggers
-- -------------------------------------------------------------------------------------

-- Maintains updated_at / updated_by / version on every row that carries them.
-- Optimistic locking: Spring Data JDBC compares `version`, this trigger advances it.
CREATE OR REPLACE FUNCTION platform.touch_row()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    NEW.updated_by := coalesce(platform.current_user_id(), NEW.updated_by);
    NEW.version    := coalesce(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform.stamp_row()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.created_by := coalesce(NEW.created_by, platform.current_user_id());
    NEW.version    := coalesce(NEW.version, 0);
    RETURN NEW;
END;
$$;

-- Blocks UPDATE and DELETE outright. Used on append-only tables: audit log,
-- posted journal lines, payroll history (Invariant I-3).
CREATE OR REPLACE FUNCTION platform.forbid_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        '% on %.% is not permitted: this table is append-only',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$;

-- -------------------------------------------------------------------------------------
-- Tenant registry
-- -------------------------------------------------------------------------------------

CREATE TABLE platform.tenant (
    id              uuid        PRIMARY KEY,
    slug            text        NOT NULL,
    legal_name      text        NOT NULL,
    display_name    text        NOT NULL,
    short_name      text,
    status          text        NOT NULL DEFAULT 'PROVISIONING',
    -- Localisation defaults. Ghana is the first optimized configuration, not the only
    -- supported one (§136) — these are data, never assumptions baked into code.
    country_code    char(2)     NOT NULL,
    default_currency char(3)    NOT NULL,
    timezone        text        NOT NULL DEFAULT 'UTC',
    locale          text        NOT NULL DEFAULT 'en-GH',
    date_format     text        NOT NULL DEFAULT 'dd/MM/yyyy',
    -- Custom domain support (§9); the subdomain remains a routing hint only.
    custom_domain   text,
    onboarding_state text       NOT NULL DEFAULT 'NOT_STARTED',
    activated_at    timestamptz,
    suspended_at    timestamptz,
    closed_at       timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz,
    updated_by      uuid,
    version         bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_tenant_status CHECK (status IN (
        'PROVISIONING','TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','CLOSED')),
    CONSTRAINT ck_tenant_onboarding CHECK (onboarding_state IN (
        'NOT_STARTED','IN_PROGRESS','COMPLETE')),
    -- Subdomain-safe, and long enough to be readable.
    CONSTRAINT ck_tenant_slug_format CHECK (slug ~ '^[a-z][a-z0-9-]{1,61}[a-z0-9]$'),
    CONSTRAINT ck_tenant_country CHECK (country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_tenant_currency CHECK (default_currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX uq_tenant_slug ON platform.tenant (slug);
CREATE UNIQUE INDEX uq_tenant_custom_domain
    ON platform.tenant (lower(custom_domain)) WHERE custom_domain IS NOT NULL;
CREATE INDEX ix_tenant_status ON platform.tenant (status);

CREATE TRIGGER trg_tenant_stamp BEFORE INSERT ON platform.tenant
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_tenant_touch BEFORE UPDATE ON platform.tenant
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- The registry itself: visible in platform scope, and self-visible in tenant scope.
-- This is the one table where a platform-scope predicate is correct, because the
-- registry is what platform administration legitimately operates on.
ALTER TABLE platform.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_registry_read ON platform.tenant
    FOR SELECT
    USING (platform.is_platform_scope() OR id = platform.current_tenant_id_or_null());

CREATE POLICY tenant_registry_write ON platform.tenant
    FOR ALL
    USING (platform.is_platform_scope())
    WITH CHECK (platform.is_platform_scope());

COMMENT ON TABLE platform.tenant IS
    'One row per subscribing school organisation. The unit of data isolation.';
COMMENT ON COLUMN platform.tenant.slug IS
    'Subdomain label. A routing hint for UX only — never the authorization decision (§9).';

-- -------------------------------------------------------------------------------------
-- Aggregate usage counters
--
-- Platform administration reads these instead of querying tenant tables directly,
-- which is what makes the "no platform bypass" rule above practical.
-- -------------------------------------------------------------------------------------

CREATE TABLE platform.tenant_usage (
    tenant_id           uuid        PRIMARY KEY REFERENCES platform.tenant(id) ON DELETE CASCADE,
    active_students     integer     NOT NULL DEFAULT 0,
    active_staff        integer     NOT NULL DEFAULT 0,
    active_guardians    integer     NOT NULL DEFAULT 0,
    campuses            integer     NOT NULL DEFAULT 0,
    storage_bytes       bigint      NOT NULL DEFAULT 0,
    sms_sent_period     integer     NOT NULL DEFAULT 0,
    email_sent_period   integer     NOT NULL DEFAULT 0,
    period_started_on   date,
    recomputed_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_usage_non_negative CHECK (
        active_students >= 0 AND active_staff >= 0 AND active_guardians >= 0
        AND campuses >= 0 AND storage_bytes >= 0
        AND sms_sent_period >= 0 AND email_sent_period >= 0)
);

ALTER TABLE platform.tenant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_usage FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_usage_access ON platform.tenant_usage
    USING (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id_or_null());

COMMENT ON TABLE platform.tenant_usage IS
    'Denormalised per-tenant counters maintained from the outbox; the read surface for '
    'platform billing and quota enforcement, so platform admin never reads school rows.';

-- -------------------------------------------------------------------------------------
-- Human-facing reference numbering
--
-- STU-2026-000123, INV-2026-000045, REC-2026-000932, STAFF-0012 (§80).
-- Allocation takes a row lock, so concurrent cashiers cannot collide on a receipt number.
-- -------------------------------------------------------------------------------------

CREATE TABLE platform.reference_sequence (
    tenant_id   uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    scope       text        NOT NULL,
    period_key  text        NOT NULL DEFAULT '',
    prefix      text        NOT NULL DEFAULT '',
    pad_width   integer     NOT NULL DEFAULT 6,
    next_value  bigint      NOT NULL DEFAULT 1,
    updated_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, scope, period_key),
    CONSTRAINT ck_refseq_pad CHECK (pad_width BETWEEN 1 AND 18),
    CONSTRAINT ck_refseq_next CHECK (next_value >= 1)
);

ALTER TABLE platform.reference_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.reference_sequence FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON platform.reference_sequence
    USING      (tenant_id = platform.current_tenant_id())
    WITH CHECK (tenant_id = platform.current_tenant_id());

-- Returns the formatted reference and advances the counter atomically.
-- Numbers are never reused (§48): the counter only moves forward, and a rolled-back
-- transaction is the only way a number is skipped — which is acceptable, and audited.
CREATE OR REPLACE FUNCTION platform.next_reference(
    p_tenant_id  uuid,
    p_scope      text,
    p_period_key text DEFAULT '')
    RETURNS text
    LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix text;
    v_pad    integer;
    v_value  bigint;
BEGIN
    UPDATE platform.reference_sequence
       SET next_value = next_value + 1,
           updated_at = now()
     WHERE tenant_id = p_tenant_id
       AND scope = p_scope
       AND period_key = p_period_key
    RETURNING prefix, pad_width, next_value - 1
      INTO v_prefix, v_pad, v_value;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No reference sequence configured for tenant=% scope=% period=%',
            p_tenant_id, p_scope, p_period_key
            USING ERRCODE = '23503';
    END IF;

    RETURN concat_ws('-',
        nullif(v_prefix, ''),
        nullif(p_period_key, ''),
        lpad(v_value::text, v_pad, '0'));
END;
$$;

COMMENT ON FUNCTION platform.next_reference(uuid, text, text) IS
    'Concurrency-safe allocation of a human-facing reference number (§80, §48).';

-- -------------------------------------------------------------------------------------
-- Transactional outbox (§108)
--
-- Cross-module events are written in the SAME transaction as the state change, so a
-- notification can never claim something the database did not commit, and a committed
-- change can never lose its notification.
-- -------------------------------------------------------------------------------------

CREATE TABLE platform.outbox (
    id              uuid        PRIMARY KEY,
    tenant_id       uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    aggregate_type  text        NOT NULL,
    aggregate_id    uuid,
    event_type      text        NOT NULL,
    payload         jsonb       NOT NULL,
    status          text        NOT NULL DEFAULT 'PENDING',
    attempts        integer     NOT NULL DEFAULT 0,
    available_at    timestamptz NOT NULL DEFAULT now(),
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    processed_at    timestamptz,
    last_error      text,
    correlation_id  text,
    -- Guards against the same business event being emitted twice (§107).
    idempotency_key text,

    CONSTRAINT ck_outbox_status CHECK (status IN (
        'PENDING','PROCESSING','PROCESSED','FAILED','DEAD')),
    CONSTRAINT ck_outbox_attempts CHECK (attempts >= 0)
);

-- Partial index: the poller only ever scans work that is due.
CREATE INDEX ix_outbox_due ON platform.outbox (available_at, id)
    WHERE status IN ('PENDING','FAILED');
CREATE INDEX ix_outbox_tenant_occurred ON platform.outbox (tenant_id, occurred_at DESC);
CREATE UNIQUE INDEX uq_outbox_idempotency
    ON platform.outbox (tenant_id, event_type, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE platform.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.outbox FORCE  ROW LEVEL SECURITY;

-- Producers are always inside a tenant transaction. The poller runs as ${migrateRole},
-- which has BYPASSRLS, because dispatching is a system responsibility that legitimately
-- spans tenants.
CREATE POLICY tenant_isolation ON platform.outbox
    USING      (tenant_id = platform.current_tenant_id())
    WITH CHECK (tenant_id = platform.current_tenant_id());

COMMENT ON TABLE platform.outbox IS
    'Transactional outbox. Written in the same transaction as the state change it '
    'describes, drained by OutboxPoller. Never written from outside a business transaction.';

-- -------------------------------------------------------------------------------------
-- Background job observability (§109, §150)
-- -------------------------------------------------------------------------------------

CREATE TABLE platform.job_execution (
    id             uuid        PRIMARY KEY,
    tenant_id      uuid        REFERENCES platform.tenant(id) ON DELETE CASCADE,
    job_name       text        NOT NULL,
    status         text        NOT NULL DEFAULT 'RUNNING',
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    items_total    integer,
    items_ok       integer     NOT NULL DEFAULT 0,
    items_failed   integer     NOT NULL DEFAULT 0,
    error_summary  text,
    correlation_id text,

    CONSTRAINT ck_job_status CHECK (status IN (
        'RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED'))
);

CREATE INDEX ix_job_execution_name_started
    ON platform.job_execution (job_name, started_at DESC);
CREATE INDEX ix_job_execution_failed
    ON platform.job_execution (started_at DESC) WHERE status IN ('FAILED','PARTIAL');

COMMENT ON TABLE platform.job_execution IS
    'Every scheduled/background run, successful or not. A job that fails silently is a '
    'defect (Invariant I-8); this table is how failure becomes visible.';

-- -------------------------------------------------------------------------------------
-- Feature flags (§151)
--
-- Explicitly NOT an authorization mechanism. A flag controls rollout; permissions
-- control access. Never gate a security decision on a flag.
-- -------------------------------------------------------------------------------------

CREATE TABLE platform.feature_flag (
    id           uuid        PRIMARY KEY,
    code         text        NOT NULL,
    description  text        NOT NULL,
    enabled_globally boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz,

    CONSTRAINT ck_flag_code CHECK (code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE UNIQUE INDEX uq_feature_flag_code ON platform.feature_flag (code);

CREATE TABLE platform.tenant_feature_flag (
    tenant_id  uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    flag_id    uuid        NOT NULL REFERENCES platform.feature_flag(id) ON DELETE CASCADE,
    enabled    boolean     NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid,

    PRIMARY KEY (tenant_id, flag_id)
);

ALTER TABLE platform.tenant_feature_flag ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_feature_flag FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON platform.tenant_feature_flag
    USING      (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id())
    WITH CHECK (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id());

COMMENT ON TABLE platform.feature_flag IS
    'Rollout control only. Never an authorization boundary (§151).';

-- -------------------------------------------------------------------------------------
-- Grants
-- -------------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA platform TO "${appRole}";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO "${appRole}";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform TO "${appRole}";

-- Applies to tables created by later migrations in this schema.
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}";
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
    GRANT EXECUTE ON FUNCTIONS TO "${appRole}";
