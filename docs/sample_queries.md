# Sample queries and real output

Every output below was produced by running the query against a freshly installed EAPIS database (`database/install.sql`). Timestamps and finding ids will differ on your machine.


## 1. Resolve every role an employee effectively holds (recursive CTE over the DAG)

Sam O'Brien is directly granted only *DevOps Engineer*. The function climbs `role_hierarchy` and finds the rest.

```sql
SELECT * FROM fn_effective_roles((SELECT employee_id FROM employees WHERE email='sam.obrien@eapis-corp.example')) ORDER BY is_direct DESC, role_name;
```

```text
role_id |    role_name    | is_direct 
---------+-----------------+-----------
      10 | DevOps Engineer | t
       1 | Employee        | t
       8 | Developer       | f
       9 | Release Manager | f
(4 rows)
```


## 2. The recursive CTE itself: all ancestors of one role

This is the core of the multi-parent (DAG) model. `UNION` (not `UNION ALL`) de-duplicates roles reachable by more than one path.

```sql
WITH RECURSIVE ancestors AS (
    SELECT parent_role_id AS role_id, 1 AS depth
    FROM role_hierarchy
    WHERE child_role_id = (SELECT role_id FROM roles WHERE role_name = 'DevOps Engineer')
  UNION
    SELECT rh.parent_role_id, a.depth + 1
    FROM ancestors a JOIN role_hierarchy rh ON rh.child_role_id = a.role_id
)
SELECT r.role_name, MIN(a.depth) AS depth
FROM ancestors a JOIN roles r USING (role_id)
GROUP BY r.role_name ORDER BY depth, r.role_name;
```

```text
role_name    | depth 
-----------------+-------
 Developer       |     1
 Release Manager |     1
 Employee        |     2
(3 rows)
```


## 3. Effective permissions, tagged with the role that supplies each one

Tom Baxter's *Finance Generalist* role owns no permissions at all — everything arrives through inheritance. Note that the two halves of a classic fraud pair come from two *different* parent roles.

```sql
SELECT action, resource_type, risk_level, via_role_name, via_role_direct FROM fn_effective_permissions((SELECT employee_id FROM employees WHERE email='tom.baxter@eapis-corp.example')) ORDER BY resource_type, action;
```

```text
action  |   resource_type   | risk_level |  via_role_name   | via_role_direct 
---------+-------------------+------------+------------------+-----------------
 read    | company_directory | low        | Employee         | t
 approve | payment           | critical   | Payment Approver | f
 create  | payment           | critical   | Payment Clerk    | f
(3 rows)
```


## 4. The database refuses a cycle in the role DAG

The attempted edge would make *Employee* inherit from *DevOps Engineer*, which already (transitively) inherits from *Employee*. The trigger `trg_prevent_role_hierarchy_cycle` rejects it.

```sql
BEGIN;
INSERT INTO role_hierarchy (child_role_id, parent_role_id)
VALUES ((SELECT role_id FROM roles WHERE role_name='Employee'), (SELECT role_id FROM roles WHERE role_name='DevOps Engineer'));
ROLLBACK;
```

```text
ERROR:  role_hierarchy cycle rejected: role 1 is already an ancestor of role 10, so adding edge (child=1, parent=10) would create a cycle in the DAG
CONTEXT:  PL/pgSQL function fn_prevent_role_hierarchy_cycle() line 18 at RAISE
```


## 5. SoD conflicts: direct vs. indirect

`sod_violation` = one role grants both sides. `privilege_escalation` = the conflict only exists because of the combination of (inherited) roles.

```sql
SELECT full_name, conflict_kind, permission_a, permission_b, roles_granting_a, roles_granting_b, severity FROM v_sod_violations ORDER BY severity_rank, full_name;
```

```text
full_name   |               conflict_kind               |    permission_a     |     permission_b      | roles_granting_a | roles_granting_b | severity 
--------------+-------------------------------------------+---------------------+-----------------------+------------------+------------------+----------
 Derek Hughes | Indirect (combination of inherited roles) | create user_account | grant admin_rights    | IT Support       | Security Admin   | critical
 Grace Kim    | Direct (one role grants both)             | create payment      | approve payment       | Payments Admin   | Payments Admin   | critical
 Kevin Wright | Direct (one role grants both)             | create payment      | approve payment       | Payments Admin   | Payments Admin   | critical
 Tom Baxter   | Indirect (combination of inherited roles) | create payment      | approve payment       | Payment Clerk    | Payment Approver | critical
 Sam O'Brien  | Indirect (combination of inherited roles) | write source_code   | deploy production_env | Developer        | Release Manager  | high
(5 rows)
```


## 6. Unused access (direct and inherited)

Wei Zhang holds *Senior Developer*, which owns no permissions but inherits `write source_code` from *Developer*. He never writes code, so the detector flags it by walking the DAG.

```sql
SELECT full_name, action || ' ' || resource_type AS permission, role_name AS granted_via, inherited, held_role_name, severity FROM v_unused_access WHERE inherited OR full_name = 'Angela White' ORDER BY inherited DESC, full_name;
```

```text
full_name   |       permission       |  granted_via  | inherited |  held_role_name  | severity 
--------------+------------------------+---------------+-----------+------------------+----------
 Wei Zhang    | write source_code      | Developer     | t         | Senior Developer | medium
 Angela White | read company_directory | Employee      | f         |                  | low
 Angela White | read payroll_data      | HR Generalist | f         |                  | high
(3 rows)
```


## 7. Anomalous access findings by pattern

All six patterns from the specification produce findings on the seeded data.

```sql
SELECT related_entity->>'pattern' AS pattern, severity, COUNT(*) FROM findings WHERE finding_type='anomalous_access' GROUP BY 1,2 ORDER BY 3 DESC, 1;
```

```text
pattern            | severity | count 
------------------------------+----------+-------
 access_outside_granted_scope | high     |     2
 cross_department_access      | medium   |     2
 new_ip_address               | medium   |     2
 odd_hour_access              | medium   |     2
 failed_then_success          | critical |     1
 volume_spike                 | high     |     1
(6 rows)
```


## 8. Risk-scored employees (feeds "Top Risky Employees")

```sql
SELECT full_name, department, risk_score, risk_band, sod_violations, privilege_escalations, unused_permissions, anomalous_events FROM v_report_risk_scored_employees LIMIT 6;
```

```text
full_name   | department  | risk_score | risk_band | sod_violations | privilege_escalations | unused_permissions | anomalous_events 
---------------+-------------+------------+-----------+----------------+-----------------------+--------------------+------------------
 Derek Hughes  | IT          |        145 | Critical  |              0 |                     1 |                  1 |                4
 Kevin Wright  | Sales       |        100 | Critical  |              1 |                     0 |                  2 |                3
 Tom Baxter    | Finance     |         63 | High      |              0 |                     1 |                  1 |                0
 Grace Kim     | Finance     |         53 | High      |              1 |                     0 |                  1 |                0
 Sam O'Brien   | Engineering |         48 | Medium    |              0 |                     1 |                  1 |                0
 Olivia Brooks | Sales       |         40 | Medium    |              0 |                     0 |                  1 |                2
(6 rows)
```


## 9. Break-glass access is flagged the instant it is granted

Inserting a break-glass grant fires `trg_flag_break_glass_grant`; no waiting for the nightly job. (Rolled back — the demo leaves no data behind.) Without a justification the `CHECK` constraint refuses the row.

```sql
BEGIN;
INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, expires_at, is_temporary)
VALUES ((SELECT employee_id FROM employees WHERE email='ben.foster@eapis-corp.example'),
        (SELECT role_id FROM roles WHERE role_name='Payments Admin'),
        'break_glass', NULL, now() + interval '4 hours', TRUE);
ROLLBACK;
BEGIN;
INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, expires_at, is_temporary, justification)
VALUES ((SELECT employee_id FROM employees WHERE email='ben.foster@eapis-corp.example'),
        (SELECT role_id FROM roles WHERE role_name='Payments Admin'),
        'break_glass', NULL, now() + interval '4 hours', TRUE, 'Month-end payment run is stuck; CFO approved verbally');
SELECT finding_type, severity, related_entity->>'pattern' AS pattern, related_entity->>'justification' AS justification
FROM findings ORDER BY finding_id DESC LIMIT 1;
ROLLBACK;
```

```text
finding_type   | severity |      pattern      |                     justification                     
------------------+----------+-------------------+-------------------------------------------------------
 anomalous_access | high     | break_glass_grant | Month-end payment run is stuck; CFO approved verbally
(1 row)

ERROR:  new row for relation "employee_roles" violates check constraint "employee_roles_check1"
DETAIL:  Failing row contains (67, 10, 5, break_glass, null, 2026-10-04 12:49:37.54498, 2026-10-04 16:49:37.54498, t, null, null, active, null, null).
```


## 10. Automatic expiry of temporary access (and its audit trail)

A temporary grant whose `expires_at` has passed is still `active` until the job runs. `sp_expire_stale_grants()` (scheduled every 15 minutes by pg_cron) flips it to `expired`, and the audit trigger records the change with no extra code. (Rolled back.)

```sql
BEGIN;
INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, granted_at, expires_at, is_temporary)
VALUES ((SELECT employee_id FROM employees WHERE email='ben.foster@eapis-corp.example'),
        (SELECT role_id FROM roles WHERE role_name='Finance Manager'),
        'temporary', NULL, now() - interval '3 days', now() - interval '1 day', TRUE);
SELECT grant_id, status, expires_at::date AS expired_on FROM employee_roles WHERE status='active' AND expires_at <= now();
CALL sp_expire_stale_grants();
SELECT grant_id, status FROM employee_roles WHERE grant_type='temporary' AND expires_at::date = (now() - interval '1 day')::date;
SELECT target_type, change_type, old_value->>'status' AS old_status, new_value->>'status' AS new_status
FROM audit_logs WHERE target_type='employee_role' AND new_value->>'status'='expired' ORDER BY audit_id DESC LIMIT 1;
ROLLBACK;
```

```text
grant_id | status | expired_on 
----------+--------+------------
       69 | active | 2026-10-03
(1 row)

 grant_id | status  
----------+---------
       69 | expired
(1 row)

  target_type  | change_type | old_status | new_status 
---------------+-------------+------------+------------
 employee_role | update      | active     | expired
(1 row)

NOTICE:  sp_expire_stale_grants: auto-expired 1 grant(s)
```


## 11. Detectors are idempotent

Running them again creates no duplicates.

```sql
SELECT COUNT(*) AS findings_before FROM findings;
CALL sp_run_all_detectors();
SELECT COUNT(*) AS findings_after FROM findings;
```

```text
findings_before 
-----------------
              49
(1 row)

 findings_after 
----------------
             49
(1 row)
```


## 12. Dashboard summary — one JSON document computed entirely in PostgreSQL

```sql
SELECT jsonb_pretty(fn_dashboard_summary() - 'activity_trend' - 'top_risky_employees');
```

```text
jsonb_pretty            
-----------------------------------
 {                                +
     "total_roles": 17,           +
     "open_findings": 49,         +
     "sod_violations": 5,         +
     "total_employees": 22,       +
     "findings_by_type": {        +
         "sod_violation": 2,      +
         "unused_access": 34,     +
         "anomalous_access": 10,  +
         "privilege_escalation": 3+
     },                           +
     "critical_findings": 5,      +
     "risk_distribution": {       +
         "low": 29,               +
         "high": 5,               +
         "medium": 10,            +
         "critical": 5            +
     },                           +
     "total_permissions": 16,     +
     "unused_permissions": 34,    +
     "active_temporary_access": 1,+
     "pending_access_requests": 1 +
 }
(1 row)
```


## 13. Certification campaign status

```sql
SELECT name, status, total_items, pending_items, percent_complete, overdue FROM v_report_campaign_status;
```

```text
name              |   status    | total_items | pending_items | percent_complete | overdue 
--------------------------------+-------------+-------------+---------------+------------------+---------
 Q3 2026 Access Recertification | in_progress |           3 |             3 |              0.0 | f
(1 row)
```
