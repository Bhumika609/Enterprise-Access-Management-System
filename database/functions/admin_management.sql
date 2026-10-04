-- ============================================================================
-- EAPIS — PHASE 6b: ADMIN MANAGEMENT + DELEGATED ACCESS  (database side)
-- Run AFTER api_views.sql. Safe to run more than once.
--
-- Adds:
--   1. Admin functions to manage roles, permissions, role<->permission links,
--      the role hierarchy (DAG) and the configurable SoD rules. Every change is
--      captured in audit_logs with the acting admin (new audit trigger added for
--      sod_conflict_rules; the rest were already audited in Phase 3).
--   2. Delegated access: an employee can lend one of their own roles to a
--      colleague for a limited time. Delegation is PREVENTIVELY checked: if it
--      would give the colleague a segregation-of-duties conflict they did not
--      already have, it is refused.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. HELPERS
-- ----------------------------------------------------------------------------

-- Records who is making the change for the audit triggers (transaction-local)
CREATE OR REPLACE FUNCTION fn_set_actor(p_actor_id INTEGER) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('eapis.actor_id', COALESCE(p_actor_id::TEXT, ''), true);
END;
$$ LANGUAGE plpgsql;

-- Which active SoD rules does this employee currently trip (direct or inherited)?
CREATE OR REPLACE FUNCTION fn_employee_sod_rule_hits(p_employee_id INTEGER)
RETURNS TABLE (rule_id INTEGER, permission_a TEXT, permission_b TEXT, severity VARCHAR) AS $$
    SELECT r.rule_id,
           pa.action || ' ' || pa.resource_type,
           pb.action || ' ' || pb.resource_type,
           r.severity
    FROM sod_conflict_rules r
    JOIN permissions pa ON pa.permission_id = r.permission_a_id
    JOIN permissions pb ON pb.permission_id = r.permission_b_id
    WHERE r.is_active
      AND EXISTS (SELECT 1 FROM fn_effective_permissions(p_employee_id) e WHERE e.permission_id = r.permission_a_id)
      AND EXISTS (SELECT 1 FROM fn_effective_permissions(p_employee_id) e WHERE e.permission_id = r.permission_b_id);
$$ LANGUAGE sql STABLE;


-- ----------------------------------------------------------------------------
-- 1. ROLES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_create_role(p_name VARCHAR, p_description TEXT, p_actor_id INTEGER)
RETURNS INTEGER AS $$
DECLARE v_id INTEGER;
BEGIN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'Role name is required';
    END IF;
    IF EXISTS (SELECT 1 FROM roles WHERE lower(role_name) = lower(btrim(p_name))) THEN
        RAISE EXCEPTION 'A role named "%" already exists', btrim(p_name);
    END IF;
    PERFORM fn_set_actor(p_actor_id);
    INSERT INTO roles (role_name, description) VALUES (btrim(p_name), p_description)
    RETURNING role_id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_update_role(p_role_id INTEGER, p_name VARCHAR, p_description TEXT, p_actor_id INTEGER)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id = p_role_id) THEN
        RAISE EXCEPTION 'Role % does not exist', p_role_id;
    END IF;
    IF p_name IS NOT NULL THEN
        IF btrim(p_name) = '' THEN RAISE EXCEPTION 'Role name cannot be empty'; END IF;
        IF EXISTS (SELECT 1 FROM roles WHERE lower(role_name) = lower(btrim(p_name)) AND role_id <> p_role_id) THEN
            RAISE EXCEPTION 'A role named "%" already exists', btrim(p_name);
        END IF;
    END IF;
    PERFORM fn_set_actor(p_actor_id);
    UPDATE roles
       SET role_name   = COALESCE(btrim(p_name), role_name),
           description = COALESCE(p_description, description)
     WHERE role_id = p_role_id;
END;
$$ LANGUAGE plpgsql;

-- A role that has ever been granted, or requested, cannot be deleted: that would
-- erase access history. Revoke the access instead.
CREATE OR REPLACE FUNCTION fn_delete_role(p_role_id INTEGER, p_actor_id INTEGER) RETURNS VOID AS $$
DECLARE
    v_name   VARCHAR;
    v_grants INTEGER;
    v_reqs   INTEGER;
BEGIN
    SELECT role_name INTO v_name FROM roles WHERE role_id = p_role_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Role % does not exist', p_role_id; END IF;

    SELECT COUNT(*) INTO v_grants FROM employee_roles WHERE role_id = p_role_id;
    SELECT COUNT(*) INTO v_reqs   FROM access_requests WHERE role_id = p_role_id;
    IF v_grants > 0 OR v_reqs > 0 THEN
        RAISE EXCEPTION 'Role "%" has % grant record(s) and % access request(s) and cannot be deleted. Revoke its access instead so the history is kept.',
            v_name, v_grants, v_reqs;
    END IF;

    PERFORM fn_set_actor(p_actor_id);
    DELETE FROM roles WHERE role_id = p_role_id;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 2. PERMISSIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_create_permission(
    p_action VARCHAR, p_resource_type VARCHAR, p_risk_level VARCHAR,
    p_expected_frequency VARCHAR, p_description TEXT, p_actor_id INTEGER
) RETURNS INTEGER AS $$
DECLARE v_id INTEGER;
BEGIN
    IF p_action IS NULL OR btrim(p_action) = '' OR p_resource_type IS NULL OR btrim(p_resource_type) = '' THEN
        RAISE EXCEPTION 'Permission action and resource_type are required';
    END IF;
    IF p_risk_level NOT IN ('low', 'medium', 'high', 'critical') THEN
        RAISE EXCEPTION 'risk_level must be low, medium, high or critical';
    END IF;
    IF COALESCE(p_expected_frequency, 'regular') NOT IN ('regular', 'occasional', 'rare') THEN
        RAISE EXCEPTION 'expected_frequency must be regular, occasional or rare';
    END IF;
    IF EXISTS (SELECT 1 FROM permissions
                WHERE lower(action) = lower(btrim(p_action)) AND lower(resource_type) = lower(btrim(p_resource_type))) THEN
        RAISE EXCEPTION 'Permission "% %" already exists', btrim(p_action), btrim(p_resource_type);
    END IF;
    PERFORM fn_set_actor(p_actor_id);
    INSERT INTO permissions (action, resource_type, risk_level, expected_frequency, description)
    VALUES (lower(btrim(p_action)), lower(btrim(p_resource_type)), p_risk_level,
            COALESCE(p_expected_frequency, 'regular'), p_description)
    RETURNING permission_id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- action / resource_type are the permission's identity (the detectors match access
-- logs on them), so only the risk metadata and description can be edited.
CREATE OR REPLACE FUNCTION fn_update_permission(
    p_permission_id INTEGER, p_risk_level VARCHAR, p_expected_frequency VARCHAR,
    p_description TEXT, p_actor_id INTEGER
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM permissions WHERE permission_id = p_permission_id) THEN
        RAISE EXCEPTION 'Permission % does not exist', p_permission_id;
    END IF;
    IF p_risk_level IS NOT NULL AND p_risk_level NOT IN ('low', 'medium', 'high', 'critical') THEN
        RAISE EXCEPTION 'risk_level must be low, medium, high or critical';
    END IF;
    IF p_expected_frequency IS NOT NULL AND p_expected_frequency NOT IN ('regular', 'occasional', 'rare') THEN
        RAISE EXCEPTION 'expected_frequency must be regular, occasional or rare';
    END IF;
    PERFORM fn_set_actor(p_actor_id);
    UPDATE permissions
       SET risk_level         = COALESCE(p_risk_level, risk_level),
           expected_frequency = COALESCE(p_expected_frequency, expected_frequency),
           description        = COALESCE(p_description, description)
     WHERE permission_id = p_permission_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_delete_permission(p_permission_id INTEGER, p_actor_id INTEGER) RETURNS VOID AS $$
DECLARE
    v_label TEXT;
    v_roles INTEGER;
    v_rules INTEGER;
BEGIN
    SELECT action || ' ' || resource_type INTO v_label FROM permissions WHERE permission_id = p_permission_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Permission % does not exist', p_permission_id; END IF;

    SELECT COUNT(*) INTO v_roles FROM role_permissions WHERE permission_id = p_permission_id;
    SELECT COUNT(*) INTO v_rules FROM sod_conflict_rules
     WHERE permission_a_id = p_permission_id OR permission_b_id = p_permission_id;
    IF v_roles > 0 OR v_rules > 0 THEN
        RAISE EXCEPTION 'Permission "%" is still used by % role(s) and % SoD rule(s). Remove those links first.',
            v_label, v_roles, v_rules;
    END IF;

    PERFORM fn_set_actor(p_actor_id);
    DELETE FROM permissions WHERE permission_id = p_permission_id;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 3. ROLE <-> PERMISSION LINKS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_grant_permission_to_role(p_role_id INTEGER, p_permission_id INTEGER, p_actor_id INTEGER)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id = p_role_id) THEN
        RAISE EXCEPTION 'Role % does not exist', p_role_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM permissions WHERE permission_id = p_permission_id) THEN
        RAISE EXCEPTION 'Permission % does not exist', p_permission_id;
    END IF;
    IF EXISTS (SELECT 1 FROM role_permissions WHERE role_id = p_role_id AND permission_id = p_permission_id) THEN
        RAISE EXCEPTION 'That role already includes this permission';
    END IF;
    PERFORM fn_set_actor(p_actor_id);
    INSERT INTO role_permissions (role_id, permission_id) VALUES (p_role_id, p_permission_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_revoke_permission_from_role(p_role_id INTEGER, p_permission_id INTEGER, p_actor_id INTEGER)
RETURNS VOID AS $$
BEGIN
    PERFORM fn_set_actor(p_actor_id);
    DELETE FROM role_permissions WHERE role_id = p_role_id AND permission_id = p_permission_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That role does not directly include this permission';
    END IF;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 4. ROLE HIERARCHY (DAG). The Phase 3 cycle-prevention trigger still applies:
--    an edge that would create a loop is rejected by the database.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_add_role_parent(p_child_role_id INTEGER, p_parent_role_id INTEGER, p_actor_id INTEGER)
RETURNS VOID AS $$
BEGIN
    IF p_child_role_id = p_parent_role_id THEN
        RAISE EXCEPTION 'A role cannot inherit from itself';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id = p_child_role_id) THEN
        RAISE EXCEPTION 'Role % does not exist', p_child_role_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE role_id = p_parent_role_id) THEN
        RAISE EXCEPTION 'Role % does not exist', p_parent_role_id;
    END IF;
    IF EXISTS (SELECT 1 FROM role_hierarchy WHERE child_role_id = p_child_role_id AND parent_role_id = p_parent_role_id) THEN
        RAISE EXCEPTION 'That inheritance link already exists';
    END IF;
    PERFORM fn_set_actor(p_actor_id);
    INSERT INTO role_hierarchy (child_role_id, parent_role_id) VALUES (p_child_role_id, p_parent_role_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_remove_role_parent(p_child_role_id INTEGER, p_parent_role_id INTEGER, p_actor_id INTEGER)
RETURNS VOID AS $$
BEGIN
    PERFORM fn_set_actor(p_actor_id);
    DELETE FROM role_hierarchy WHERE child_role_id = p_child_role_id AND parent_role_id = p_parent_role_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That inheritance link does not exist';
    END IF;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 5. SoD RULES (the configurable rule set) + audit trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_sod_rules() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'sod_rule', NEW.rule_id, 'insert', NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'sod_rule', NEW.rule_id, 'update', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'sod_rule', OLD.rule_id, 'delete', to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_sod_rules ON sod_conflict_rules;
CREATE TRIGGER trg_audit_sod_rules
    AFTER INSERT OR UPDATE OR DELETE ON sod_conflict_rules
    FOR EACH ROW EXECUTE FUNCTION fn_audit_sod_rules();

CREATE OR REPLACE FUNCTION fn_create_sod_rule(
    p_permission_a_id INTEGER, p_permission_b_id INTEGER, p_severity VARCHAR,
    p_description TEXT, p_actor_id INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_a  INTEGER;
    v_b  INTEGER;
    v_id INTEGER;
BEGIN
    IF p_permission_a_id IS NULL OR p_permission_b_id IS NULL THEN
        RAISE EXCEPTION 'A rule needs two permissions';
    END IF;
    IF p_permission_a_id = p_permission_b_id THEN
        RAISE EXCEPTION 'A rule needs two different permissions';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM permissions WHERE permission_id = p_permission_a_id)
       OR NOT EXISTS (SELECT 1 FROM permissions WHERE permission_id = p_permission_b_id) THEN
        RAISE EXCEPTION 'Both permissions must exist';
    END IF;
    IF p_severity NOT IN ('low', 'medium', 'high', 'critical') THEN
        RAISE EXCEPTION 'severity must be low, medium, high or critical';
    END IF;

    -- the schema stores each pair in canonical order (a < b)
    v_a := LEAST(p_permission_a_id, p_permission_b_id);
    v_b := GREATEST(p_permission_a_id, p_permission_b_id);
    IF EXISTS (SELECT 1 FROM sod_conflict_rules WHERE permission_a_id = v_a AND permission_b_id = v_b) THEN
        RAISE EXCEPTION 'A rule for this pair of permissions already exists';
    END IF;

    PERFORM fn_set_actor(p_actor_id);
    INSERT INTO sod_conflict_rules (permission_a_id, permission_b_id, severity, description)
    VALUES (v_a, v_b, p_severity, p_description)
    RETURNING rule_id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_update_sod_rule(
    p_rule_id INTEGER, p_severity VARCHAR, p_description TEXT, p_is_active BOOLEAN, p_actor_id INTEGER
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sod_conflict_rules WHERE rule_id = p_rule_id) THEN
        RAISE EXCEPTION 'SoD rule % does not exist', p_rule_id;
    END IF;
    IF p_severity IS NOT NULL AND p_severity NOT IN ('low', 'medium', 'high', 'critical') THEN
        RAISE EXCEPTION 'severity must be low, medium, high or critical';
    END IF;
    PERFORM fn_set_actor(p_actor_id);
    UPDATE sod_conflict_rules
       SET severity    = COALESCE(p_severity, severity),
           description = COALESCE(p_description, description),
           is_active   = COALESCE(p_is_active, is_active)
     WHERE rule_id = p_rule_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_delete_sod_rule(p_rule_id INTEGER, p_actor_id INTEGER) RETURNS VOID AS $$
BEGIN
    PERFORM fn_set_actor(p_actor_id);
    DELETE FROM sod_conflict_rules WHERE rule_id = p_rule_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SoD rule % does not exist', p_rule_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Rules with ids and readable names (for the rule-management screen)
CREATE OR REPLACE VIEW v_sod_rules_detail AS
SELECT r.rule_id,
       r.permission_a_id,
       pa.action || ' ' || pa.resource_type AS permission_a,
       r.permission_b_id,
       pb.action || ' ' || pb.resource_type AS permission_b,
       r.severity,
       r.description,
       r.is_active
FROM sod_conflict_rules r
JOIN permissions pa ON pa.permission_id = r.permission_a_id
JOIN permissions pb ON pb.permission_id = r.permission_b_id;


-- ----------------------------------------------------------------------------
-- 6. DELEGATED ACCESS
-- Rules enforced here (not in the app):
--   * the delegator must directly hold an active, unexpired grant of the role
--     (delegated / break-glass access can never be passed on again)
--   * a justification and an expiry are mandatory; at most 30 days, and never
--     beyond the delegator's own grant expiry
--   * the delegate must be an active employee not already holding the role
--   * preventive SoD check: refused if it would give the delegate a
--     segregation-of-duties conflict they did not already have
-- ----------------------------------------------------------------------------
-- (TIMESTAMPTZ so that calls like  now() + interval '3 days'  work from a SQL window.
--  The DROP removes any earlier TIMESTAMP-typed version so two overloads never coexist.)
DROP FUNCTION IF EXISTS fn_delegate_role(INTEGER, INTEGER, INTEGER, TIMESTAMP, TEXT);
CREATE OR REPLACE FUNCTION fn_delegate_role(
    p_delegator_id  INTEGER,
    p_delegate_id   INTEGER,
    p_role_id       INTEGER,
    p_expires_at    TIMESTAMPTZ,
    p_justification TEXT
) RETURNS INTEGER AS $$
DECLARE
    v_src      employee_roles%ROWTYPE;
    v_role     VARCHAR;
    v_before   INTEGER[];
    v_hit      RECORD;
    v_grant_id INTEGER;
BEGIN
    IF p_delegator_id IS NULL OR p_delegate_id IS NULL OR p_role_id IS NULL THEN
        RAISE EXCEPTION 'delegator, delegate and role are all required';
    END IF;
    IF p_delegator_id = p_delegate_id THEN
        RAISE EXCEPTION 'You cannot delegate a role to yourself';
    END IF;
    IF p_justification IS NULL OR btrim(p_justification) = '' THEN
        RAISE EXCEPTION 'A justification is required for delegated access';
    END IF;
    IF p_expires_at IS NULL THEN
        RAISE EXCEPTION 'Delegated access must have an expiry date';
    END IF;
    IF p_expires_at <= now() THEN
        RAISE EXCEPTION 'The expiry must be in the future';
    END IF;
    IF p_expires_at > now() + interval '30 days' THEN
        RAISE EXCEPTION 'Delegated access cannot last longer than 30 days';
    END IF;

    SELECT role_name INTO v_role FROM roles WHERE role_id = p_role_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Role % does not exist', p_role_id; END IF;

    IF NOT EXISTS (SELECT 1 FROM employees WHERE employee_id = p_delegate_id AND status = 'active') THEN
        RAISE EXCEPTION 'The person receiving the delegation must be an active employee';
    END IF;

    SELECT * INTO v_src
      FROM employee_roles
     WHERE employee_id = p_delegator_id AND role_id = p_role_id
       AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
       AND grant_type IN ('direct', 'temporary')
     ORDER BY granted_at
     LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The delegator does not directly hold an active "%" role, so it cannot be delegated', v_role;
    END IF;
    IF v_src.expires_at IS NOT NULL AND p_expires_at > v_src.expires_at THEN
        RAISE EXCEPTION 'A delegation cannot outlive the delegator''s own access (which expires %)', v_src.expires_at;
    END IF;

    IF EXISTS (SELECT 1 FROM employee_roles
                WHERE employee_id = p_delegate_id AND role_id = p_role_id
                  AND status = 'active' AND (expires_at IS NULL OR expires_at > now())) THEN
        RAISE EXCEPTION 'The delegate already holds the "%" role', v_role;
    END IF;

    -- conflicts the delegate already has today (these do not block the delegation)
    v_before := ARRAY(SELECT rule_id FROM fn_employee_sod_rule_hits(p_delegate_id));

    PERFORM fn_set_actor(p_delegator_id);
    INSERT INTO employee_roles
        (employee_id, role_id, grant_type, granted_by, delegated_from, granted_at, expires_at,
         is_temporary, justification, status)
    VALUES
        (p_delegate_id, p_role_id, 'delegated', p_delegator_id, p_delegator_id, now(), p_expires_at,
         TRUE, btrim(p_justification), 'active')
    RETURNING grant_id INTO v_grant_id;

    -- any NEW conflict aborts the whole function, undoing the insert above
    SELECT * INTO v_hit FROM fn_employee_sod_rule_hits(p_delegate_id) h
     WHERE h.rule_id <> ALL (v_before) LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Delegation refused: it would give the delegate a segregation-of-duties conflict (% + %)',
            v_hit.permission_a, v_hit.permission_b;
    END IF;

    RETURN v_grant_id;
END;
$$ LANGUAGE plpgsql;

-- The delegator (or the delegate handing it back) may end a delegation early.
-- p_allow_any = TRUE lets an administrator end anybody's delegation.
CREATE OR REPLACE FUNCTION fn_revoke_delegation(p_grant_id INTEGER, p_actor_id INTEGER, p_allow_any BOOLEAN)
RETURNS VOID AS $$
DECLARE
    v_g employee_roles%ROWTYPE;
BEGIN
    SELECT * INTO v_g FROM employee_roles WHERE grant_id = p_grant_id FOR UPDATE;
    IF NOT FOUND OR v_g.grant_type <> 'delegated' THEN
        RAISE EXCEPTION 'Delegation % does not exist', p_grant_id;
    END IF;
    IF v_g.status <> 'active' THEN
        RAISE EXCEPTION 'This delegation is already %', v_g.status;
    END IF;
    IF NOT COALESCE(p_allow_any, FALSE) AND p_actor_id IS DISTINCT FROM v_g.delegated_from
       AND p_actor_id IS DISTINCT FROM v_g.employee_id THEN
        RAISE EXCEPTION 'Only the person who delegated the role (or the delegate) can end this delegation';
    END IF;

    PERFORM fn_set_actor(p_actor_id);
    UPDATE employee_roles
       SET status = 'revoked', revoked_by = p_actor_id, revoked_at = now()
     WHERE grant_id = p_grant_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW v_delegations AS
SELECT er.grant_id,
       er.role_id,
       r.role_name,
       er.delegated_from   AS delegator_id,
       dg.full_name        AS delegator_name,
       er.employee_id      AS delegate_id,
       de.full_name        AS delegate_name,
       er.granted_at,
       er.expires_at,
       er.status,
       er.justification,
       er.revoked_at
FROM employee_roles er
JOIN roles r          ON r.role_id = er.role_id
JOIN employees de     ON de.employee_id = er.employee_id
LEFT JOIN employees dg ON dg.employee_id = er.delegated_from
WHERE er.grant_type = 'delegated';

-- ============================================================================
-- END OF admin_management.sql
-- ============================================================================