-- ============================================================================
-- EAPIS — Enterprise Access & Permission Intelligence System
-- PHASE 1: SCHEMA DDL
-- PostgreSQL 14+ (uses recursive CTEs later in Phase 3/4; JSONB used here)
--
-- Normalization: schema is designed to 3NF.
--   - No repeating groups (all multi-valued relationships are junction tables:
--     role_hierarchy, role_permissions, employee_roles).
--   - No partial dependencies: every junction table's non-key attributes
--     (e.g. granted_at, justification on employee_roles) depend on the WHOLE
--     grant event, not on employee_id or role_id alone — which is exactly why
--     employee_roles has its own surrogate key (grant_id) instead of a
--     composite (employee_id, role_id) key: a composite key would force
--     "granted_at" to functionally depend on only PART of the key once an
--     employee is re-granted the same role after revocation (a lost history
--     problem), so a surrogate key + a UNIQUE constraint is used instead.
--   - No transitive dependencies: e.g. resource.owner_department is NOT
--     stored on resources (that would transitively depend on owner_id ->
--     employees.department); callers join to employees instead.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EMPLOYEES  (also implements the recursive MANAGES relationship via
--    manager_id, a self-referencing FK: Employee 1:M Employee)
-- ----------------------------------------------------------------------------
CREATE TABLE employees (
    employee_id     SERIAL PRIMARY KEY,
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    department      VARCHAR(100) NOT NULL,
    manager_id      INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'terminated')),
    hire_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (manager_id <> employee_id)
);

CREATE INDEX idx_employees_manager ON employees(manager_id);
CREATE INDEX idx_employees_department ON employees(department);

-- ----------------------------------------------------------------------------
-- 2. APP_USERS — authentication/authorization for the dashboard ITSELF.
--    Deliberately separate from "roles" (Section 6), which model enterprise
--    RBAC being analyzed, not who can log into EAPIS.
-- ----------------------------------------------------------------------------
CREATE TABLE app_users (
    user_id         SERIAL PRIMARY KEY,
    employee_id     INTEGER UNIQUE REFERENCES employees(employee_id) ON DELETE CASCADE,
    username        VARCHAR(100) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    system_role     VARCHAR(20) NOT NULL
                        CHECK (system_role IN ('admin', 'auditor', 'manager', 'viewer')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. ROLES
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
    role_id         SERIAL PRIMARY KEY,
    role_name       VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. ROLE_HIERARCHY — PARENT_OF, recursive M:N, modeled as a DAG (junction
--    table, NOT a single parent_role_id column) so a role can have MULTIPLE
--    parents. This is the critical design decision from Section 6: a
--    single-parent tree cannot represent indirect SoD conflicts that only
--    emerge from combined multi-parent inheritance.
--    NOTE: full acyclic enforcement (no cycles anywhere in the DAG) cannot be
--    expressed as a simple CHECK constraint — that requires a recursive CTE
--    walk, implemented as a BEFORE INSERT/UPDATE trigger in Phase 3.
-- ----------------------------------------------------------------------------
CREATE TABLE role_hierarchy (
    child_role_id   INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    parent_role_id  INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    PRIMARY KEY (child_role_id, parent_role_id),
    CHECK (child_role_id <> parent_role_id)
);

CREATE INDEX idx_role_hierarchy_parent ON role_hierarchy(parent_role_id);

-- ----------------------------------------------------------------------------
-- 5. PERMISSIONS
--    expected_frequency supports Section 8(b): excluding rare-but-legitimate
--    permissions from unused-access false positives.
-- ----------------------------------------------------------------------------
CREATE TABLE permissions (
    permission_id       SERIAL PRIMARY KEY,
    action              VARCHAR(50) NOT NULL,          -- e.g. 'create','approve','deploy'
    resource_type       VARCHAR(50) NOT NULL,          -- e.g. 'payment','user_account'
    risk_level          VARCHAR(20) NOT NULL DEFAULT 'low'
                            CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    expected_frequency  VARCHAR(20) NOT NULL DEFAULT 'regular'
                            CHECK (expected_frequency IN ('regular', 'occasional', 'rare')),
    description         TEXT,
    UNIQUE (action, resource_type)
);

-- ----------------------------------------------------------------------------
-- 6. RESOURCES
-- ----------------------------------------------------------------------------
CREATE TABLE resources (
    resource_id     SERIAL PRIMARY KEY,
    resource_name   VARCHAR(150) NOT NULL,
    resource_type   VARCHAR(50) NOT NULL,
    owner_id        INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_resources_owner ON resources(owner_id);

-- ----------------------------------------------------------------------------
-- 7. ROLE_PERMISSIONS — INCLUDES, Role M:N Permission
-- ----------------------------------------------------------------------------
CREATE TABLE role_permissions (
    role_id         INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id   INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- 8. EMPLOYEE_ROLES — HOLDS, Employee M:N Role.
--    Covers direct, temporary, delegated AND break-glass grants (Section 4 /
--    Section 9) with full who/when/why tracking and a revocation trail.
--    Surrogate grant_id (see normalization note at top of file) preserves
--    history across grant -> revoke -> re-grant cycles.
-- ----------------------------------------------------------------------------
CREATE TABLE employee_roles (
    grant_id        SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    role_id         INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    grant_type      VARCHAR(20) NOT NULL DEFAULT 'direct'
                        CHECK (grant_type IN ('direct', 'temporary', 'delegated', 'break_glass')),
    granted_by      INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    granted_at      TIMESTAMP NOT NULL DEFAULT now(),
    expires_at      TIMESTAMP,
    is_temporary    BOOLEAN NOT NULL DEFAULT FALSE,
    delegated_from  INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    justification   TEXT,                       -- mandatory for break_glass, see CHECK below
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked', 'expired')),
    revoked_by      INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    revoked_at      TIMESTAMP,
    UNIQUE (employee_id, role_id, granted_at),
    CHECK (expires_at IS NULL OR expires_at > granted_at),
    CHECK (grant_type <> 'break_glass' OR justification IS NOT NULL),
    CHECK (is_temporary = FALSE OR expires_at IS NOT NULL)
);

CREATE INDEX idx_employee_roles_employee ON employee_roles(employee_id);
CREATE INDEX idx_employee_roles_role ON employee_roles(role_id);
CREATE INDEX idx_employee_roles_status ON employee_roles(status);
CREATE INDEX idx_employee_roles_expires ON employee_roles(expires_at) WHERE status = 'active';

-- ----------------------------------------------------------------------------
-- 9. ACCESS_LOGS — GENERATES (Employee) / TARGET_OF (Resource), usage trail,
--    kept separate from AUDIT_LOGS per Section 4.
-- ----------------------------------------------------------------------------
CREATE TABLE access_logs (
    log_id          SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    resource_id     INTEGER NOT NULL REFERENCES resources(resource_id) ON DELETE CASCADE,
    action          VARCHAR(50) NOT NULL,
    occurred_at     TIMESTAMP NOT NULL DEFAULT now(),
    success         BOOLEAN NOT NULL,
    ip_address      INET NOT NULL
);

CREATE INDEX idx_access_logs_employee_time ON access_logs(employee_id, occurred_at);
CREATE INDEX idx_access_logs_resource_time ON access_logs(resource_id, occurred_at);

-- ----------------------------------------------------------------------------
-- 10. AUDIT_LOGS — TRIGGERS (Employee), permission/role CHANGE trail, kept
--     separate from ACCESS_LOGS (usage). old_value/new_value stored as JSONB
--     since the shape of what changed differs per target_type; storing this
--     as fixed columns would force nullable columns for every possible
--     entity type, which is exactly the kind of design 3NF steers away from.
--     Populated automatically by triggers in Phase 3, not by the app.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    audit_id        SERIAL PRIMARY KEY,
    actor_id        INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    target_type     VARCHAR(50) NOT NULL,   -- 'role','permission','employee_role', etc.
    target_id       INTEGER NOT NULL,
    change_type     VARCHAR(20) NOT NULL CHECK (change_type IN ('insert', 'update', 'delete')),
    old_value       JSONB,
    new_value       JSONB,
    occurred_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);

-- ----------------------------------------------------------------------------
-- 11. SOD_CONFLICT_RULES — CONFLICTS_WITH, recursive M:N on Permission.
--     This IS the configurable rule set (mirrors SAP GRC risk rule sets),
--     not hardcoded logic. permission_a_id < permission_b_id enforces a
--     canonical ordering so (A,B) and (B,A) can never both be stored as
--     separate "conflicts."
-- ----------------------------------------------------------------------------
CREATE TABLE sod_conflict_rules (
    rule_id         SERIAL PRIMARY KEY,
    permission_a_id INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    permission_b_id INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    severity        VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (permission_a_id < permission_b_id),
    UNIQUE (permission_a_id, permission_b_id)
);

-- ----------------------------------------------------------------------------
-- 12. FINDINGS — FLAGGED_IN (Employee), the single unified output table for
--     ALL detectors (SoD, unused access, anomalous access, privilege
--     escalation). This is the separation layer between detection logic
--     (database) and presentation (frontend) called out in Section 8/12.
--     related_entity is JSONB for the same reason as audit_logs.old_value:
--     each finding_type references a different shape of evidence
--     (e.g. a role_id + conflicting permission pair vs. a log_id list).
-- ----------------------------------------------------------------------------
CREATE TABLE findings (
    finding_id          SERIAL PRIMARY KEY,
    employee_id         INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    finding_type        VARCHAR(30) NOT NULL
                            CHECK (finding_type IN
                                ('sod_violation', 'unused_access', 'anomalous_access', 'privilege_escalation')),
    related_entity      JSONB,
    severity            VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status              VARCHAR(20) NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'under_review', 'resolved', 'false_positive')),
    detected_at         TIMESTAMP NOT NULL DEFAULT now(),
    resolved_by         INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    resolved_at         TIMESTAMP,
    resolution_notes    TEXT
);

CREATE INDEX idx_findings_employee ON findings(employee_id);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_type ON findings(finding_type);

-- ----------------------------------------------------------------------------
-- 13. ACCESS_REQUESTS — the request & approval workflow from Section 4/9.
--     Every request is later logged into audit_logs by a Phase 3 trigger
--     when reviewed_by/status change.
-- ----------------------------------------------------------------------------
CREATE TABLE access_requests (
    request_id      SERIAL PRIMARY KEY,
    requester_id    INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    role_id         INTEGER REFERENCES roles(role_id) ON DELETE CASCADE,
    resource_id     INTEGER REFERENCES resources(resource_id) ON DELETE CASCADE,
    is_temporary    BOOLEAN NOT NULL DEFAULT FALSE,
    is_break_glass  BOOLEAN NOT NULL DEFAULT FALSE,
    justification   TEXT,
    requested_at    TIMESTAMP NOT NULL DEFAULT now(),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by     INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMP,
    expires_at      TIMESTAMP,
    CHECK (is_break_glass = FALSE OR justification IS NOT NULL),
    CHECK (role_id IS NOT NULL OR resource_id IS NOT NULL)
);

CREATE INDEX idx_access_requests_status ON access_requests(status);
CREATE INDEX idx_access_requests_requester ON access_requests(requester_id);

-- ----------------------------------------------------------------------------
-- 14. RECERTIFICATION_CAMPAIGNS / RECERTIFICATION_ITEMS — periodic access
--     review workflow from Section 9. A campaign spawns one item per active
--     grant a manager must certify (keep/revoke).
-- ----------------------------------------------------------------------------
CREATE TABLE recertification_campaigns (
    campaign_id     SERIAL PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned', 'in_progress', 'completed')),
    CHECK (end_date > start_date)
);

CREATE TABLE recertification_items (
    item_id         SERIAL PRIMARY KEY,
    campaign_id     INTEGER NOT NULL REFERENCES recertification_campaigns(campaign_id) ON DELETE CASCADE,
    employee_id     INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    grant_id        INTEGER NOT NULL REFERENCES employee_roles(grant_id) ON DELETE CASCADE,
    reviewer_id     INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    decision        VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (decision IN ('pending', 'keep', 'revoke')),
    reviewed_at     TIMESTAMP,
    UNIQUE (campaign_id, grant_id)
);

CREATE INDEX idx_recert_items_campaign ON recertification_items(campaign_id);
CREATE INDEX idx_recert_items_reviewer ON recertification_items(reviewer_id);

-- ============================================================================
-- END OF PHASE 1 SCHEMA
-- Next (Phase 2): seed_data.sql with realistic employees/roles/permissions
-- and intentionally planted SoD violations, unused permissions, and
-- anomalous access_logs for the detection engine to catch.
-- ============================================================================
