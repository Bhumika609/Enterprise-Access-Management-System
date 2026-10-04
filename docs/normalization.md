# Normalization (to 3NF)

Notation: `A → B` means "A functionally determines B". Surrogate integer keys are used throughout, so each table's candidate keys are the surrogate key plus any `UNIQUE` natural key shown.

**1NF** – every column is atomic and every table has a primary key. The only structured values are the deliberate `jsonb` columns discussed at the end.
**2NF** – every non-key attribute depends on the *whole* key. Only the junction tables have composite keys, and they hold no non-key attributes (or, for `employee_roles`, a surrogate key), so partial dependencies cannot occur.
**3NF** – no non-key attribute depends on another non-key attribute.

| Table | Key | Functional dependencies | 3NF? |
|---|---|---|---|
| `employees` | `employee_id` (UNIQUE `email`) | employee_id → full_name, email, department, manager_id, status, hire_date. Manager's *name* is not stored; it is reached through `manager_id` (self-FK). | ✔ |
| `roles` | `role_id` (UNIQUE `role_name`) | role_id → role_name, description | ✔ |
| `permissions` | `permission_id` (UNIQUE `action, resource_type`) | permission_id → risk_level, expected_frequency, description | ✔ |
| `resources` | `resource_id` | resource_id → resource_name, resource_type, owner_id | ✔ |
| `role_hierarchy` | `(child_role_id, parent_role_id)` | Pure M:N junction (the DAG edges); no other attributes. `CHECK child <> parent`; cycle trigger. | ✔ |
| `role_permissions` | `(role_id, permission_id)` | Pure M:N junction | ✔ |
| `employee_roles` | `grant_id` (UNIQUE `employee_id, role_id, granted_at`) | grant_id → employee_id, role_id, grant_type, granted_by, granted_at, expires_at, justification, status, … Role *name* and employee *name* are not duplicated. | ✔ |
| `sod_conflict_rules` | `rule_id` (UNIQUE pair) | rule_id → permission_a_id, permission_b_id, severity, description, is_active | ✔ |
| `access_logs` | `log_id` | log_id → employee_id, resource_id, action, occurred_at, success, ip_address. Department / resource name are looked up by join. | ✔ |
| `audit_logs` | `audit_id` | audit_id → actor_id, target_type, target_id, change_type, old_value, new_value, occurred_at | ✔ |
| `findings` | `finding_id` | finding_id → employee_id, finding_type, severity, status, detected_at, resolution fields, related_entity | ✔ |
| `access_requests` | `request_id` | request_id → requester_id, role_id / resource_id, flags, justification, status, reviewer fields | ✔ |
| `recertification_campaigns` | `campaign_id` | campaign_id → name, dates, status | ✔ |
| `recertification_items` | `item_id` (UNIQUE `campaign_id, grant_id`) | item_id → employee_id, reviewer_id, decision, reviewed_at | ✔ (see note) |
| `app_users` | `user_id` (UNIQUE `username`) | user_id → employee_id, password_hash, system_role, … | ✔ |

### Notes and deliberate decisions

- **`recertification_items.employee_id`** is derivable from `grant_id → employee_roles.employee_id`. It is kept as a controlled redundancy so a manager's review queue can be filtered without a join and so the item remains meaningful if the grant row is later changed. This is a documented denormalization, not an accident; remove the column if strict 3NF is preferred.
- **Derived data is never stored.** Effective roles/permissions, risk scores, summaries and report rows are computed by functions and views, so they cannot drift from the base tables.
- **`jsonb` columns** (`findings.related_entity`, `audit_logs.old_value / new_value`) are evidence snapshots. They are written once and never queried as relational data in the application's transactions, which is why they are modelled as opaque documents. The values the system filters on (employee, type, severity, status, time) are ordinary columns.
- **Enumerated values** (severity, status, grant type …) are enforced with `CHECK` constraints rather than lookup tables because the sets are small, fixed by the domain and carry no further attributes.
