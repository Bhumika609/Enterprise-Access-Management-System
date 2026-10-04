// Single source of truth for sidebar navigation. Routes live in App.jsx;
// `roles` hides an item from roles that can't use it.
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', end: true }],
  },
  {
    label: 'Access',
    items: [
      { to: '/employees', label: 'Employees' },
      { to: '/roles', label: 'Roles & Permissions' },
      { to: '/role-hierarchy', label: 'Role Hierarchy' },
      { to: '/access-requests', label: 'Access Requests' },
      { to: '/delegations', label: 'Delegations' },
    ],
  },
  {
    label: 'Risk & Compliance',
    items: [
      { to: '/findings', label: 'Findings' },
      { to: '/sod-violations', label: 'SoD Violations' },
      { to: '/unused-access', label: 'Unused Access' },
      { to: '/recertification', label: 'Recertification' },
      { to: '/reports', label: 'Reports', roles: ['admin', 'auditor', 'manager'] },
    ],
  },
  {
    label: 'Records',
    items: [
      { to: '/access-logs', label: 'Access Logs' },
      { to: '/audit-logs', label: 'Audit Logs' },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/admin', label: 'Administration', roles: ['admin'] }],
  },
];