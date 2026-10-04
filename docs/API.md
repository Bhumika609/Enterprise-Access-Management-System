# REST API reference

Base URL `http://localhost:4000/api`. All routes except `/health` and `/auth/login` need `Authorization: Bearer <JWT>`. Roles: `admin`, `auditor`, `manager`, `viewer`. Every route is a thin wrapper over a PostgreSQL view or function.

| Method & path | Roles | Backed by |
|---|---|---|
| `GET /health` | public | `SELECT 1` |
| `POST /auth/login` · `GET /auth/me` | public · any | `app_users` (bcrypt, JWT) |
| `GET /dashboard` | any | `fn_dashboard_summary()` |
| `GET /employees?search&department&status&sort&limit&offset` | any | `v_employee_directory` |
| `GET /employees/meta/departments` · `GET /employees/:id` | any | `fn_employee_profile()` |
| `GET /roles` · `GET /roles/:id` | any | `fn_role_detail()` |
| `GET /role-hierarchy` | any | `v_role_hierarchy_nodes`, `role_hierarchy` |
| `GET /permissions` · `GET /sod-rules` · `GET /resources` | any | tables / `v_sod_rules_detail` |
| `GET /findings?type&severity&status&employee_id&search` · `GET /findings/:id` | any | `v_findings_detail` |
| `PATCH /findings/:id` `{status, notes}` | admin, auditor, manager | `fn_update_finding_status()` |
| `GET /sod-violations` · `GET /unused-access` (`?status=active\|resolved\|all`) | any | `v_sod_violations`, `v_unused_access` |
| `GET /access-requests?status` · `POST /access-requests` | any | `v_access_requests_detail`, `fn_create_access_request()` |
| `POST /access-requests/:id/approve` · `/reject` | admin, manager | `fn_review_access_request()` (no self-approval) |
| `GET /delegations` · `POST /delegations` · `POST /delegations/:id/revoke` | any | `v_delegations`, `fn_delegate_role()`, `fn_revoke_delegation()` |
| `GET /recertification/campaigns` · `GET /recertification/items` | any | `v_recertification_campaigns`, `_items` |
| `POST /recertification/campaigns` · `/campaigns/:id/close` | admin | `sp_launch_recertification_campaign()`, `sp_close_recertification_campaign()` |
| `POST /recertification/items/:id/decision` `{decision: keep\|revoke}` | admin, manager | `sp_apply_recertification_decision()` (revoke really revokes the grant) |
| `GET /reports` · `GET /reports/:name?format=json\|csv` | admin, auditor, manager | `v_report_*` (`risk-scores`, `sod-conflicts`, `unused-permissions`, `campaign-status`, `break-glass`) |
| `GET /access-logs` · `GET /audit-logs` (filters + paging) | any | `v_access_logs_detail`, `v_audit_logs_detail` |
| `POST /admin/run-detectors` · `POST /admin/expire-grants` | admin | `sp_run_all_detectors()`, `sp_expire_stale_grants()` |
| `POST/PATCH/DELETE /manage/roles[/:id[/permissions\|parents/...]]`, `/manage/permissions`, `/manage/sod-rules` | admin | `fn_create_role()`, `fn_grant_permission_to_role()`, `fn_add_role_parent()`, `fn_create_sod_rule()`, … (audit-logged by trigger) |

Errors are JSON `{ "error": "message" }`; business-rule violations raised in PostgreSQL (`RAISE EXCEPTION`) come back as `400`.
