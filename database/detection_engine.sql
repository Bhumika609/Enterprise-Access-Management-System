-- ============================================================================
-- EAPIS — PHASE 4: DETECTION ENGINE
-- Requires schema.sql, seed_data.sql, and core_rbac_functions.sql applied.
--
-- Every detector here is idempotent: re-running any of them (e.g. nightly via
-- pg_cron in Phase 5) will not create duplicate findings for a violation that
-- is already open — each INSERT is guarded by a NOT EXISTS / EXISTS check
-- against findings using a stable fingerprint stored in related_entity.
--
-- Contents:
--   1. sp_detect_sod_violations()      — direct + indirect SoD, using a
--                                         CURSOR over employees (per spec:
--                                         "Cursors — batch iteration during
--                                         SoD/unused-access analysis")
--   2. sp_detect_unused_access()       — granted-vs-used comparison over a
--                                         rolling window, also CURSOR-driven,
--                                         excludes 'rare' frequency-tagged
--                                         permissions and newly-granted access
--   3. sp_detect_anomalous_access()    — odd-hour, new-IP, volume-spike,
--                                         failed-then-success, and
--                                         out-of-granted-scope access,
--                                         each as a set-based INSERT..SELECT
--   4. fn_calculate_risk_score()       — aggregates open findings per
--                                         employee into a single risk score
--   5. sp_run_all_detectors()          — convenience wrapper Phase 5's
--                                         pg_cron job will call nightly
-- ============================================================================


-- ============================================================================
-- 1. SoD VIOLATION DETECTION (direct + indirect / privilege-escalation)
-- ----------------------------------------------------------------------------
-- For each active sod_conflict_rules row and each active employee: does the
-- employee's resolved permission set (fn_effective_permissions) contain BOTH
-- sides of the conflict?
--   - If some single role_id supplies BOTH permission_a and permission_b,
--     that is a DIRECT conflict -> finding_type = 'sod_violation'.
--   - If the two permissions only ever come from DIFFERENT roles (i.e. the
--     conflict only exists because the employee happens to hold both roles
--     together, via direct grants and/or role_hierarchy inheritance), that
--     is an INDIRECT conflict, only visible by walking the DAG -> finding_type
--     = 'privilege_escalation' (Section 8d).
-- ============================================================================
CREATE OR REPLACE PROCEDURE sp_detect_sod_violations()
LANGUAGE plpgsql AS $$
DECLARE
    emp_cursor CURSOR FOR SELECT employee_id FROM employees WHERE status = 'active';
    v_emp_id      INTEGER;
    v_rule        RECORD;
    v_roles_a     INTEGER[];
    v_roles_b     INTEGER[];
    v_common      INTEGER[];
    v_finding_type VARCHAR(30);
    v_already_open BOOLEAN;
BEGIN
    OPEN emp_cursor;
    LOOP
        FETCH emp_cursor INTO v_emp_id;
        EXIT WHEN NOT FOUND;

        FOR v_rule IN SELECT * FROM sod_conflict_rules WHERE is_active = TRUE LOOP

            SELECT array_agg(DISTINCT via_role_id) INTO v_roles_a
            FROM fn_effective_permissions(v_emp_id)
            WHERE permission_id = v_rule.permission_a_id;

            SELECT array_agg(DISTINCT via_role_id) INTO v_roles_b
            FROM fn_effective_permissions(v_emp_id)
            WHERE permission_id = v_rule.permission_b_id;

            -- employee must hold BOTH sides for this to be a violation at all
            IF v_roles_a IS NULL OR v_roles_b IS NULL THEN
                CONTINUE;
            END IF;

            SELECT array_agg(x) INTO v_common
            FROM (
                SELECT unnest(v_roles_a)
                INTERSECT
                SELECT unnest(v_roles_b)
            ) AS t(x);

            IF v_common IS NOT NULL AND array_length(v_common, 1) > 0 THEN
                v_finding_type := 'sod_violation';       -- one role grants both sides
            ELSE
                v_finding_type := 'privilege_escalation'; -- only the combination does
            END IF;

            SELECT EXISTS (
                SELECT 1 FROM findings
                WHERE employee_id = v_emp_id
                  AND finding_type = v_finding_type
                  AND status IN ('open', 'under_review')
                  AND (related_entity->>'rule_id')::INTEGER = v_rule.rule_id
            ) INTO v_already_open;

            IF NOT v_already_open THEN
                INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
                VALUES (
                    v_emp_id, v_finding_type,
                    jsonb_build_object(
                        'rule_id', v_rule.rule_id,
                        'permission_a_id', v_rule.permission_a_id,
                        'permission_b_id', v_rule.permission_b_id,
                        'roles_granting_a', v_roles_a,
                        'roles_granting_b', v_roles_b,
                        'common_roles', v_common,
                        'description', v_rule.description
                    ),
                    v_rule.severity, 'open', now()
                );
            END IF;

        END LOOP;
    END LOOP;
    CLOSE emp_cursor;
END;
$$;

COMMENT ON PROCEDURE sp_detect_sod_violations IS
    'Walks every active employee against every active SoD rule; writes sod_violation (single role grants both sides) or privilege_escalation (only the role combination does) findings. Idempotent.';


-- ============================================================================
-- 2. UNUSED ACCESS / ENTITLEMENT CREEP DETECTION
-- ----------------------------------------------------------------------------
-- For every currently active, non-expired role grant older than the grace
-- period, and every non-'rare' permission that role includes: has the
-- employee actually exercised that (action, resource_type) combination
-- within the rolling window? If never, flag it as a revocation candidate.
-- ============================================================================
CREATE OR REPLACE PROCEDURE sp_detect_unused_access(
    p_window_days INTEGER DEFAULT 90,
    p_grace_days  INTEGER DEFAULT 30
)
LANGUAGE plpgsql AS $$
DECLARE
    grant_cursor CURSOR FOR
        SELECT er.employee_id, er.role_id, er.grant_id, r.role_name,
               p.permission_id, p.action, p.resource_type, p.risk_level
        FROM employee_roles er
        JOIN roles r ON r.role_id = er.role_id
        JOIN role_permissions rp ON rp.role_id = er.role_id
        JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE er.status = 'active'
          AND (er.expires_at IS NULL OR er.expires_at > now())
          AND er.granted_at <= now() - (p_grace_days || ' days')::interval
          AND p.expected_frequency <> 'rare';
    v_row RECORD;
    v_used BOOLEAN;
    v_already_open BOOLEAN;
BEGIN
    OPEN grant_cursor;
    LOOP
        FETCH grant_cursor INTO v_row;
        EXIT WHEN NOT FOUND;

        SELECT EXISTS (
            SELECT 1 FROM access_logs al
            JOIN resources res ON res.resource_id = al.resource_id
            WHERE al.employee_id = v_row.employee_id
              AND res.resource_type = v_row.resource_type
              AND al.action = v_row.action
              AND al.occurred_at >= now() - (p_window_days || ' days')::interval
        ) INTO v_used;

        CONTINUE WHEN v_used;

        SELECT EXISTS (
            SELECT 1 FROM findings
            WHERE employee_id = v_row.employee_id
              AND finding_type = 'unused_access'
              AND status IN ('open', 'under_review')
              AND (related_entity->>'grant_id')::INTEGER = v_row.grant_id
              AND (related_entity->>'permission_id')::INTEGER = v_row.permission_id
        ) INTO v_already_open;

        IF NOT v_already_open THEN
            INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
            VALUES (
                v_row.employee_id, 'unused_access',
                jsonb_build_object(
                    'grant_id', v_row.grant_id, 'role_id', v_row.role_id, 'role_name', v_row.role_name,
                    'permission_id', v_row.permission_id, 'action', v_row.action,
                    'resource_type', v_row.resource_type, 'window_days', p_window_days
                ),
                v_row.risk_level, 'open', now()
            );
        END IF;

    END LOOP;
    CLOSE grant_cursor;
END;
$$;

COMMENT ON PROCEDURE sp_detect_unused_access IS
    'Flags active, non-rare permissions granted more than p_grace_days ago that have produced zero matching access_logs activity in the trailing p_window_days. Idempotent.';


-- ============================================================================
-- 3. ANOMALOUS ACCESS DETECTION
-- ----------------------------------------------------------------------------
-- Five set-based patterns, each idempotent via its own NOT EXISTS guard.
-- Window functions/correlated subqueries are the natural tool here (not
-- cursors) since every pattern is a comparison across many rows at once.
-- ============================================================================
CREATE OR REPLACE PROCEDURE sp_detect_anomalous_access(p_window_days INTEGER DEFAULT 30)
LANGUAGE plpgsql AS $$
BEGIN

    -- (a) Odd-hour access: successful access between midnight and 5 AM server time
    INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
    SELECT al.employee_id, 'anomalous_access',
           jsonb_build_object('pattern', 'odd_hour_access', 'log_id', al.log_id,
                               'occurred_at', al.occurred_at, 'ip_address', al.ip_address::text),
           'medium', 'open', now()
    FROM access_logs al
    WHERE al.success = TRUE
      AND al.occurred_at >= now() - (p_window_days || ' days')::interval
      AND EXTRACT(HOUR FROM al.occurred_at) BETWEEN 0 AND 5
      AND NOT EXISTS (
          SELECT 1 FROM findings f
          WHERE f.employee_id = al.employee_id AND f.finding_type = 'anomalous_access'
            AND f.status IN ('open','under_review')
            AND f.related_entity->>'pattern' = 'odd_hour_access'
            AND (f.related_entity->>'log_id')::INTEGER = al.log_id
      );

    -- (b) New/unrecognized IP: first-ever appearance of this (employee, ip)
    -- pair, occurring AFTER the employee already has an access history from
    -- a different IP (so it's a genuine deviation, not just a new hire's
    -- first-ever login).
    INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
    SELECT al.employee_id, 'anomalous_access',
           jsonb_build_object('pattern', 'new_ip_address', 'log_id', al.log_id,
                               'occurred_at', al.occurred_at, 'ip_address', al.ip_address::text),
           'medium', 'open', now()
    FROM access_logs al
    WHERE al.occurred_at >= now() - (p_window_days || ' days')::interval
      AND al.occurred_at = (
          SELECT MIN(prior.occurred_at) FROM access_logs prior
          WHERE prior.employee_id = al.employee_id AND prior.ip_address = al.ip_address
      )
      AND EXISTS (
          SELECT 1 FROM access_logs earlier
          WHERE earlier.employee_id = al.employee_id
            AND earlier.ip_address <> al.ip_address
            AND earlier.occurred_at < al.occurred_at
      )
      AND NOT EXISTS (
          SELECT 1 FROM findings f
          WHERE f.employee_id = al.employee_id AND f.finding_type = 'anomalous_access'
            AND f.status IN ('open','under_review')
            AND f.related_entity->>'pattern' = 'new_ip_address'
            AND (f.related_entity->>'log_id')::INTEGER = al.log_id
      );

    -- (c) Volume spike: a day's access count for an employee is both >=10 and
    -- more than 5x their own trailing average from prior days.
    INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
    SELECT s.employee_id, 'anomalous_access',
           jsonb_build_object('pattern', 'volume_spike', 'day', s.day, 'count', s.cnt,
                               'baseline_avg', round(s.avg_before, 2)),
           'high', 'open', now()
    FROM (
        SELECT employee_id, day, cnt,
               AVG(cnt) OVER (PARTITION BY employee_id ORDER BY day
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS avg_before
        FROM (
            SELECT employee_id, date_trunc('day', occurred_at) AS day, COUNT(*) AS cnt
            FROM access_logs
            GROUP BY employee_id, date_trunc('day', occurred_at)
        ) daily
    ) s
    WHERE s.day >= now() - (p_window_days || ' days')::interval
      AND s.avg_before IS NOT NULL AND s.avg_before > 0
      AND s.cnt >= 10 AND s.cnt > 5 * s.avg_before
      AND NOT EXISTS (
          SELECT 1 FROM findings f
          WHERE f.employee_id = s.employee_id AND f.finding_type = 'anomalous_access'
            AND f.status IN ('open','under_review')
            AND f.related_entity->>'pattern' = 'volume_spike'
            AND (f.related_entity->>'day')::TIMESTAMP = s.day
      );

    -- (d) Failed-then-success (brute force): a successful access preceded by
    -- >= 3 failed attempts on the same resource within the prior 15 minutes.
    INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
    SELECT al.employee_id, 'anomalous_access',
           jsonb_build_object('pattern', 'failed_then_success', 'log_id', al.log_id,
                               'occurred_at', al.occurred_at, 'ip_address', al.ip_address::text,
                               'preceding_failures', fc.fail_count),
           'critical', 'open', now()
    FROM access_logs al
    CROSS JOIN LATERAL (
        SELECT COUNT(*) AS fail_count FROM access_logs f
        WHERE f.employee_id = al.employee_id AND f.resource_id = al.resource_id
          AND f.success = FALSE
          AND f.occurred_at BETWEEN al.occurred_at - INTERVAL '15 minutes' AND al.occurred_at
    ) fc
    WHERE al.success = TRUE
      AND al.occurred_at >= now() - (p_window_days || ' days')::interval
      AND fc.fail_count >= 3
      AND NOT EXISTS (
          SELECT 1 FROM findings f
          WHERE f.employee_id = al.employee_id AND f.finding_type = 'anomalous_access'
            AND f.status IN ('open','under_review')
            AND f.related_entity->>'pattern' = 'failed_then_success'
            AND (f.related_entity->>'log_id')::INTEGER = al.log_id
      );

    -- (e) Access outside granted scope: a successful (action, resource_type)
    -- combination the employee holds NO effective permission for at all —
    -- i.e. access that shouldn't have been possible under least privilege.
    INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
    SELECT al.employee_id, 'anomalous_access',
           jsonb_build_object('pattern', 'access_outside_granted_scope', 'log_id', al.log_id,
                               'resource_id', al.resource_id, 'action', al.action,
                               'resource_type', res.resource_type, 'occurred_at', al.occurred_at),
           'high', 'open', now()
    FROM access_logs al
    JOIN resources res ON res.resource_id = al.resource_id
    WHERE al.success = TRUE
      AND al.occurred_at >= now() - (p_window_days || ' days')::interval
      AND NOT EXISTS (
          SELECT 1 FROM fn_effective_permissions(al.employee_id) ep
          WHERE ep.resource_type = res.resource_type AND ep.action = al.action
      )
      AND NOT EXISTS (
          SELECT 1 FROM findings f
          WHERE f.employee_id = al.employee_id AND f.finding_type = 'anomalous_access'
            AND f.status IN ('open','under_review')
            AND f.related_entity->>'pattern' = 'access_outside_granted_scope'
            AND (f.related_entity->>'log_id')::INTEGER = al.log_id
      );

END;
$$;

COMMENT ON PROCEDURE sp_detect_anomalous_access IS
    'Five anomaly patterns over the trailing window: odd-hour access, new/unrecognized IP, daily volume spikes, failed-then-success brute-force clustering, and access outside the employees granted permission scope. Idempotent.';


-- ============================================================================
-- 4. RISK SCORING
-- ----------------------------------------------------------------------------
-- Aggregates: (# open SoD conflicts * 25) + (# open unused-access findings * 5)
-- + (# open anomalous-access findings * 15) + (# open privilege-escalation
-- findings * 30), further weighted by finding severity. Weights are simple
-- and transparent by design — Section 8e only asks for an aggregate score
-- feeding a "Top Risky Employees" view, not a specific formula.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_calculate_risk_score(p_employee_id INTEGER)
RETURNS INTEGER AS $$
    SELECT COALESCE(SUM(
        CASE f.finding_type
            WHEN 'sod_violation'        THEN 25
            WHEN 'privilege_escalation' THEN 30
            WHEN 'anomalous_access'     THEN 15
            WHEN 'unused_access'        THEN 5
        END
        *
        CASE f.severity
            WHEN 'critical' THEN 2.0
            WHEN 'high'      THEN 1.5
            WHEN 'medium'    THEN 1.0
            WHEN 'low'       THEN 0.5
        END
    ), 0)::INTEGER
    FROM findings f
    WHERE f.employee_id = p_employee_id
      AND f.status IN ('open', 'under_review');
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_calculate_risk_score IS
    'Weighted sum of an employees open/under-review findings (weighted by finding_type then severity). Feeds the Top Risky Employees dashboard view.';

CREATE OR REPLACE VIEW v_employee_risk_scores AS
SELECT e.employee_id, e.full_name, e.department,
       fn_calculate_risk_score(e.employee_id) AS risk_score,
       COUNT(f.finding_id) FILTER (WHERE f.status IN ('open','under_review')) AS open_finding_count
FROM employees e
LEFT JOIN findings f ON f.employee_id = e.employee_id AND f.status IN ('open','under_review')
GROUP BY e.employee_id, e.full_name, e.department
ORDER BY risk_score DESC;

COMMENT ON VIEW v_employee_risk_scores IS
    'Top Risky Employees dashboard source: one row per employee, sorted by risk_score descending.';


-- ============================================================================
-- 5. RUN-ALL WRAPPER — Phase 5's pg_cron job calls this nightly
-- ============================================================================
CREATE OR REPLACE PROCEDURE sp_run_all_detectors()
LANGUAGE plpgsql AS $$
BEGIN
    CALL sp_detect_sod_violations();
    CALL sp_detect_unused_access();
    CALL sp_detect_anomalous_access();
END;
$$;

COMMENT ON PROCEDURE sp_run_all_detectors IS
    'Runs every detector in sequence. Intended as the target of the nightly pg_cron job set up in Phase 5.';

-- ============================================================================
-- END OF PHASE 4
-- Next (Phase 5): lifecycle jobs — pg_cron scheduling of sp_run_all_detectors,
-- auto-expiry of temporary/break-glass employee_roles grants, and the
-- recertification-campaign workflow.
-- ============================================================================