-- ============================================================================
-- EAPIS — PHASE 3: CORE RBAC LOGIC
-- Requires schema.sql (Phase 1) and, ideally, seed_data.sql (Phase 2) applied.
--
-- Contents:
--   1. fn_get_current_actor()        — session-variable actor capture for audit
--   2. fn_effective_roles()          — recursive CTE: direct + inherited roles
--   3. fn_effective_permissions()    — recursive CTE: full resolved permission
--                                       set, each tagged with the role (and
--                                       whether that role is directly held)
--                                       that grants it — the exact building
--                                       block Phase 4's SoD detector needs to
--                                       tell "direct" from "indirect" conflicts
--   4. v_employee_effective_roles / v_employee_effective_permissions
--                                     — org-wide reporting views built on 2/3
--   5. fn_prevent_role_hierarchy_cycle() + trigger — blocks any INSERT/UPDATE
--                                       on role_hierarchy that would turn the
--                                       DAG into a cycle
--   6. Audit-log triggers on roles, permissions, role_permissions,
--      role_hierarchy, and employee_roles — every change is captured
--      automatically, the application never writes to audit_logs itself
-- ============================================================================


-- ============================================================================
-- 1. ACTOR CAPTURE FOR AUDIT TRIGGERS
-- ----------------------------------------------------------------------------
-- The backend API sets this once per transaction/request with:
--   SET LOCAL eapis.actor_id = '<employee_id of whoever is logged in>';
-- before running any change. If it's never set (e.g. a raw seed script, or a
-- scheduled job with no human actor), audit rows simply record a NULL actor.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_get_current_actor() RETURNS INTEGER AS $$
    SELECT NULLIF(current_setting('eapis.actor_id', true), '')::INTEGER;
$$ LANGUAGE sql STABLE;


-- ============================================================================
-- 2. EFFECTIVE ROLES — recursive CTE walk up the role_hierarchy DAG
-- ----------------------------------------------------------------------------
-- "Direct" here means the employee actually holds an active, non-expired
-- employee_roles grant for that role. Everything reached by climbing
-- role_hierarchy from there is "inherited". A role can be both (e.g. held
-- directly AND reachable as a parent of something else the employee holds) —
-- is_direct is TRUE in that case, since the strongest source wins.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_effective_roles(p_employee_id INTEGER)
RETURNS TABLE (role_id INTEGER, role_name VARCHAR, is_direct BOOLEAN) AS $$
    WITH RECURSIVE base AS (
        SELECT er.role_id
        FROM employee_roles er
        WHERE er.employee_id = p_employee_id
          AND er.status = 'active'
          AND (er.expires_at IS NULL OR er.expires_at > now())
    ),
    closure AS (
        SELECT role_id FROM base
        UNION
        SELECT rh.parent_role_id
        FROM closure c
        JOIN role_hierarchy rh ON rh.child_role_id = c.role_id
    )
    SELECT r.role_id, r.role_name, (r.role_id IN (SELECT role_id FROM base)) AS is_direct
    FROM closure c
    JOIN roles r ON r.role_id = c.role_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_effective_roles IS
    'Recursively resolves every role an employee effectively holds (direct grants + everything reachable by climbing the role_hierarchy DAG from those grants). Expired/revoked grants are excluded.';


-- ============================================================================
-- 3. EFFECTIVE PERMISSIONS — built directly on fn_effective_roles
-- ----------------------------------------------------------------------------
-- One row per (permission, granting role). A permission reachable through
-- more than one role appears more than once here on purpose — Phase 4's SoD
-- detector needs to see EVERY (permission, via_role) path to correctly tell
-- a direct conflict (one role_id supplies both sides) from an indirect one
-- (two different role_ids, only combined through inheritance, each supply
-- one side).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_effective_permissions(p_employee_id INTEGER)
RETURNS TABLE (
    permission_id   INTEGER,
    action          VARCHAR,
    resource_type   VARCHAR,
    risk_level      VARCHAR,
    via_role_id     INTEGER,
    via_role_name   VARCHAR,
    via_role_direct BOOLEAN
) AS $$
    SELECT p.permission_id, p.action, p.resource_type, p.risk_level,
           er.role_id, er.role_name, er.is_direct
    FROM fn_effective_roles(p_employee_id) er
    JOIN role_permissions rp ON rp.role_id = er.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_effective_permissions IS
    'Full resolved permission set for an employee, each row tagged with the specific role that grants it. Feeds Phase 4 SoD/privilege-escalation detection directly.';


-- ============================================================================
-- 4. ORG-WIDE REPORTING VIEWS (LATERAL join over every employee)
-- ============================================================================
CREATE OR REPLACE VIEW v_employee_effective_roles AS
SELECT e.employee_id, e.full_name, e.department, er.role_id, er.role_name, er.is_direct
FROM employees e
CROSS JOIN LATERAL fn_effective_roles(e.employee_id) er;

CREATE OR REPLACE VIEW v_employee_effective_permissions AS
SELECT e.employee_id, e.full_name, e.department, ep.*
FROM employees e
CROSS JOIN LATERAL fn_effective_permissions(e.employee_id) ep;


-- ============================================================================
-- 5. CYCLE PREVENTION ON role_hierarchy
-- ----------------------------------------------------------------------------
-- A single CHECK constraint (child <> parent) only stops the trivial
-- self-loop case; a real DAG-cycle check needs a graph walk, which requires
-- a trigger. Before allowing (NEW.child_role_id -> NEW.parent_role_id), we
-- climb every existing ancestor of NEW.parent_role_id; if NEW.child_role_id
-- shows up in that ancestor set, the new edge would close a loop, so we
-- reject it.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_prevent_role_hierarchy_cycle() RETURNS TRIGGER AS $$
DECLARE
    v_would_cycle BOOLEAN;
BEGIN
    WITH RECURSIVE ancestors AS (
        SELECT parent_role_id AS role_id
        FROM role_hierarchy
        WHERE child_role_id = NEW.parent_role_id
        UNION
        SELECT rh.parent_role_id
        FROM ancestors a
        JOIN role_hierarchy rh ON rh.child_role_id = a.role_id
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE role_id = NEW.child_role_id)
    INTO v_would_cycle;

    IF v_would_cycle THEN
        RAISE EXCEPTION
            'role_hierarchy cycle rejected: role % is already an ancestor of role %, so adding edge (child=%, parent=%) would create a cycle in the DAG',
            NEW.child_role_id, NEW.parent_role_id, NEW.child_role_id, NEW.parent_role_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_role_hierarchy_cycle ON role_hierarchy;
CREATE TRIGGER trg_prevent_role_hierarchy_cycle
    BEFORE INSERT OR UPDATE ON role_hierarchy
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_role_hierarchy_cycle();


-- ============================================================================
-- 6. AUDIT-LOG TRIGGERS
-- ----------------------------------------------------------------------------
-- One trigger function per table (rather than one generic function) because
-- each table's primary key shape is different (single-column surrogate key
-- vs. composite junction key), and forcing all of them through identical
-- generic code would make target_id meaningless for the junction tables.
-- ============================================================================

-- ---- roles ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_roles() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'role', NEW.role_id, 'insert', NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'role', NEW.role_id, 'update', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'role', OLD.role_id, 'delete', to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_roles ON roles;
CREATE TRIGGER trg_audit_roles
    AFTER INSERT OR UPDATE OR DELETE ON roles
    FOR EACH ROW EXECUTE FUNCTION fn_audit_roles();

-- ---- permissions --------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_permissions() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'permission', NEW.permission_id, 'insert', NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'permission', NEW.permission_id, 'update', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'permission', OLD.permission_id, 'delete', to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_permissions ON permissions;
CREATE TRIGGER trg_audit_permissions
    AFTER INSERT OR UPDATE OR DELETE ON permissions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_permissions();

-- ---- role_permissions (composite key -> target_id is the role_id side) -----
CREATE OR REPLACE FUNCTION fn_audit_role_permissions() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'role_permission', NEW.role_id, 'insert', NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'role_permission', OLD.role_id, 'delete', to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_role_permissions ON role_permissions;
CREATE TRIGGER trg_audit_role_permissions
    AFTER INSERT OR DELETE ON role_permissions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_role_permissions();

-- ---- role_hierarchy (composite key -> target_id is the child_role_id side) --
CREATE OR REPLACE FUNCTION fn_audit_role_hierarchy() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'role_hierarchy', NEW.child_role_id, 'insert', NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'role_hierarchy', OLD.child_role_id, 'delete', to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_role_hierarchy ON role_hierarchy;
CREATE TRIGGER trg_audit_role_hierarchy
    AFTER INSERT OR DELETE ON role_hierarchy
    FOR EACH ROW EXECUTE FUNCTION fn_audit_role_hierarchy();

-- ---- employee_roles (surrogate grant_id key; covers grant/revoke/expiry) ---
CREATE OR REPLACE FUNCTION fn_audit_employee_roles() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'employee_role', NEW.grant_id, 'insert', NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'employee_role', NEW.grant_id, 'update', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'employee_role', OLD.grant_id, 'delete', to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_employee_roles ON employee_roles;
CREATE TRIGGER trg_audit_employee_roles
    AFTER INSERT OR UPDATE OR DELETE ON employee_roles
    FOR EACH ROW EXECUTE FUNCTION fn_audit_employee_roles();

-- ============================================================================
-- END OF PHASE 3
-- Next (Phase 4): the detection engine itself — SoD (direct + indirect via
-- fn_effective_permissions), unused-access, anomalous-access, and privilege-
-- escalation detectors, all writing into findings, plus per-employee risk
-- scoring.
-- ============================================================================
