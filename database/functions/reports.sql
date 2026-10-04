-- ============================================================================
-- EAPIS — REPORTING VIEWS (Section 12: "Reporting/dashboard")
-- Requires api_views.sql. Each view is one downloadable report; the API layer
-- only serialises them (JSON or CSV). No logic lives outside PostgreSQL.
--
--   v_report_risk_scored_employees  — every employee ranked by risk score
--   v_report_sod_conflicts          — conflict report (direct + indirect)
--   v_report_unused_permissions     — unused-permission / revocation candidates
--   v_report_campaign_status        — certification campaign progress
--   v_report_break_glass            — emergency access usage, for auditors
-- ============================================================================

CREATE OR REPLACE VIEW v_report_risk_scored_employees AS
SELECT e.employee_id,
       e.full_name,
       e.department,
       e.status,
       fn_calculate_risk_score(e.employee_id) AS risk_score,
       CASE WHEN fn_calculate_risk_score(e.employee_id) >= 100 THEN 'Critical'
            WHEN fn_calculate_risk_score(e.employee_id) >= 50  THEN 'High'
            WHEN fn_calculate_risk_score(e.employee_id) >= 20  THEN 'Medium'
            WHEN fn_calculate_risk_score(e.employee_id) >  0   THEN 'Low'
            ELSE 'None' END AS risk_band,
       COUNT(f.*) FILTER (WHERE f.finding_type = 'sod_violation')        AS sod_violations,
       COUNT(f.*) FILTER (WHERE f.finding_type = 'privilege_escalation') AS privilege_escalations,
       COUNT(f.*) FILTER (WHERE f.finding_type = 'unused_access')        AS unused_permissions,
       COUNT(f.*) FILTER (WHERE f.finding_type = 'anomalous_access')     AS anomalous_events
FROM employees e
LEFT JOIN findings f ON f.employee_id = e.employee_id AND f.status IN ('open', 'under_review')
GROUP BY e.employee_id, e.full_name, e.department, e.status
ORDER BY risk_score DESC, e.full_name;

CREATE OR REPLACE VIEW v_report_sod_conflicts AS
SELECT finding_id, full_name AS employee, department, conflict_kind,
       permission_a, permission_b, roles_granting_a, roles_granting_b,
       severity, status, detected_at, rule_description
FROM v_sod_violations
ORDER BY severity_rank, full_name;

CREATE OR REPLACE VIEW v_report_unused_permissions AS
SELECT finding_id, full_name AS employee, department,
       action || ' ' || resource_type AS permission,
       role_name AS granted_through_role,
       CASE WHEN inherited THEN 'Inherited via ' || COALESCE(held_role_name, '?') ELSE 'Direct grant' END AS grant_path,
       window_days AS days_without_use,
       severity, status, detected_at
FROM v_unused_access
ORDER BY severity_rank, full_name;

CREATE OR REPLACE VIEW v_report_campaign_status AS
SELECT campaign_id, name, status, start_date, end_date,
       total_items, pending_items, kept_items, revoked_items,
       CASE WHEN total_items = 0 THEN 0
            ELSE round(100.0 * (total_items - pending_items) / total_items, 1) END AS percent_complete,
       (status <> 'completed' AND end_date < CURRENT_DATE) AS overdue
FROM v_recertification_campaigns
ORDER BY campaign_id DESC;

CREATE OR REPLACE VIEW v_report_break_glass AS
SELECT er.grant_id, e.full_name AS employee, e.department, r.role_name,
       gb.full_name AS granted_by, er.granted_at, er.expires_at, er.status,
       er.justification
FROM employee_roles er
JOIN employees e ON e.employee_id = er.employee_id
JOIN roles r ON r.role_id = er.role_id
LEFT JOIN employees gb ON gb.employee_id = er.granted_by
WHERE er.grant_type = 'break_glass'
ORDER BY er.granted_at DESC;
