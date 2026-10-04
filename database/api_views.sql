-- ============================================================================
-- EAPIS — PHASE 6a (database side): API-FACING VIEWS AND FUNCTIONS
-- Requires schema.sql, seed_data.sql, core_rbac_functions.sql,
-- detection_engine.sql and lifecycle_jobs.sql applied first.
--
-- Principle from the project spec: "the database is the brain". Everything
-- the dashboard shows is computed here. The Node.js API layer only calls
-- these views/functions and returns the result as JSON.
--
-- Contents:
--   1. fn_dashboard_summary()           — every number/chart on the Dashboard
--   2. v_employee_directory             — Employees table
--   3. v_findings_detail                — Findings table (unified)
--   4. v_sod_violations                 — SoD Violations page
--   5. v_unused_access                  — Unused Access page
--   6. v_access_logs_detail / v_audit_logs_detail — Logs pages
--   7. v_access_requests_detail + fn_create_access_request()
--      + fn_review_access_request() + audit trigger — approval workflow
--   8. fn_update_finding_status()       — review & resolve workflow
--   9. fn_employee_profile()            — Employee drill-down page
--  10. v_recertification_items / v_recertification_campaigns
-- ============================================================================


-- ============================================================================
-- 3. FINDINGS DETAIL (created first because other objects depend on it)
-- ============================================================================
CREATE OR REPLACE VIEW v_findings_detail AS
SELECT f.finding_id,
       f.employee_id,
       e.full_name,
       e.department,
       f.finding_type,
       f.severity,
       CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END AS severity_rank,
       f.status,
       f.detected_at,
       f.related_entity,
       f.resolved_by,
       rb.full_name AS resolved_by_name,
       f.resolved_at,
       f.resolution_notes,
       CASE f.finding_type
           WHEN 'sod_violation' THEN
               'SoD violation: ' || COALESCE(f.related_entity->>'description', 'conflicting permissions held')
           WHEN 'privilege_escalation' THEN
               'Privilege escalation via role combination: ' || COALESCE(f.related_entity->>'description', 'conflicting permissions held')
           WHEN 'unused_access' THEN
               'Unused permission: ' || COALESCE(f.related_entity->>'action', '?') || ' ' || COALESCE(f.related_entity->>'resource_type', '?')
               || ' (via role ' || COALESCE(f.related_entity->>'role_name', '?') || ')'
           ELSE
               'Anomalous access: ' || replace(COALESCE(f.related_entity->>'pattern', 'unknown'), '_', ' ')
       END AS title
FROM findings f
JOIN employees e ON e.employee_id = f.employee_id
LEFT JOIN employees rb ON rb.employee_id = f.resolved_by;


-- ============================================================================
-- 1. DASHBOARD SUMMARY — one JSON document with everything the landing page needs
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_dashboard_summary() RETURNS JSONB AS $$
    SELECT jsonb_build_object(
        'total_employees',        (SELECT COUNT(*) FROM employees WHERE status = 'active'),
        'total_roles',            (SELECT COUNT(*) FROM roles),
        'total_permissions',      (SELECT COUNT(*) FROM permissions),
        'active_temporary_access',(SELECT COUNT(*) FROM employee_roles
                                    WHERE status = 'active' AND is_temporary
                                      AND (expires_at IS NULL OR expires_at > now())),
        'critical_findings',      (SELECT COUNT(*) FROM findings
                                    WHERE severity = 'critical' AND status IN ('open', 'under_review')),
        'sod_violations',         (SELECT COUNT(*) FROM findings
                                    WHERE finding_type IN ('sod_violation', 'privilege_escalation')
                                      AND status IN ('open', 'under_review')),
        'unused_permissions',     (SELECT COUNT(*) FROM findings
                                    WHERE finding_type = 'unused_access' AND status IN ('open', 'under_review')),
        'open_findings',          (SELECT COUNT(*) FROM findings WHERE status IN ('open', 'under_review')),
        'pending_access_requests',(SELECT COUNT(*) FROM access_requests WHERE status = 'pending'),
        'risk_distribution', (
            SELECT jsonb_object_agg(s.sev, COALESCE(c.cnt, 0))
            FROM (VALUES ('critical'), ('high'), ('medium'), ('low')) AS s(sev)
            LEFT JOIN (SELECT severity, COUNT(*) AS cnt FROM findings
                       WHERE status IN ('open', 'under_review') GROUP BY severity) c
                   ON c.severity = s.sev
        ),
        'findings_by_type', (
            SELECT jsonb_object_agg(t.ftype, COALESCE(c.cnt, 0))
            FROM (VALUES ('sod_violation'), ('privilege_escalation'), ('unused_access'), ('anomalous_access')) AS t(ftype)
            LEFT JOIN (SELECT finding_type, COUNT(*) AS cnt FROM findings
                       WHERE status IN ('open', 'under_review') GROUP BY finding_type) c
                   ON c.finding_type = t.ftype
        ),
        'activity_trend', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'day', to_char(d.day, 'YYYY-MM-DD'), 'total', d.total, 'failed', d.failed) ORDER BY d.day),
                   '[]'::jsonb)
            FROM (SELECT date_trunc('day', occurred_at) AS day,
                         COUNT(*) AS total,
                         COUNT(*) FILTER (WHERE NOT success) AS failed
                  FROM access_logs
                  WHERE occurred_at >= now() - interval '30 days'
                  GROUP BY 1) d
        ),
        'top_risky_employees', (
            SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.risk_score DESC), '[]'::jsonb)
            FROM (SELECT employee_id, full_name, department, risk_score, open_finding_count
                  FROM v_employee_risk_scores
                  WHERE risk_score > 0
                  ORDER BY risk_score DESC
                  LIMIT 5) t
        )
    );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_dashboard_summary IS
    'Single JSON document powering the Dashboard: summary cards, risk distribution, activity trend, top risky employees.';


-- ============================================================================
-- 2. EMPLOYEE DIRECTORY (Employees page table)
-- ============================================================================
CREATE OR REPLACE VIEW v_employee_directory AS
SELECT e.employee_id,
       e.full_name,
       e.email,
       e.department,
       e.status,
       e.hire_date,
       e.manager_id,
       m.full_name AS manager_name,
       COALESCE(rs.risk_score, 0)         AS risk_score,
       COALESCE(rs.open_finding_count, 0) AS open_finding_count,
       (SELECT string_agg(DISTINCT r.role_name, ', ' ORDER BY r.role_name)
          FROM employee_roles er
          JOIN roles r ON r.role_id = er.role_id
         WHERE er.employee_id = e.employee_id
           AND er.status = 'active'
           AND (er.expires_at IS NULL OR er.expires_at > now())) AS active_roles
FROM employees e
LEFT JOIN employees m ON m.employee_id = e.manager_id
LEFT JOIN v_employee_risk_scores rs ON rs.employee_id = e.employee_id;


-- ============================================================================
-- 4. SoD VIOLATIONS PAGE
-- ============================================================================
CREATE OR REPLACE VIEW v_sod_violations AS
SELECT f.finding_id,
       f.employee_id,
       f.full_name,
       f.department,
       f.finding_type,
       f.severity,
       f.severity_rank,
       f.status,
       f.detected_at,
       (f.related_entity->>'rule_id')::INTEGER AS rule_id,
       pa.action || ' ' || pa.resource_type AS permission_a,
       pb.action || ' ' || pb.resource_type AS permission_b,
       f.related_entity->>'description'      AS rule_description,
       (SELECT string_agg(r.role_name, ', ' ORDER BY r.role_name)
          FROM roles r
         WHERE r.role_id IN (SELECT jsonb_array_elements_text(f.related_entity->'roles_granting_a')::INTEGER)) AS roles_granting_a,
       (SELECT string_agg(r.role_name, ', ' ORDER BY r.role_name)
          FROM roles r
         WHERE r.role_id IN (SELECT jsonb_array_elements_text(f.related_entity->'roles_granting_b')::INTEGER)) AS roles_granting_b,
       CASE f.finding_type WHEN 'sod_violation' THEN 'Direct (one role grants both)'
                           ELSE 'Indirect (combination of inherited roles)' END AS conflict_kind
FROM v_findings_detail f
LEFT JOIN permissions pa ON pa.permission_id = (f.related_entity->>'permission_a_id')::INTEGER
LEFT JOIN permissions pb ON pb.permission_id = (f.related_entity->>'permission_b_id')::INTEGER
WHERE f.finding_type IN ('sod_violation', 'privilege_escalation');


-- ============================================================================
-- 5. UNUSED ACCESS PAGE
-- ============================================================================
CREATE OR REPLACE VIEW v_unused_access AS
SELECT f.finding_id,
       f.employee_id,
       f.full_name,
       f.department,
       f.severity,
       f.severity_rank,
       f.status,
       f.detected_at,
       f.related_entity->>'role_name'                      AS role_name,
       f.related_entity->>'action'                         AS action,
       f.related_entity->>'resource_type'                  AS resource_type,
       (f.related_entity->>'window_days')::INTEGER         AS window_days
FROM v_findings_detail f
WHERE f.finding_type = 'unused_access';


-- ============================================================================
-- 6. LOG PAGES
-- ============================================================================
CREATE OR REPLACE VIEW v_access_logs_detail AS
SELECT al.log_id,
       al.employee_id,
       e.full_name,
       e.department,
       al.resource_id,
       res.resource_name,
       res.resource_type,
       al.action,
       al.occurred_at,
       al.success,
       al.ip_address::TEXT AS ip_address
FROM access_logs al
JOIN employees e   ON e.employee_id = al.employee_id
JOIN resources res ON res.resource_id = al.resource_id;

CREATE OR REPLACE VIEW v_audit_logs_detail AS
SELECT a.audit_id,
       a.actor_id,
       actor.full_name AS actor_name,
       a.target_type,
       a.target_id,
       a.change_type,
       a.old_value,
       a.new_value,
       a.occurred_at
FROM audit_logs a
LEFT JOIN employees actor ON actor.employee_id = a.actor_id;


-- ============================================================================
-- 7. ACCESS REQUEST WORKFLOW
-- ============================================================================
CREATE OR REPLACE VIEW v_access_requests_detail AS
SELECT ar.request_id,
       ar.requester_id,
       req.full_name   AS requester_name,
       req.department  AS requester_department,
       ar.role_id,
       r.role_name,
       ar.resource_id,
       res.resource_name,
       ar.is_temporary,
       ar.is_break_glass,
       ar.justification,
       ar.requested_at,
       ar.status,
       ar.reviewed_by,
       rev.full_name   AS reviewed_by_name,
       ar.reviewed_at,
       ar.expires_at
FROM access_requests ar
JOIN employees req        ON req.employee_id = ar.requester_id
LEFT JOIN roles r         ON r.role_id = ar.role_id
LEFT JOIN resources res   ON res.resource_id = ar.resource_id
LEFT JOIN employees rev   ON rev.employee_id = ar.reviewed_by;

-- Every request creation and review is logged in audit_logs (Section 9)
CREATE OR REPLACE FUNCTION fn_audit_access_requests() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'access_request', NEW.request_id, 'insert', NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (actor_id, target_type, target_id, change_type, old_value, new_value)
        VALUES (fn_get_current_actor(), 'access_request', NEW.request_id, 'update', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_access_requests ON access_requests;
CREATE TRIGGER trg_audit_access_requests
    AFTER INSERT OR UPDATE ON access_requests
    FOR EACH ROW EXECUTE FUNCTION fn_audit_access_requests();

CREATE OR REPLACE FUNCTION fn_create_access_request(
    p_requester_id   INTEGER,
    p_role_id        INTEGER,
    p_resource_id    INTEGER,
    p_is_temporary   BOOLEAN,
    p_is_break_glass BOOLEAN,
    p_justification  TEXT,
    p_expires_at     TIMESTAMP
) RETURNS INTEGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    IF p_role_id IS NULL AND p_resource_id IS NULL THEN
        RAISE EXCEPTION 'An access request must name a role or a resource';
    END IF;
    IF COALESCE(p_is_break_glass, FALSE) AND (p_justification IS NULL OR btrim(p_justification) = '') THEN
        RAISE EXCEPTION 'Break-glass requests require a justification';
    END IF;
    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
        RAISE EXCEPTION 'expires_at must be in the future';
    END IF;

    PERFORM set_config('eapis.actor_id', p_requester_id::TEXT, true);

    INSERT INTO access_requests
        (requester_id, role_id, resource_id, is_temporary, is_break_glass, justification, expires_at)
    VALUES
        (p_requester_id, p_role_id, p_resource_id,
         COALESCE(p_is_temporary, FALSE) OR COALESCE(p_is_break_glass, FALSE),
         COALESCE(p_is_break_glass, FALSE), p_justification, p_expires_at)
    RETURNING request_id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Approve or reject a request. On approval of a role request, the actual
-- employee_roles grant is created here (temporary/break-glass get an expiry;
-- a break-glass grant is auto-flagged by the Phase 5 trigger).
-- Returns the new grant_id, or NULL if nothing was granted.
CREATE OR REPLACE FUNCTION fn_review_access_request(
    p_request_id  INTEGER,
    p_decision    VARCHAR,     -- 'approved' or 'rejected'
    p_reviewer_id INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_req      access_requests%ROWTYPE;
    v_expires  TIMESTAMP;
    v_grant_id INTEGER;
BEGIN
    IF p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'decision must be approved or rejected, got %', p_decision;
    END IF;

    SELECT * INTO v_req FROM access_requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'access request % does not exist', p_request_id;
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'access request % has already been %', p_request_id, v_req.status;
    END IF;
    IF v_req.requester_id = p_reviewer_id THEN
        RAISE EXCEPTION 'A requester cannot review their own access request';
    END IF;

    PERFORM set_config('eapis.actor_id', p_reviewer_id::TEXT, true);

    v_expires := v_req.expires_at;
    IF p_decision = 'approved' AND v_req.is_temporary AND v_expires IS NULL THEN
        v_expires := now() + CASE WHEN v_req.is_break_glass THEN interval '24 hours' ELSE interval '7 days' END;
    END IF;

    UPDATE access_requests
       SET status = p_decision, reviewed_by = p_reviewer_id, reviewed_at = now(),
           expires_at = v_expires
     WHERE request_id = p_request_id;

    IF p_decision = 'approved' AND v_req.role_id IS NOT NULL THEN
        INSERT INTO employee_roles
            (employee_id, role_id, grant_type, granted_by, granted_at, expires_at, is_temporary, justification, status)
        VALUES
            (v_req.requester_id, v_req.role_id,
             CASE WHEN v_req.is_break_glass THEN 'break_glass'
                  WHEN v_req.is_temporary   THEN 'temporary'
                  ELSE 'direct' END,
             p_reviewer_id, now(), v_expires, v_req.is_temporary, v_req.justification, 'active')
        RETURNING grant_id INTO v_grant_id;
    END IF;

    RETURN v_grant_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 8. FINDING REVIEW & RESOLVE WORKFLOW
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_update_finding_status(
    p_finding_id INTEGER,
    p_status     VARCHAR,
    p_actor_id   INTEGER,
    p_notes      TEXT
) RETURNS VOID AS $$
BEGIN
    IF p_status NOT IN ('open', 'under_review', 'resolved', 'false_positive') THEN
        RAISE EXCEPTION 'invalid finding status %', p_status;
    END IF;

    UPDATE findings
       SET status = p_status,
           resolved_by = CASE WHEN p_status IN ('resolved', 'false_positive') THEN p_actor_id ELSE NULL END,
           resolved_at = CASE WHEN p_status IN ('resolved', 'false_positive') THEN now() ELSE NULL END,
           resolution_notes = COALESCE(p_notes, resolution_notes)
     WHERE finding_id = p_finding_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'finding % does not exist', p_finding_id;
    END IF;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 9. EMPLOYEE PROFILE (drill-down page) — one JSON document
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_employee_profile(p_employee_id INTEGER) RETURNS JSONB AS $$
    SELECT jsonb_build_object(
        'employee', (SELECT to_jsonb(d) FROM v_employee_directory d WHERE d.employee_id = p_employee_id),
        'grants', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'grant_id', er.grant_id, 'role_id', er.role_id, 'role_name', r.role_name,
                       'grant_type', er.grant_type, 'status', er.status,
                       'granted_at', er.granted_at, 'expires_at', er.expires_at,
                       'granted_by', gb.full_name, 'justification', er.justification)
                   ORDER BY er.granted_at DESC), '[]'::jsonb)
            FROM employee_roles er
            JOIN roles r ON r.role_id = er.role_id
            LEFT JOIN employees gb ON gb.employee_id = er.granted_by
            WHERE er.employee_id = p_employee_id
        ),
        'effective_roles', (
            SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.role_name), '[]'::jsonb)
            FROM fn_effective_roles(p_employee_id) x
        ),
        'effective_permissions', (
            SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.resource_type, x.action), '[]'::jsonb)
            FROM fn_effective_permissions(p_employee_id) x
        ),
        'recent_activity', (
            SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.occurred_at DESC), '[]'::jsonb)
            FROM (SELECT al.log_id, al.action, res.resource_name, al.occurred_at, al.success,
                         al.ip_address::TEXT AS ip_address
                  FROM access_logs al
                  JOIN resources res ON res.resource_id = al.resource_id
                  WHERE al.employee_id = p_employee_id
                  ORDER BY al.occurred_at DESC
                  LIMIT 20) a
        ),
        'findings', (
            SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.severity_rank, f.detected_at DESC), '[]'::jsonb)
            FROM v_findings_detail f
            WHERE f.employee_id = p_employee_id AND f.status IN ('open', 'under_review')
        ),
        'risk_score', fn_calculate_risk_score(p_employee_id)
    );
$$ LANGUAGE sql STABLE;


-- ============================================================================
-- 10. RECERTIFICATION VIEWS
-- ============================================================================
CREATE OR REPLACE VIEW v_recertification_items AS
SELECT ri.item_id,
       ri.campaign_id,
       c.name         AS campaign_name,
       ri.employee_id,
       e.full_name    AS employee_name,
       e.department,
       ri.grant_id,
       r.role_name,
       er.grant_type,
       er.status      AS grant_status,
       er.expires_at,
       ri.reviewer_id,
       rv.full_name   AS reviewer_name,
       ri.decision,
       ri.reviewed_at
FROM recertification_items ri
JOIN recertification_campaigns c ON c.campaign_id = ri.campaign_id
JOIN employees e                 ON e.employee_id = ri.employee_id
JOIN employee_roles er           ON er.grant_id = ri.grant_id
JOIN roles r                     ON r.role_id = er.role_id
LEFT JOIN employees rv           ON rv.employee_id = ri.reviewer_id;

CREATE OR REPLACE VIEW v_recertification_campaigns AS
SELECT c.campaign_id,
       c.name,
       c.start_date,
       c.end_date,
       c.status,
       COUNT(ri.item_id)                                     AS total_items,
       COUNT(ri.item_id) FILTER (WHERE ri.decision = 'pending') AS pending_items,
       COUNT(ri.item_id) FILTER (WHERE ri.decision = 'keep')    AS kept_items,
       COUNT(ri.item_id) FILTER (WHERE ri.decision = 'revoke')  AS revoked_items
FROM recertification_campaigns c
LEFT JOIN recertification_items ri ON ri.campaign_id = c.campaign_id
GROUP BY c.campaign_id, c.name, c.start_date, c.end_date, c.status;

-- ============================================================================
-- 11. ROLES & ROLE HIERARCHY PAGES
-- ============================================================================

-- Nodes for the role-hierarchy graph. "level" is the longest path from a root
-- role (a role with no parents), computed with a recursive CTE over the DAG.
CREATE OR REPLACE VIEW v_role_hierarchy_nodes AS
WITH RECURSIVE walk AS (
    SELECT r.role_id, 0 AS lvl
    FROM roles r
    WHERE NOT EXISTS (SELECT 1 FROM role_hierarchy rh WHERE rh.child_role_id = r.role_id)
    UNION ALL
    SELECT rh.child_role_id, w.lvl + 1
    FROM walk w
    JOIN role_hierarchy rh ON rh.parent_role_id = w.role_id
),
lv AS (SELECT role_id, MAX(lvl) AS level FROM walk GROUP BY role_id)
SELECT r.role_id,
       r.role_name,
       r.description,
       COALESCE(lv.level, 0) AS level,
       (SELECT COUNT(*) FROM role_hierarchy rh WHERE rh.child_role_id = r.role_id)  AS parent_count,
       (SELECT COUNT(*) FROM role_hierarchy rh WHERE rh.parent_role_id = r.role_id) AS child_count,
       (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.role_id)      AS direct_permission_count,
       (SELECT COUNT(DISTINCT er.employee_id) FROM employee_roles er
         WHERE er.role_id = r.role_id AND er.status = 'active')                      AS holders
FROM roles r
LEFT JOIN lv ON lv.role_id = r.role_id;

-- Full detail for one role: parents, children, direct + inherited permissions
-- (each tagged with the ancestor role that supplies it), and current holders.
CREATE OR REPLACE FUNCTION fn_role_detail(p_role_id INTEGER) RETURNS JSONB AS $$
    WITH RECURSIVE anc AS (
        SELECT p_role_id AS role_id
        UNION
        SELECT rh.parent_role_id
        FROM anc a
        JOIN role_hierarchy rh ON rh.child_role_id = a.role_id
    )
    SELECT jsonb_build_object(
        'role', (SELECT to_jsonb(n) FROM v_role_hierarchy_nodes n WHERE n.role_id = p_role_id),
        'parents', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('role_id', r.role_id, 'role_name', r.role_name)
                                      ORDER BY r.role_name), '[]'::jsonb)
            FROM role_hierarchy rh JOIN roles r ON r.role_id = rh.parent_role_id
            WHERE rh.child_role_id = p_role_id),
        'children', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('role_id', r.role_id, 'role_name', r.role_name)
                                      ORDER BY r.role_name), '[]'::jsonb)
            FROM role_hierarchy rh JOIN roles r ON r.role_id = rh.child_role_id
            WHERE rh.parent_role_id = p_role_id),
        'permissions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'permission_id', p.permission_id, 'action', p.action,
                       'resource_type', p.resource_type, 'risk_level', p.risk_level,
                       'via_role', r.role_name, 'inherited', (a.role_id <> p_role_id))
                   ORDER BY p.resource_type, p.action), '[]'::jsonb)
            FROM anc a
            JOIN role_permissions rp ON rp.role_id = a.role_id
            JOIN permissions p       ON p.permission_id = rp.permission_id
            JOIN roles r             ON r.role_id = a.role_id),
        'holders', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'employee_id', e.employee_id, 'full_name', e.full_name,
                       'department', e.department, 'grant_type', er.grant_type)
                   ORDER BY e.full_name), '[]'::jsonb)
            FROM employee_roles er JOIN employees e ON e.employee_id = er.employee_id
            WHERE er.role_id = p_role_id AND er.status = 'active')
    );
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- END OF api_views.sql
-- ============================================================================