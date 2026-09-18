-- =====================================================================================
-- V0010 — School structure: campuses, branding, academic years, terms
--
-- The first business module, and the reference pattern the rest follow.
--
-- NOTHING HERE ENCODES GHANA
-- --------------------------
-- An academic year is a named date range with ordered terms inside it. That shape fits a
-- Ghanaian three-term year, an English three-term year, a two-semester international school
-- and an IB calendar without change, because the *count* and the *names* are data (§14, §136).
-- There is no TERM_ONE constant anywhere, and nothing assumes three of anything.
--
-- THE CONSTRAINTS ARE THE POINT
-- -----------------------------
-- Two academic years that overlap, or two "current" years at once, are the kind of corruption
-- that surfaces months later as a report card printed against the wrong term. Application code
-- alone cannot prevent it under concurrency — two administrators submitting at the same moment
-- both pass a read-then-check. So the rules live in the database as exclusion constraints and
-- partial unique indexes, where concurrency is the engine's problem rather than ours.
-- =====================================================================================

-- Needed for EXCLUDE constraints that combine an equality column (tenant_id) with a range
-- overlap. Trusted since PostgreSQL 13, so the schema owner can install it without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS school;

COMMENT ON SCHEMA school IS
    'Tenant-configurable school structure: campuses, branding, academic calendar.';

-- -------------------------------------------------------------------------------------
-- Campus (§138)
--
-- One tenant may run several campuses. Students, staff, classes, finances and reporting are
-- scoped to a campus; head office sees the consolidated view with permission.
-- -------------------------------------------------------------------------------------

CREATE TABLE school.campus (
    id            uuid        PRIMARY KEY,
    tenant_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    code          text        NOT NULL,
    name          text        NOT NULL,
    -- Exactly one main campus per tenant. Single-campus schools get one and never think
    -- about it again; the model does not special-case them.
    is_main       boolean     NOT NULL DEFAULT false,
    status        text        NOT NULL DEFAULT 'ACTIVE',

    address_line1 text,
    address_line2 text,
    city          text,
    region        text,
    postal_code   text,
    country_code  char(2),
    phone_e164    text,
    email         text,
    -- A campus in another country keeps its own timezone; otherwise it inherits the tenant's.
    timezone      text,

    opened_on     date,
    closed_on     date,

    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid,
    updated_at    timestamptz,
    updated_by    uuid,
    version       bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_campus_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'CLOSED')),
    CONSTRAINT ck_campus_code CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT ck_campus_country CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_campus_phone CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
    CONSTRAINT ck_campus_dates CHECK (closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on)
);

CREATE UNIQUE INDEX uq_campus_tenant_code ON school.campus (tenant_id, code);
CREATE UNIQUE INDEX uq_campus_one_main ON school.campus (tenant_id) WHERE is_main;
CREATE INDEX ix_campus_tenant_status ON school.campus (tenant_id, status);

CREATE TRIGGER trg_campus_stamp BEFORE INSERT ON school.campus
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_campus_touch BEFORE UPDATE ON school.campus
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE school.campus ENABLE ROW LEVEL SECURITY;
ALTER TABLE school.campus FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON school.campus
    USING      (tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (tenant_id = platform.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- Branding (§8)
--
-- One row per tenant. The logo is a Storage path, never a URL: the bucket is private and
-- access is granted through short-lived signed URLs (§68), so persisting a URL here would
-- either be dead within the hour or evidence the bucket is public.
-- -------------------------------------------------------------------------------------

CREATE TABLE school.branding (
    tenant_id        uuid        PRIMARY KEY REFERENCES platform.tenant(id) ON DELETE CASCADE,
    motto            text,
    logo_path        text,
    logo_updated_at  timestamptz,
    -- Constrained to accessible usage at render time rather than rejected outright, so a
    -- school's real brand colour is honoured without failing contrast (§94).
    primary_color    text,
    accent_color     text,

    report_card_header text,
    receipt_header     text,
    invoice_header     text,
    document_footer    text,
    -- Names and titles printed on report cards, receipts and letters.
    head_signature_name  text,
    head_signature_title text,

    website          text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid,
    updated_at       timestamptz,
    updated_by       uuid,
    version          bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_branding_primary_color CHECK (
        primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT ck_branding_accent_color CHECK (
        accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TRIGGER trg_branding_stamp BEFORE INSERT ON school.branding
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_branding_touch BEFORE UPDATE ON school.branding
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE school.branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE school.branding FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON school.branding
    USING      (tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (tenant_id = platform.current_tenant_id());

COMMENT ON COLUMN school.branding.logo_path IS
    'Path within the private Storage bucket. Never a URL: access is by short-lived signed URL.';

-- -------------------------------------------------------------------------------------
-- Academic year
--
-- Lifecycle: PLANNED -> ACTIVE -> CLOSED. Enforced in the service layer as a state machine,
-- with the structural rules below enforced here where concurrency cannot defeat them.
-- -------------------------------------------------------------------------------------

CREATE TABLE school.academic_year (
    id          uuid        PRIMARY KEY,
    tenant_id   uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    code        text        NOT NULL,
    name        text        NOT NULL,
    starts_on   date        NOT NULL,
    ends_on     date        NOT NULL,
    status      text        NOT NULL DEFAULT 'PLANNED',
    -- The year new work defaults to. Exactly one per tenant, at most.
    is_current  boolean     NOT NULL DEFAULT false,
    closed_at   timestamptz,
    closed_by   uuid,

    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid,
    updated_at  timestamptz,
    updated_by  uuid,
    version     bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_year_status CHECK (status IN ('PLANNED', 'ACTIVE', 'CLOSED')),
    CONSTRAINT ck_year_dates CHECK (ends_on > starts_on),
    CONSTRAINT ck_year_code CHECK (length(btrim(code)) BETWEEN 1 AND 32),
    -- A closed year must record when and by whom; a year that is not closed must not claim to.
    CONSTRAINT ck_year_closed_consistency CHECK (
        (status = 'CLOSED' AND closed_at IS NOT NULL)
        OR (status <> 'CLOSED' AND closed_at IS NULL)),
    -- A closed year cannot also be the current one.
    CONSTRAINT ck_year_closed_not_current CHECK (NOT (status = 'CLOSED' AND is_current))
);

CREATE UNIQUE INDEX uq_year_tenant_code ON school.academic_year (tenant_id, code);

-- At most one current year per tenant. A partial unique index rather than an application
-- check, because two administrators clicking "make current" at the same instant both pass a
-- read-then-check and both write.
CREATE UNIQUE INDEX uq_year_one_current ON school.academic_year (tenant_id) WHERE is_current;

-- Academic years within a tenant may not overlap. Inclusive on both ends: a year that ends on
-- 31 July and another starting 31 July are in conflict, and saying so here is kinder than
-- discovering it when a report card resolves to two terms.
ALTER TABLE school.academic_year
    ADD CONSTRAINT ex_year_no_overlap
    EXCLUDE USING gist (
        tenant_id WITH =,
        daterange(starts_on, ends_on, '[]') WITH &&);

CREATE INDEX ix_year_tenant_status ON school.academic_year (tenant_id, status);

CREATE TRIGGER trg_year_stamp BEFORE INSERT ON school.academic_year
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_year_touch BEFORE UPDATE ON school.academic_year
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE school.academic_year ENABLE ROW LEVEL SECURITY;
ALTER TABLE school.academic_year FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON school.academic_year
    USING      (tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (tenant_id = platform.current_tenant_id());

COMMENT ON TABLE school.academic_year IS
    'A named date range with ordered terms. Deliberately carries no assumption about how many '
    'terms a year has, or what they are called (§136).';

-- -------------------------------------------------------------------------------------
-- Term
-- -------------------------------------------------------------------------------------

CREATE TABLE school.term (
    id               uuid        PRIMARY KEY,
    tenant_id        uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    academic_year_id uuid        NOT NULL REFERENCES school.academic_year(id) ON DELETE CASCADE,
    sequence         integer     NOT NULL,
    code             text        NOT NULL,
    name             text        NOT NULL,
    starts_on        date        NOT NULL,
    ends_on          date        NOT NULL,
    status           text        NOT NULL DEFAULT 'PLANNED',
    is_current       boolean     NOT NULL DEFAULT false,
    -- The date reports are expected to be published; drives the "results overdue" signal.
    reports_due_on   date,
    closed_at        timestamptz,
    closed_by        uuid,

    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid,
    updated_at       timestamptz,
    updated_by       uuid,
    version          bigint      NOT NULL DEFAULT 0,

    CONSTRAINT ck_term_status CHECK (status IN ('PLANNED', 'ACTIVE', 'CLOSED')),
    CONSTRAINT ck_term_dates CHECK (ends_on > starts_on),
    CONSTRAINT ck_term_sequence CHECK (sequence BETWEEN 1 AND 12),
    CONSTRAINT ck_term_closed_consistency CHECK (
        (status = 'CLOSED' AND closed_at IS NOT NULL)
        OR (status <> 'CLOSED' AND closed_at IS NULL)),
    CONSTRAINT ck_term_closed_not_current CHECK (NOT (status = 'CLOSED' AND is_current))
);

CREATE UNIQUE INDEX uq_term_year_sequence ON school.term (academic_year_id, sequence);
CREATE UNIQUE INDEX uq_term_year_code ON school.term (academic_year_id, code);
CREATE UNIQUE INDEX uq_term_one_current ON school.term (tenant_id) WHERE is_current;
CREATE INDEX ix_term_year ON school.term (academic_year_id, sequence);
CREATE INDEX ix_term_tenant_status ON school.term (tenant_id, status);

-- Terms within one academic year may not overlap either.
ALTER TABLE school.term
    ADD CONSTRAINT ex_term_no_overlap
    EXCLUDE USING gist (
        academic_year_id WITH =,
        daterange(starts_on, ends_on, '[]') WITH &&);

-- A term must sit inside its academic year, and must belong to the same tenant as that year.
-- Both are cross-row rules, so they need a trigger rather than a CHECK.
CREATE OR REPLACE FUNCTION school.validate_term_within_year()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    y record;
BEGIN
    SELECT tenant_id, starts_on, ends_on, status
      INTO y
      FROM school.academic_year
     WHERE id = NEW.academic_year_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Academic year % does not exist', NEW.academic_year_id
            USING ERRCODE = '23503';
    END IF;

    -- Belt and braces against a term being attached to another tenant's year. RLS would
    -- already hide that year, but a trigger that says so is clearer than a silent not-found.
    IF y.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION 'Term tenant % does not match academic year tenant %',
            NEW.tenant_id, y.tenant_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.starts_on < y.starts_on OR NEW.ends_on > y.ends_on THEN
        RAISE EXCEPTION
            'Term % (% to %) falls outside its academic year (% to %)',
            NEW.code, NEW.starts_on, NEW.ends_on, y.starts_on, y.ends_on
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_term_within_year
    BEFORE INSERT OR UPDATE OF starts_on, ends_on, academic_year_id, tenant_id ON school.term
    FOR EACH ROW EXECUTE FUNCTION school.validate_term_within_year();

CREATE TRIGGER trg_term_stamp BEFORE INSERT ON school.term
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_row();
CREATE TRIGGER trg_term_touch BEFORE UPDATE ON school.term
    FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE school.term ENABLE ROW LEVEL SECURITY;
ALTER TABLE school.term FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON school.term
    USING      (tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (tenant_id = platform.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- Privileges
-- -------------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA school TO "${appRole}";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA school TO "${appRole}";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA school TO "${appRole}";

ALTER DEFAULT PRIVILEGES IN SCHEMA school
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}";
ALTER DEFAULT PRIVILEGES IN SCHEMA school
    GRANT EXECUTE ON FUNCTIONS TO "${appRole}";
