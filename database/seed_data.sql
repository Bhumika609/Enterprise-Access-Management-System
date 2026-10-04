-- ============================================================================
-- EAPIS — PHASE 2: SEED DATA
-- Requires schema.sql (Phase 1) to already be applied.
--
-- This dataset is built to give Phase 4's detection engine real cases to
-- catch. It deliberately plants, and documents inline, one example of each:
--   (A) a DIRECT SoD violation   -> Grace Kim / "Payments Admin"
--   (B) THREE INDIRECT SoD / privilege-escalation cases, each only visible
--       by walking the role_hierarchy DAG:
--         -> Tom Baxter   / "Finance Generalist" (Payment Clerk + Payment Approver)
--         -> Sam O'Brien  / "DevOps Engineer"    (Developer + Release Manager)
--         -> Derek Hughes / "IT Superuser"       (IT Support + Security Admin)
--   (C) an UNUSED-ACCESS case -> Angela White holds read/payroll_data but
--       never touches the Payroll System in access_logs
--   (D) four ANOMALOUS-ACCESS patterns -> volume spike, odd-hour + new IP,
--       cross-department access, and failed-then-success (brute force)
--   (E) lifecycle features -> one active BREAK-GLASS grant (Kevin Wright)
--       and one already-EXPIRED temporary grant, for the auto-revoke job
--
-- Every FK below is resolved by natural key (email / role_name / action+
-- resource_type / resource_name) via subqueries rather than hardcoded
-- SERIAL ids, so this script is safe to re-run against a freshly created
-- database regardless of insertion order details.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EMPLOYEES (22) — inserted top-down so manager_id subqueries always resolve
-- ----------------------------------------------------------------------------

-- Level 0: CEO
INSERT INTO employees (full_name, email, department, manager_id, status, hire_date) VALUES
('Elena Martinez', 'elena.martinez@eapis-corp.example', 'Executive', NULL, 'active', '2018-01-15');

-- Level 1: VPs + Compliance (all report to CEO)
INSERT INTO employees (full_name, email, department, manager_id, status, hire_date)
SELECT v.name, v.email, v.dept, (SELECT employee_id FROM employees WHERE email = 'elena.martinez@eapis-corp.example'), 'active', v.hired::date
FROM (VALUES
    ('David Chen',       'david.chen@eapis-corp.example',       'Finance',     '2018-03-01'),
    ('Raj Patel',        'raj.patel@eapis-corp.example',        'Engineering', '2018-02-10'),
    ('Laura Simmons',    'laura.simmons@eapis-corp.example',    'IT',          '2018-04-20'),
    ('Monica Lee',       'monica.lee@eapis-corp.example',       'HR',          '2019-01-05'),
    ('James Carter',     'james.carter@eapis-corp.example',     'Sales',       '2018-06-15'),
    ('Fatima Al-Sayed',  'fatima.alsayed@eapis-corp.example',   'Compliance',  '2019-08-01')
) AS v(name, email, dept, hired);

-- Level 2: mid-level managers
INSERT INTO employees (full_name, email, department, manager_id, status, hire_date)
SELECT m.name, m.email, m.dept, (SELECT employee_id FROM employees WHERE email = m.manager_email), 'active', m.hired::date
FROM (VALUES
    ('Priya Nair',   'priya.nair@eapis-corp.example',   'Finance',     'david.chen@eapis-corp.example',    '2019-02-01'),
    ('Wei Zhang',    'wei.zhang@eapis-corp.example',    'Engineering', 'raj.patel@eapis-corp.example',     '2019-03-10'),
    ('Ben Foster',   'ben.foster@eapis-corp.example',   'IT',          'laura.simmons@eapis-corp.example', '2019-05-01'),
    ('Carla Diaz',   'carla.diaz@eapis-corp.example',   'IT',          'laura.simmons@eapis-corp.example', '2019-06-01'),
    ('Derek Hughes', 'derek.hughes@eapis-corp.example', 'IT',          'laura.simmons@eapis-corp.example', '2020-01-15'),
    ('Angela White', 'angela.white@eapis-corp.example', 'HR',          'monica.lee@eapis-corp.example',    '2020-02-01')
) AS m(name, email, dept, manager_email, hired);

-- Level 3: individual contributors
INSERT INTO employees (full_name, email, department, manager_id, status, hire_date)
SELECT i.name, i.email, i.dept, (SELECT employee_id FROM employees WHERE email = i.manager_email), 'active', i.hired::date
FROM (VALUES
    ('Marcus Webb',    'marcus.webb@eapis-corp.example',    'Finance',     'priya.nair@eapis-corp.example', '2021-01-10'),
    ('Sofia Rossi',    'sofia.rossi@eapis-corp.example',    'Finance',     'priya.nair@eapis-corp.example', '2021-02-15'),
    ('Grace Kim',      'grace.kim@eapis-corp.example',      'Finance',     'priya.nair@eapis-corp.example', '2020-11-01'),
    ('Tom Baxter',     'tom.baxter@eapis-corp.example',     'Finance',     'priya.nair@eapis-corp.example', '2021-04-01'),
    ('Alex Johnson',   'alex.johnson@eapis-corp.example',   'Engineering', 'wei.zhang@eapis-corp.example',  '2020-09-01'),
    ('Nina Petrova',   'nina.petrova@eapis-corp.example',   'Engineering', 'wei.zhang@eapis-corp.example',  '2020-10-15'),
    ('Sam O''Brien',   'sam.obrien@eapis-corp.example',     'Engineering', 'wei.zhang@eapis-corp.example',  '2021-03-01'),
    ('Olivia Brooks',  'olivia.brooks@eapis-corp.example',  'Sales',       'james.carter@eapis-corp.example', '2021-05-01'),
    ('Kevin Wright',   'kevin.wright@eapis-corp.example',   'Sales',       'james.carter@eapis-corp.example', '2022-01-10')
) AS i(name, email, dept, manager_email, hired);

-- ----------------------------------------------------------------------------
-- APP_USERS — dashboard login accounts (separate from RBAC roles)
-- Demo password hashes are placeholders only — Phase 6a wires real hashing.
-- ----------------------------------------------------------------------------
INSERT INTO app_users (employee_id, username, password_hash, system_role)
SELECT employee_id, u.username, u.pwhash, u.sysrole
FROM employees e
JOIN (VALUES
    ('laura.simmons@eapis-corp.example',  'lsimmons', 'PLACEHOLDER_HASH_1', 'admin'),
    ('fatima.alsayed@eapis-corp.example', 'falsayed', 'PLACEHOLDER_HASH_2', 'auditor'),
    ('priya.nair@eapis-corp.example',     'pnair',    'PLACEHOLDER_HASH_3', 'manager'),
    ('david.chen@eapis-corp.example',     'dchen',    'PLACEHOLDER_HASH_4', 'viewer')
) AS u(email, username, pwhash, sysrole) ON e.email = u.email;

-- ----------------------------------------------------------------------------
-- ROLES (14)
-- ----------------------------------------------------------------------------
INSERT INTO roles (role_name, description) VALUES
('Employee',          'Base role held by every employee; grants only baseline directory read access'),
('Department Head',   'VP-level role for department leadership; can approve leave requests'),
('Payment Clerk',     'Can create payment records'),
('Payment Approver',  'Can approve payment records'),
('Payments Admin',    'Full payments administration — INTENTIONALLY grants both create and approve payment directly'),
('Finance Generalist','Cross-trained finance role; inherits from both Payment Clerk and Payment Approver'),
('Finance Manager',   'Finance department management: reporting and leave approval'),
('Developer',         'Can write source code'),
('Release Manager',   'Can deploy to production'),
('DevOps Engineer',   'Combined dev+ops role; inherits from both Developer and Release Manager'),
('IT Support',        'Can create user accounts'),
('Security Admin',    'Can grant admin rights'),
('IT Superuser',      'Combined IT role; inherits from both IT Support and Security Admin'),
('HR Generalist',     'HR record-keeping and payroll visibility'),
('Sales Rep',         'Customer-facing sales role'),
('Auditor',           'Read-only visibility into audit and access logs for compliance review');

-- ----------------------------------------------------------------------------
-- PERMISSIONS (16)
-- ----------------------------------------------------------------------------
INSERT INTO permissions (action, resource_type, risk_level, expected_frequency, description) VALUES
('read',    'company_directory', 'low',      'regular',    'View internal employee directory'),
('create',  'payment',           'critical', 'regular',    'Create a new payment record'),
('approve', 'payment',           'critical', 'regular',    'Approve a payment for disbursement'),
('create',  'user_account',      'high',     'occasional', 'Provision a new user account'),
('grant',   'admin_rights',      'critical', 'rare',       'Elevate a user to admin privileges'),
('write',   'source_code',       'medium',   'regular',    'Commit changes to source code'),
('deploy',  'production_env',    'critical', 'occasional', 'Deploy a build to production'),
('read',    'employee_records',  'low',      'regular',    'View employee HR records'),
('read',    'payroll_data',      'high',     'occasional', 'View payroll figures'),
('read',    'customer_data',     'low',      'regular',    'View CRM customer records'),
('create',  'quote',             'low',      'regular',    'Create a sales quote'),
('approve', 'leave_request',     'low',      'regular',    'Approve employee leave requests'),
('read',    'audit_logs',        'medium',   'occasional', 'View system audit trail'),
('read',    'access_logs',       'medium',   'occasional', 'View resource access logs'),
('read',    'financial_reports', 'medium',   'occasional', 'View finance department reports'),
('export',  'financial_reports', 'high',     'rare',       'Export financial reports externally');

-- ----------------------------------------------------------------------------
-- ROLE_PERMISSIONS — direct grants only; Finance Generalist, DevOps Engineer
-- and IT Superuser deliberately get NOTHING here — their risk only exists
-- through role_hierarchy inheritance (see below).
-- ----------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p WHERE
    (r.role_name = 'Employee'          AND p.action='read'    AND p.resource_type='company_directory') OR
    (r.role_name = 'Department Head'   AND p.action='approve' AND p.resource_type='leave_request') OR
    (r.role_name = 'Payment Clerk'     AND p.action='create'  AND p.resource_type='payment') OR
    (r.role_name = 'Payment Approver'  AND p.action='approve' AND p.resource_type='payment') OR
    (r.role_name = 'Payments Admin'    AND p.action='create'  AND p.resource_type='payment') OR
    (r.role_name = 'Payments Admin'    AND p.action='approve' AND p.resource_type='payment') OR
    (r.role_name = 'Finance Manager'   AND p.action='read'    AND p.resource_type='financial_reports') OR
    (r.role_name = 'Finance Manager'   AND p.action='export'  AND p.resource_type='financial_reports') OR
    (r.role_name = 'Finance Manager'   AND p.action='approve' AND p.resource_type='leave_request') OR
    (r.role_name = 'Developer'         AND p.action='write'   AND p.resource_type='source_code') OR
    (r.role_name = 'Release Manager'   AND p.action='deploy'  AND p.resource_type='production_env') OR
    (r.role_name = 'IT Support'        AND p.action='create'  AND p.resource_type='user_account') OR
    (r.role_name = 'Security Admin'    AND p.action='grant'   AND p.resource_type='admin_rights') OR
    (r.role_name = 'HR Generalist'     AND p.action='read'    AND p.resource_type='employee_records') OR
    (r.role_name = 'HR Generalist'     AND p.action='read'    AND p.resource_type='payroll_data') OR
    (r.role_name = 'Sales Rep'         AND p.action='read'    AND p.resource_type='customer_data') OR
    (r.role_name = 'Sales Rep'         AND p.action='create'  AND p.resource_type='quote') OR
    (r.role_name = 'Auditor'           AND p.action='read'    AND p.resource_type='audit_logs') OR
    (r.role_name = 'Auditor'           AND p.action='read'    AND p.resource_type='access_logs');

-- ----------------------------------------------------------------------------
-- ROLE_HIERARCHY (DAG) — the three multi-parent roles are the indirect-SoD
-- / privilege-escalation demonstration cases.
-- ----------------------------------------------------------------------------
INSERT INTO role_hierarchy (child_role_id, parent_role_id)
SELECT c.role_id, p.role_id FROM roles c, roles p WHERE
    (c.role_name='Payment Clerk'      AND p.role_name='Employee') OR
    (c.role_name='Payment Approver'   AND p.role_name='Employee') OR
    (c.role_name='Payments Admin'     AND p.role_name='Employee') OR
    (c.role_name='Finance Manager'    AND p.role_name='Employee') OR
    (c.role_name='Developer'          AND p.role_name='Employee') OR
    (c.role_name='Release Manager'    AND p.role_name='Employee') OR
    (c.role_name='IT Support'         AND p.role_name='Employee') OR
    (c.role_name='Security Admin'     AND p.role_name='Employee') OR
    (c.role_name='HR Generalist'      AND p.role_name='Employee') OR
    (c.role_name='Sales Rep'          AND p.role_name='Employee') OR
    (c.role_name='Auditor'            AND p.role_name='Employee') OR
    -- indirect SoD case 1: Finance Generalist inherits from BOTH sides of the payment conflict
    (c.role_name='Finance Generalist' AND p.role_name='Payment Clerk') OR
    (c.role_name='Finance Generalist' AND p.role_name='Payment Approver') OR
    -- indirect SoD case 2: DevOps Engineer inherits from BOTH sides of the code/deploy conflict
    (c.role_name='DevOps Engineer'    AND p.role_name='Developer') OR
    (c.role_name='DevOps Engineer'    AND p.role_name='Release Manager') OR
    -- indirect SoD case 3: IT Superuser inherits from BOTH sides of the provisioning conflict
    (c.role_name='IT Superuser'       AND p.role_name='IT Support') OR
    (c.role_name='IT Superuser'       AND p.role_name='Security Admin');

-- ----------------------------------------------------------------------------
-- SOD_CONFLICT_RULES — the configurable rule set. LEAST/GREATEST enforces
-- the schema's permission_a_id < permission_b_id canonical-ordering CHECK
-- regardless of the ids' actual insertion order.
-- ----------------------------------------------------------------------------
INSERT INTO sod_conflict_rules (permission_a_id, permission_b_id, severity, description)
SELECT LEAST(pa.permission_id, pb.permission_id), GREATEST(pa.permission_id, pb.permission_id),
       'critical', 'An employee must never be able to both create and approve the same payment'
FROM permissions pa, permissions pb
WHERE pa.action='create' AND pa.resource_type='payment' AND pb.action='approve' AND pb.resource_type='payment';

INSERT INTO sod_conflict_rules (permission_a_id, permission_b_id, severity, description)
SELECT LEAST(pa.permission_id, pb.permission_id), GREATEST(pa.permission_id, pb.permission_id),
       'critical', 'An employee must never be able to both create a user account and grant admin rights'
FROM permissions pa, permissions pb
WHERE pa.action='create' AND pa.resource_type='user_account' AND pb.action='grant' AND pb.resource_type='admin_rights';

INSERT INTO sod_conflict_rules (permission_a_id, permission_b_id, severity, description)
SELECT LEAST(pa.permission_id, pb.permission_id), GREATEST(pa.permission_id, pb.permission_id),
       'high', 'An employee must never be able to both write code and deploy it to production unreviewed'
FROM permissions pa, permissions pb
WHERE pa.action='write' AND pa.resource_type='source_code' AND pb.action='deploy' AND pb.resource_type='production_env';

-- ----------------------------------------------------------------------------
-- RESOURCES (9) — resource_type is deliberately the SAME vocabulary as
-- permissions.resource_type (not a separate "system category" like
-- 'application'/'database'). The detection engine in Phase 4 joins
-- access_logs -> resources -> permissions on (resource_type, action) to
-- decide whether a granted permission was actually exercised, so the two
-- columns must speak the same language. Admin Console was originally a
-- single resource hosting BOTH user-provisioning and admin-rights actions;
-- it's split into two resources here so each maps cleanly to one permission
-- domain.
-- ----------------------------------------------------------------------------
INSERT INTO resources (resource_name, resource_type, owner_id)
SELECT r.name, r.rtype, (SELECT employee_id FROM employees WHERE email = r.owner_email)
FROM (VALUES
    ('Payment Gateway System',     'payment',            'priya.nair@eapis-corp.example'),
    ('Payroll System',             'payroll_data',       'priya.nair@eapis-corp.example'),
    ('Financial Reports Portal',   'financial_reports',  'priya.nair@eapis-corp.example'),
    ('Employee Database',          'employee_records',   'monica.lee@eapis-corp.example'),
    ('Customer CRM',               'customer_data',      'james.carter@eapis-corp.example'),
    ('Source Code Repository',     'source_code',        'wei.zhang@eapis-corp.example'),
    ('Production Server Cluster',  'production_env',     'wei.zhang@eapis-corp.example'),
    ('User Provisioning Console',  'user_account',       'laura.simmons@eapis-corp.example'),
    ('Privileged Access Manager',  'admin_rights',       'laura.simmons@eapis-corp.example'),
    ('Sales Quote System',         'quote',              'james.carter@eapis-corp.example')
) AS r(name, rtype, owner_email);

-- ----------------------------------------------------------------------------
-- EMPLOYEE_ROLES — baseline grants for everyone, plus lifecycle examples
-- ----------------------------------------------------------------------------

-- Every employee gets the base 'Employee' role at hire time
INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, granted_at, is_temporary, status)
SELECT employee_id, (SELECT role_id FROM roles WHERE role_name='Employee'),
       'direct', NULL, hire_date::timestamp, FALSE, 'active'
FROM employees;

-- Department Heads (the 5 VPs)
INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, granted_at, is_temporary, status)
SELECT e.employee_id, (SELECT role_id FROM roles WHERE role_name='Department Head'),
       'direct', (SELECT employee_id FROM employees WHERE email='elena.martinez@eapis-corp.example'),
       e.hire_date::timestamp + interval '1 day', FALSE, 'active'
FROM employees e
WHERE e.email IN ('david.chen@eapis-corp.example','raj.patel@eapis-corp.example',
                   'laura.simmons@eapis-corp.example','monica.lee@eapis-corp.example',
                   'james.carter@eapis-corp.example');

-- The rest of the department-specific grants, one row per (employee, role)
INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, granted_at, is_temporary, status)
SELECT (SELECT employee_id FROM employees WHERE email = g.emp_email),
       (SELECT role_id FROM roles WHERE role_name = g.role_name),
       'direct',
       (SELECT employee_id FROM employees WHERE email = g.granter_email),
       now() - (g.days_ago || ' days')::interval, FALSE, 'active'
FROM (VALUES
    ('priya.nair@eapis-corp.example',     'Finance Manager',     'david.chen@eapis-corp.example',      600),
    ('marcus.webb@eapis-corp.example',    'Payment Clerk',       'priya.nair@eapis-corp.example',      500),
    ('sofia.rossi@eapis-corp.example',    'Payment Approver',    'priya.nair@eapis-corp.example',      480),
    ('grace.kim@eapis-corp.example',      'Payments Admin',      'priya.nair@eapis-corp.example',      620),  -- DIRECT SoD
    ('tom.baxter@eapis-corp.example',     'Finance Generalist',  'priya.nair@eapis-corp.example',      400),  -- INDIRECT SoD
    ('alex.johnson@eapis-corp.example',   'Developer',           'wei.zhang@eapis-corp.example',       550),
    ('nina.petrova@eapis-corp.example',   'Release Manager',     'wei.zhang@eapis-corp.example',       540),
    ('sam.obrien@eapis-corp.example',     'DevOps Engineer',     'wei.zhang@eapis-corp.example',       380),  -- INDIRECT SoD
    ('ben.foster@eapis-corp.example',     'IT Support',          'laura.simmons@eapis-corp.example',   500),
    ('carla.diaz@eapis-corp.example',     'Security Admin',      'laura.simmons@eapis-corp.example',   480),
    ('derek.hughes@eapis-corp.example',   'IT Superuser',        'laura.simmons@eapis-corp.example',   300),  -- INDIRECT SoD
    ('angela.white@eapis-corp.example',   'HR Generalist',       'monica.lee@eapis-corp.example',      450),  -- unused-access case
    ('olivia.brooks@eapis-corp.example',  'Sales Rep',           'james.carter@eapis-corp.example',    420),
    ('kevin.wright@eapis-corp.example',   'Sales Rep',           'james.carter@eapis-corp.example',    300)
) AS g(emp_email, role_name, granter_email, days_ago);

-- Fatima Al-Sayed -> Auditor role
INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, granted_at, is_temporary, status)
SELECT (SELECT employee_id FROM employees WHERE email='fatima.alsayed@eapis-corp.example'),
       (SELECT role_id FROM roles WHERE role_name='Auditor' LIMIT 1),
       'direct', (SELECT employee_id FROM employees WHERE email='elena.martinez@eapis-corp.example'),
       now() - interval '700 days', FALSE, 'active'
WHERE EXISTS (SELECT 1 FROM roles WHERE role_name = 'Auditor');

-- LIFECYCLE CASE 1: active BREAK-GLASS grant — Kevin Wright temporarily
-- elevated into Payments Admin during a payment-approval backlog.
INSERT INTO employee_roles
    (employee_id, role_id, grant_type, granted_by, granted_at, expires_at, is_temporary, justification, status)
SELECT (SELECT employee_id FROM employees WHERE email='kevin.wright@eapis-corp.example'),
       (SELECT role_id FROM roles WHERE role_name='Payments Admin'),
       'break_glass',
       (SELECT employee_id FROM employees WHERE email='james.carter@eapis-corp.example'),
       now() - interval '6 hours', now() + interval '42 hours', TRUE,
       'Quarter-end payment approval backlog; primary approver on leave. Emergency access requested by VP Sales.',
       'active';

-- LIFECYCLE CASE 2: already-EXPIRED temporary grant — demonstrates the
-- Phase 5 auto-revoke job has real rows to act on.
INSERT INTO employee_roles
    (employee_id, role_id, grant_type, granted_by, granted_at, expires_at, is_temporary, status)
SELECT (SELECT employee_id FROM employees WHERE email='kevin.wright@eapis-corp.example'),
       (SELECT role_id FROM roles WHERE role_name='Developer'),
       'temporary',
       (SELECT employee_id FROM employees WHERE email='wei.zhang@eapis-corp.example'),
       now() - interval '60 days', now() - interval '30 days', TRUE, 'expired';

-- ----------------------------------------------------------------------------
-- ACCESS_LOGS — usage trail. Baseline volume + planted anomalies/unused case.
--
-- IMPORTANT: every timestamp below is anchored with
--   date_trunc('day', now() - N days) + H hours [+ M minutes]
-- rather than raw "now() - N days - H hours" subtraction. The raw-subtraction
-- form silently inherits whatever time-of-day the script happens to be run
-- at (now()'s own HH:MM:SS), so an "H hours before now" offset does NOT
-- reliably land at a fixed hour-of-day — it drifts with real wall-clock time
-- and can accidentally fall into the 00:00–05:00 "odd hour" window the
-- anomaly detector watches for. date_trunc() zeroes the time-of-day to
-- midnight first, so every baseline row lands at its intended hour
-- regardless of when this script is actually executed.
-- ----------------------------------------------------------------------------

-- Marcus Webb: baseline ~1 payment/day for 30 days, always mid-morning to
-- early afternoon (9am-2pm) — normal business-hours pattern
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='marcus.webb@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Payment Gateway System'),
       'create',
       date_trunc('day', now() - (gs || ' days')::interval) + ((9 + (gs % 6)) || ' hours')::interval,
       TRUE, '10.20.30.15'::inet
FROM generate_series(1, 30) AS gs;

-- ANOMALY (volume spike): Marcus creates 45 payments in a single day, 5 days
-- ago, all within business hours (10am-11am that day) — still an obvious
-- spike vs. his own ~1/day baseline, without also tripping odd-hour rules
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='marcus.webb@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Payment Gateway System'),
       'create',
       date_trunc('day', now() - interval '5 days') + interval '10 hours' + (gs || ' minutes')::interval,
       TRUE, '10.20.30.15'::inet
FROM generate_series(1, 45) AS gs;

-- Sofia Rossi: baseline payment approvals, business hours (10am-3pm)
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='sofia.rossi@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Payment Gateway System'),
       'approve',
       date_trunc('day', now() - (gs || ' days')::interval) + ((10 + (gs % 5)) || ' hours')::interval,
       TRUE, '10.20.30.16'::inet
FROM generate_series(1, 25) AS gs;

-- Grace Kim (DIRECT SoD holder): actually uses BOTH sides of the conflict,
-- business hours (11am-1pm)
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='grace.kim@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Payment Gateway System'),
       CASE WHEN gs % 2 = 0 THEN 'create' ELSE 'approve' END,
       date_trunc('day', now() - (gs * 4 || ' days')::interval) + ((11 + (gs % 3)) || ' hours')::interval,
       TRUE, '10.20.30.17'::inet
FROM generate_series(1, 10) AS gs;

-- Tom Baxter (INDIRECT SoD holder): actually uses BOTH inherited sides,
-- business hours (11am-1pm)
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='tom.baxter@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Payment Gateway System'),
       CASE WHEN gs % 2 = 0 THEN 'create' ELSE 'approve' END,
       date_trunc('day', now() - (gs * 5 || ' days')::interval) + ((11 + (gs % 3)) || ' hours')::interval,
       TRUE, '10.20.30.18'::inet
FROM generate_series(1, 12) AS gs;

-- Angela White: regular HR record reads, business hours (9am-11am) ...
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='angela.white@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Employee Database'),
       'read',
       date_trunc('day', now() - (gs * 4 || ' days')::interval) + ((9 + (gs % 3)) || ' hours')::interval,
       TRUE, '10.40.50.10'::inet
FROM generate_series(1, 20) AS gs;
-- ... but ZERO rows against Payroll System, despite holding read/payroll_data
-- for 450 days -> this IS the planted unused-access / entitlement-creep case.

-- Alex Johnson: heavy source-code activity, spread across a normal working
-- day (9am-5pm)
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='alex.johnson@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Source Code Repository'),
       'write',
       date_trunc('day', now() - (gs || ' days')::interval) + ((9 + (gs % 9)) || ' hours')::interval,
       TRUE, '10.60.70.20'::inet
FROM generate_series(1, 40) AS gs;

-- Nina Petrova: regular production deploys, always mid-afternoon (2pm)
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='nina.petrova@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Production Server Cluster'),
       'deploy',
       date_trunc('day', now() - (gs * 4 || ' days')::interval) + interval '14 hours',
       TRUE, '10.60.70.21'::inet
FROM generate_series(1, 15) AS gs;

-- Sam O'Brien (INDIRECT SoD holder): actually uses BOTH inherited sides,
-- business hours
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='sam.obrien@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Source Code Repository'),
       'write',
       date_trunc('day', now() - (gs * 7 || ' days')::interval) + interval '10 hours',
       TRUE, '10.60.70.22'::inet
FROM generate_series(1, 4) AS gs;
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='sam.obrien@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Production Server Cluster'),
       'deploy',
       date_trunc('day', now() - (gs * 7 || ' days')::interval) + interval '12 hours',
       TRUE, '10.60.70.22'::inet
FROM generate_series(1, 4) AS gs;

-- Ben Foster: routine user provisioning, business hours
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='ben.foster@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='User Provisioning Console'),
       'create',
       date_trunc('day', now() - (gs * 6 || ' days')::interval) + ((9 + (gs % 6)) || ' hours')::interval,
       TRUE, '10.80.90.30'::inet
FROM generate_series(1, 10) AS gs;

-- Carla Diaz: routine admin-rights grants, business hours
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='carla.diaz@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Privileged Access Manager'),
       'grant',
       date_trunc('day', now() - (gs * 12 || ' days')::interval) + interval '11 hours',
       TRUE, '10.80.90.31'::inet
FROM generate_series(1, 5) AS gs;

-- Derek Hughes (INDIRECT SoD holder): baseline usage of both inherited sides,
-- each action logged against the resource matching its own permission
-- domain, business hours
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='derek.hughes@eapis-corp.example'),
       CASE WHEN gs % 2 = 0 THEN (SELECT resource_id FROM resources WHERE resource_name='User Provisioning Console')
            ELSE (SELECT resource_id FROM resources WHERE resource_name='Privileged Access Manager') END,
       CASE WHEN gs % 2 = 0 THEN 'create' ELSE 'grant' END,
       date_trunc('day', now() - (gs * 10 || ' days')::interval) + interval '10 hours',
       TRUE, '10.80.90.32'::inet
FROM generate_series(1, 6) AS gs;

-- ANOMALY (failed-then-success / brute force): 3 failed attempts followed by
-- a success within 10 minutes, from an external/unrecognized IP. Anchored to
-- midnight + 2 days ago + a fixed hour so it's deterministic AND, since 2 AM
-- is itself inside the odd-hour window, this row realistically also reads as
-- an odd-hour anomaly — which is accurate: a brute-force attempt at 2 AM is
-- doubly suspicious, not a data bug.
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address) VALUES
((SELECT employee_id FROM employees WHERE email='derek.hughes@eapis-corp.example'),
 (SELECT resource_id FROM resources WHERE resource_name='User Provisioning Console'), 'login',
 date_trunc('day', now() - interval '2 days') + interval '2 hours' + interval '1 minute', FALSE, '203.0.113.55'::inet),
((SELECT employee_id FROM employees WHERE email='derek.hughes@eapis-corp.example'),
 (SELECT resource_id FROM resources WHERE resource_name='User Provisioning Console'), 'login',
 date_trunc('day', now() - interval '2 days') + interval '2 hours' + interval '3 minutes', FALSE, '203.0.113.55'::inet),
((SELECT employee_id FROM employees WHERE email='derek.hughes@eapis-corp.example'),
 (SELECT resource_id FROM resources WHERE resource_name='User Provisioning Console'), 'login',
 date_trunc('day', now() - interval '2 days') + interval '2 hours' + interval '6 minutes', FALSE, '203.0.113.55'::inet),
((SELECT employee_id FROM employees WHERE email='derek.hughes@eapis-corp.example'),
 (SELECT resource_id FROM resources WHERE resource_name='User Provisioning Console'), 'login',
 date_trunc('day', now() - interval '2 days') + interval '2 hours' + interval '10 minutes', TRUE, '203.0.113.55'::inet);

-- Olivia Brooks: normal sales activity, business hours. 'read' actions hit
-- Customer CRM (matches her read/customer_data permission); 'create' actions
-- hit Sales Quote System (matches her create/quote permission) — using the
-- same resource for both would misfire the Phase 4 "access outside granted
-- scope" detector, since her role does not include create/customer_data.
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='olivia.brooks@eapis-corp.example'),
       CASE WHEN gs % 3 = 0 THEN (SELECT resource_id FROM resources WHERE resource_name='Sales Quote System')
            ELSE (SELECT resource_id FROM resources WHERE resource_name='Customer CRM') END,
       CASE WHEN gs % 3 = 0 THEN 'create' ELSE 'read' END,
       date_trunc('day', now() - (gs * 2 || ' days')::interval) + ((9 + (gs % 8)) || ' hours')::interval,
       TRUE, '10.100.110.40'::inet
FROM generate_series(1, 25) AS gs;

-- ANOMALY (cross-department access): a Sales rep reading the Source Code
-- Repository — a resource entirely outside her role/department. Business
-- hours, since the anomaly here is WHAT she accessed, not when.
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address) VALUES
((SELECT employee_id FROM employees WHERE email='olivia.brooks@eapis-corp.example'),
 (SELECT resource_id FROM resources WHERE resource_name='Source Code Repository'), 'read',
 date_trunc('day', now() - interval '3 days') + interval '11 hours', TRUE, '10.100.110.40'::inet);

-- Kevin Wright: light normal sales activity, business hours
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address)
SELECT (SELECT employee_id FROM employees WHERE email='kevin.wright@eapis-corp.example'),
       (SELECT resource_id FROM resources WHERE resource_name='Customer CRM'),
       'read',
       date_trunc('day', now() - (gs * 6 || ' days')::interval) + ((9 + (gs % 6)) || ' hours')::interval,
       TRUE, '10.100.110.41'::inet
FROM generate_series(1, 5) AS gs;

-- ANOMALY (odd hour + new/foreign IP): Kevin uses his break-glass Payments
-- Admin grant to approve a payment at 2 AM from an unrecognized external IP.
INSERT INTO access_logs (employee_id, resource_id, action, occurred_at, success, ip_address) VALUES
((SELECT employee_id FROM employees WHERE email='kevin.wright@eapis-corp.example'),
 (SELECT resource_id FROM resources WHERE resource_name='Payment Gateway System'),
 'approve', date_trunc('day', now()) + interval '2 hours', TRUE, '198.51.100.77'::inet);

-- ----------------------------------------------------------------------------
-- ACCESS_REQUESTS — a few requests in different states
-- ----------------------------------------------------------------------------
INSERT INTO access_requests (requester_id, role_id, resource_id, is_temporary, is_break_glass, justification, requested_at, status, reviewed_by, reviewed_at, expires_at)
VALUES
-- the approved break-glass request that produced Kevin's employee_roles row above
((SELECT employee_id FROM employees WHERE email='kevin.wright@eapis-corp.example'),
 (SELECT role_id FROM roles WHERE role_name='Payments Admin'), NULL, TRUE, TRUE,
 'Quarter-end payment approval backlog; primary approver on leave. Emergency access requested by VP Sales.',
 now() - interval '6 hours', 'approved',
 (SELECT employee_id FROM employees WHERE email='james.carter@eapis-corp.example'),
 now() - interval '6 hours', now() + interval '42 hours'),
-- a pending request awaiting review
((SELECT employee_id FROM employees WHERE email='tom.baxter@eapis-corp.example'),
 (SELECT role_id FROM roles WHERE role_name='Finance Manager'), NULL, FALSE, FALSE,
 'Requesting reporting access to cover for Priya during upcoming leave.',
 now() - interval '2 days', 'pending', NULL, NULL, NULL),
-- a rejected out-of-scope request
((SELECT employee_id FROM employees WHERE email='olivia.brooks@eapis-corp.example'),
 (SELECT role_id FROM roles WHERE role_name='Developer'), NULL, FALSE, FALSE,
 'Would like repository access to understand product features better.',
 now() - interval '10 days', 'rejected',
 (SELECT employee_id FROM employees WHERE email='wei.zhang@eapis-corp.example'),
 now() - interval '9 days', NULL);

-- ----------------------------------------------------------------------------
-- RECERTIFICATION CAMPAIGN — one in-progress campaign with a few items
-- targeting the riskiest grants seeded above
-- ----------------------------------------------------------------------------
INSERT INTO recertification_campaigns (name, start_date, end_date, status) VALUES
('Q3 2026 Access Recertification', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '20 days', 'in_progress');

INSERT INTO recertification_items (campaign_id, employee_id, grant_id, reviewer_id, decision)
SELECT (SELECT campaign_id FROM recertification_campaigns WHERE name='Q3 2026 Access Recertification'),
       er.employee_id, er.grant_id,
       (SELECT employee_id FROM employees WHERE email='priya.nair@eapis-corp.example'),
       'pending'
FROM employee_roles er
JOIN employees e ON e.employee_id = er.employee_id
JOIN roles r ON r.role_id = er.role_id
WHERE (e.email = 'grace.kim@eapis-corp.example'   AND r.role_name = 'Payments Admin')
   OR (e.email = 'tom.baxter@eapis-corp.example'  AND r.role_name = 'Finance Generalist')
   OR (e.email = 'angela.white@eapis-corp.example' AND r.role_name = 'HR Generalist');

-- ============================================================================
-- END OF PHASE 2 SEED DATA
-- audit_logs and findings are intentionally left EMPTY here: audit_logs will
-- be populated automatically by Phase 3 triggers on future role/permission
-- changes, and findings will be populated by the Phase 4 detection engine
-- running against exactly the data planted above.
-- ============================================================================
-- ----------------------------------------------------------------------------
-- (F) INHERITED UNUSED-ACCESS CASE
-- "Senior Developer" has NO permissions of its own; it only inherits from
-- Developer. Wei Zhang was given it 150 days ago but never writes source code,
-- so the unused-access detector must find the problem by walking the DAG
-- (entitlement creep hidden behind inheritance).
-- ----------------------------------------------------------------------------
INSERT INTO roles (role_name, description)
VALUES ('Senior Developer', 'Inherits everything from Developer; adds no permissions of its own');

INSERT INTO role_hierarchy (child_role_id, parent_role_id)
SELECT (SELECT role_id FROM roles WHERE role_name = 'Senior Developer'),
       (SELECT role_id FROM roles WHERE role_name = 'Developer');

INSERT INTO employee_roles (employee_id, role_id, grant_type, granted_by, granted_at, is_temporary, status)
SELECT (SELECT employee_id FROM employees WHERE email = 'wei.zhang@eapis-corp.example'),
       (SELECT role_id FROM roles WHERE role_name = 'Senior Developer'),
       'direct',
       (SELECT employee_id FROM employees WHERE email = 'raj.patel@eapis-corp.example'),
       now() - interval '150 days', FALSE, 'active';
