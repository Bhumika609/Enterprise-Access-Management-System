# Requirements traceability

Maps every item of the *EAPIS Project Overview* to where it is implemented and how it is verified.

| # | Overview requirement | Implemented in | Verified by |
|---|---|---|---|
| §3, §7 | Relational model, 3NF, PK/FK, NOT NULL / UNIQUE / CHECK | `database/schema.sql`; [`docs/normalization.md`](normalization.md) | clean `install.sql` run; one documented denormalization noted in the doc |
| §3, §6 | Role hierarchy as a DAG (junction table) | `role_hierarchy`; cycle trigger in `core_rbac_functions.sql` | sample query 4; smoke test "multi-parent role has 2 parents" |
| §6 | Entities and relationships (ER, Chen) | [`docs/ER_diagram.png`](ER_diagram.png); physical: [`schema_diagram.png`](schema_diagram.png) | generated from DDL |
| §8a | SoD detection, configurable, direct + indirect | `sod_conflict_rules`, `sp_detect_sod_violations` | smoke: "SoD page distinguishes direct vs indirect" |
| §8a | Seeded examples (payment, user/admin, code/deploy) | `seed_data.sql` | sample query 5 |
| §8b | Unused access, 90-day window, grace period, rare exclusion | `sp_detect_unused_access` (direct **and inherited** pass) | smoke: "inherited unused permission is detected" |
| §8c | Odd hours · new IP · spike · failed-then-success | `sp_detect_anomalous_access` | sample query 7 |
| §8c | Access outside employee's department | `sp_detect_anomalous_access` pattern *(f)* `cross_department_access` | smoke: "cross-department access is detected" |
| §8d | Privilege-escalation path through hierarchy | `sp_detect_sod_violations` (indirect branch) → `privilege_escalation` | sample query 5 |
| §8e | Per-employee risk score | `fn_calculate_risk_score`, `v_employee_risk_scores` | sample query 8 |
| §8 | All detectors write to one `findings` table | `findings` | detectors idempotent (sample query 11) |
| §9 | Time-bound access + auto-expiry job | `sp_expire_stale_grants`, `pg_cron` / API timer | sample query 10 |
| §9 | Break-glass: justification, auto-expiry, auto-flag | CHECK constraint + `trg_flag_break_glass_grant` | sample query 9 |
| §9 | Approval workflow, audited | `fn_create_access_request`, `fn_review_access_request`, audit trigger | smoke "Access request workflow" (9 checks) |
| §9 | Recertification campaigns | `sp_launch_…`, `sp_apply_recertification_decision`, `sp_close_…` | smoke "Recertification" |
| §2 | Delegated access | `fn_delegate_role` (+ preventive SoD check) | `manage.test.js` (19 checks) |
| §2 | Access log separate from audit log | `access_logs` vs `audit_logs` (triggers) | Logs pages |
| §10 | Recursive CTEs, procedures, functions, triggers, cursors, pg_cron | across `database/functions` and `procedures` | – |
| §11 | Dashboard: 7 summary cards, risk chart, activity chart, top risky | `frontend/src/pages/Home.jsx` | `pages.test.jsx` "dashboard" |
| §11 | Employees list + detailed profile | `Employees.jsx`, `EmployeeProfile.jsx` | UI test "opens an employee profile" |
| §11 | Roles & Permissions | `Roles.jsx` | UI tests (admin vs viewer) |
| §11 | Role Hierarchy graph (multi-parent DAG) | `RoleHierarchy.jsx` | UI test "draws the role DAG" |
| §11 | Access Requests (approve/reject, temp, break-glass) | `AccessRequests.jsx` | page load test |
| §11 | SoD Violations · Unused Access · Findings (review & resolve) | `SodViolations.jsx`, `UnusedAccess.jsx`, `Findings.jsx`, `FindingReview.jsx` | UI test "opens a finding for review" |
| §11 | Access Logs · Audit Logs | `AccessLogs.jsx`, `AuditLogs.jsx` | page load tests |
| §11 | Severity badges, search/filter, drill-down, charts | `components/ui.jsx`, `components/charts.jsx` | – |
| §12 | Auth & authorization for the system itself | `backend/src/auth.js`, per-route `authorize()` | smoke "Authentication", role 403 checks |
| §12 | Reporting: risk list, conflicts, unused, campaign status | `database/functions/reports.sql`, `routes/reports.js`, `Reports.jsx` (CSV) | smoke "Reports" (6 checks) |
| §12 | Seed data with planted issues | `seed_data.sql` | findings counts after install |
| §14 | Folder structure | see README | – |
| §15 Phase 7 | Normalization proof, sample queries/outputs, report | `docs/` | – |

## Known limitations

- The frontend has no automated browser-level visual tests; UI tests run in jsdom against the real API.
- `recertification_items.employee_id` is a documented redundancy (see normalization notes).
- Demo passwords and the default `JWT_SECRET` fallback are for development only.
