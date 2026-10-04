-- ============================================================================
-- EAPIS — PHASE 5: LIFECYCLE FEATURES
-- Requires schema.sql, seed_data.sql, core_rbac_functions.sql, and
-- detection_engine.sql already applied.
--
-- Contents:
--   1. sp_expire_stale_grants()          — auto-revokes employee_roles past
--                                           their expires_at
--   2. fn_flag_break_glass_grant + trigger — auto-flags every break-glass
--                                           grant into findings the instant
--                                           it's inserted (not just at the
--                                           next nightly detection run)
--   3. sp_launch_recertification_campaign() / sp_apply_recertification_decision()
--                                         — the periodic access-review workflow
--   4. pg_cron scheduling                — nightly detection + frequent
--                                           auto-expiry, guarded so this
--                                           script does not fail on a
--                                           database where pg_cron isn't
--                                           installed/enabled
-- ============================================================================


-- ============================================================================
-- 1. AUTO-EXPIRY OF TEMPORARY / BREAK-GLASS ACCESS
-- ----------------------------------------------------------------------------
-- Any active grant whose expires_at has passed gets moved to status='expired'
-- (distinct from 'revoked', which means a human explicitly pulled the access).
-- The existing trg_audit_employee_roles trigger from Phase 3 fires
-- automatically on this UPDATE, so every auto-expiry is already captured in
-- audit_logs with no extra code needed here.
-- ============================================================================
CREATE OR REPLACE PROCEDURE sp_expire_stale_grants()
LANGUAGE plpgsql AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE employee_roles
    SET status = 'expired',
        revoked_at = now()
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= now();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'sp_expire_stale_grants: auto-expired % grant(s)', v_count;
END;
$$;

COMMENT ON PROCEDURE sp_expire_stale_grants IS
    'Moves any active employee_roles grant past its expires_at into status=expired. Intended to run frequently via pg_cron (every 15 minutes) so temporary and break-glass access never outlives its window.';


-- ============================================================================
-- 2. BREAK-GLASS AUTO-FLAGGING
-- ----------------------------------------------------------------------------
-- Section 9 requires break-glass grants to be "automatically flagged for
-- review" — this cannot wait for the next nightly detection run, since the
-- whole point of break-glass is that it happened outside normal process and
-- needs eyes on it immediately. A finding is written the instant the grant
-- row is inserted. finding_type reuses 'anomalous_access' (break-glass access
-- is, by definition, an anomaly relative to normal provisioning) rather than
-- widening the findings.finding_type CHECK constraint that Phase 1 already
-- shipped and that you've already applied — the specific pattern is what
-- distinguishes it in related_entity, exactly like the Phase 4 anomaly
-- detectors already do.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_flag_break_glass_grant() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.grant_type = 'break_glass' THEN
        INSERT INTO findings (employee_id, finding_type, related_entity, severity, status, detected_at)
        VALUES (
            NEW.employee_id, 'anomalous_access',
            jsonb_build_object(
                'pattern', 'break_glass_grant',
                'grant_id', NEW.grant_id,
                'role_id', NEW.role_id,
                'granted_by', NEW.granted_by,
                'justification', NEW.justification,
                'expires_at', NEW.expires_at
            ),
            'high', 'open', now()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_flag_break_glass_grant ON employee_roles;
CREATE TRIGGER trg_flag_break_glass_grant
    AFTER INSERT ON employee_roles
    FOR EACH ROW
    WHEN (NEW.grant_type = 'break_glass')
    EXECUTE FUNCTION fn_flag_break_glass_grant();

COMMENT ON FUNCTION fn_flag_break_glass_grant IS
    'Writes an immediate high-severity finding the moment a break-glass grant is inserted, so emergency access surfaces for review without waiting on the nightly detection run.';


-- ============================================================================
-- 3. RECERTIFICATION CAMPAIGN WORKFLOW
-- ----------------------------------------------------------------------------
-- sp_launch_recertification_campaign(): creates a campaign and generates one
-- recertification_items row per currently active grant, assigned to the
-- grant-holder's manager (falling back to the employee themself only if they
-- have no manager, e.g. the CEO).
--
-- sp_apply_recertification_decision(): a manager's keep/revoke call on one
-- item. 'revoke' immediately revokes the underlying employee_roles grant
-- (which — again — the Phase 3 audit trigger captures automatically).
-- ============================================================================
CREATE OR REPLACE PROCEDURE sp_launch_recertification_campaign(
    p_name       VARCHAR,
    p_start_date DATE,
    p_end_date   DATE,
    OUT p_campaign_id INTEGER
)
LANGUAGE plpgsql AS $$
DECLARE
    v_item_count INTEGER;
BEGIN
    INSERT INTO recertification_campaigns (name, start_date, end_date, status)
    VALUES (p_name, p_start_date, p_end_date, 'in_progress')
    RETURNING campaign_id INTO p_campaign_id;

    INSERT INTO recertification_items (campaign_id, employee_id, grant_id, reviewer_id, decision)
    SELECT p_campaign_id, er.employee_id, er.grant_id,
           COALESCE(e.manager_id, e.employee_id),  -- no manager (e.g. CEO) -> self-certifies
           'pending'
    FROM employee_roles er
    JOIN employees e ON e.employee_id = er.employee_id
    WHERE er.status = 'active'
      AND (er.expires_at IS NULL OR er.expires_at > now());

    GET DIAGNOSTICS v_item_count = ROW_COUNT;
    RAISE NOTICE 'sp_launch_recertification_campaign: campaign % created with % item(s)', p_campaign_id, v_item_count;
END;
$$;

COMMENT ON PROCEDURE sp_launch_recertification_campaign IS
    'Opens a new recertification campaign and snapshots every currently active grant into recertification_items, one per manager per report, for keep/revoke review.';


CREATE OR REPLACE PROCEDURE sp_apply_recertification_decision(
    p_item_id     INTEGER,
    p_decision    VARCHAR,   -- 'keep' or 'revoke'
    p_reviewer_id INTEGER
)
LANGUAGE plpgsql AS $$
DECLARE
    v_grant_id INTEGER;
BEGIN
    IF p_decision NOT IN ('keep', 'revoke') THEN
        RAISE EXCEPTION 'sp_apply_recertification_decision: decision must be ''keep'' or ''revoke'', got %', p_decision;
    END IF;

    SELECT grant_id INTO v_grant_id FROM recertification_items WHERE item_id = p_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'sp_apply_recertification_decision: no recertification_items row with item_id %', p_item_id;
    END IF;

    UPDATE recertification_items
    SET decision = p_decision, reviewer_id = p_reviewer_id, reviewed_at = now()
    WHERE item_id = p_item_id;

    IF p_decision = 'revoke' THEN
        UPDATE employee_roles
        SET status = 'revoked', revoked_by = p_reviewer_id, revoked_at = now()
        WHERE grant_id = v_grant_id AND status = 'active';
    END IF;
END;
$$;

COMMENT ON PROCEDURE sp_apply_recertification_decision IS
    'Records a manager''s keep/revoke decision on one recertification item; a revoke decision immediately revokes the underlying employee_roles grant.';


-- Convenience: mark a campaign completed once every item has a decision
CREATE OR REPLACE PROCEDURE sp_close_recertification_campaign(p_campaign_id INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_pending_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_pending_count
    FROM recertification_items WHERE campaign_id = p_campaign_id AND decision = 'pending';

    IF v_pending_count > 0 THEN
        RAISE EXCEPTION 'sp_close_recertification_campaign: campaign % still has % pending item(s)', p_campaign_id, v_pending_count;
    END IF;

    UPDATE recertification_campaigns SET status = 'completed' WHERE campaign_id = p_campaign_id;
END;
$$;


-- ============================================================================
-- 4. PG_CRON SCHEDULING
-- ----------------------------------------------------------------------------
-- Enabling pg_cron itself requires a one-time server-level change made by
-- whoever administers the Postgres instance:
--   1. Install the extension package for your OS (e.g. `postgresql-16-cron`
--      on Debian/Ubuntu, or it ships built-in on most managed providers).
--   2. In postgresql.conf: shared_preload_libraries = 'pg_cron'
--      and cron.database_name = '<this database>', then RESTART the server
--      (this cannot be done with a simple SQL command — it needs a restart).
--   3. Then, once per database: CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- Because step 2 is an infrastructure change outside this script's control,
-- the block below checks whether pg_cron is already installed before
-- scheduling anything, so re-running this file is always safe: on a machine
-- where pg_cron isn't set up yet, it just skips scheduling and tells you so,
-- rather than erroring out and aborting the rest of the script.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'eapis-nightly-detectors';
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'eapis-expire-grants';

        PERFORM cron.schedule(
            'eapis-nightly-detectors',
            '0 2 * * *',                          -- 2:00 AM every day
            'CALL sp_run_all_detectors();'
        );

        PERFORM cron.schedule(
            'eapis-expire-grants',
            '*/15 * * * *',                        -- every 15 minutes
            'CALL sp_expire_stale_grants();'
        );

        RAISE NOTICE 'pg_cron jobs scheduled: eapis-nightly-detectors (02:00 daily), eapis-expire-grants (every 15 min)';
    ELSE
        RAISE NOTICE 'pg_cron extension is not installed/enabled in this database — skipping job scheduling. See the comment block above sp_run_all_detectors scheduling for setup steps. sp_run_all_detectors() and sp_expire_stale_grants() can still be called manually or from the backend API on a schedule in the meantime.';
    END IF;
END;
$$;

-- ============================================================================
-- END OF PHASE 5
-- Next (Phase 6a): REST API layer design — endpoints exposing dashboard
-- summary data, employee profiles, findings, and the workflows built here
-- (access requests, recertification decisions) as callable actions.
-- ============================================================================
