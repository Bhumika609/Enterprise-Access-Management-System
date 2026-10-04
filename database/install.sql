-- ============================================================================
-- EAPIS — one-shot installer.  Run from THIS directory (paths are relative):
--
--     cd database
--     psql -U <user> -d eapis -v ON_ERROR_STOP=1 -f install.sql
--
-- Order matters: later files depend on objects created by earlier ones.
-- ============================================================================
\echo '>> Phase 1: schema'
\i schema.sql
\echo '>> Phase 2: seed data (with intentionally planted issues)'
\i seed_data.sql
\echo '>> Phase 3: core RBAC logic (recursive CTEs, cycle guard, audit triggers)'
\i functions/core_rbac_functions.sql
\echo '>> Phase 4: detection engine'
\i procedures/detection_engine.sql
\echo '>> Phase 5: lifecycle (auto-expiry, break-glass, recertification, pg_cron)'
\i procedures/lifecycle_jobs.sql
\echo '>> Admin management functions (roles, permissions, SoD rules, delegation)'
\i functions/admin_management.sql
\echo '>> Phase 6a: API-facing views and functions'
\i functions/api_views.sql
\echo '>> Reporting views'
\i functions/reports.sql
\echo '>> Running the detectors once so the dashboard has findings on first launch'
CALL sp_run_all_detectors();
\echo '>> EAPIS database ready.'
