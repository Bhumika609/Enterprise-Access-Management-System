// Renders every real page against the live backend (no mocks) and checks that it loads
// data from the database without an error banner. Requires the backend to be running.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext';
import App from '../src/App';

const API = process.env.VITE_API_URL || 'http://localhost:4000/api';
const sessions = {};
async function sessionFor(username) {
  if (!sessions[username]) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Password@123' }) });
    sessions[username] = await r.json();
  }
  return sessions[username];
}
async function renderAs(username, path) {
  localStorage.setItem('eapis.session', JSON.stringify(await sessionFor(username)));
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
beforeEach(() => localStorage.clear());
beforeAll(async () => { await sessionFor('lsimmons'); });

const PAGES = [
  ['/employees', 'Employees', 'Laura Simmons'],
  ['/roles', 'Roles & Permissions', 'Payments Admin'],
  ['/role-hierarchy', 'Role Hierarchy', null],
  ['/access-requests', 'Access Requests', null],
  ['/delegations', 'Delegations', null],
  ['/findings', 'Findings', null],
  ['/sod-violations', 'SoD Violations', 'Grace Kim'],
  ['/unused-access', 'Unused Access', 'Wei Zhang'],
  ['/recertification', 'Recertification', 'Q3 2026 Access Recertification'],
  ['/reports', 'Reports', 'Derek Hughes'],
  ['/access-logs', 'Access Logs', null],
  ['/audit-logs', 'Audit Logs', null],
  ['/admin', 'Administration', null],
];

describe('every page loads real data', () => {
  it.each(PAGES)('%s', async (path, heading, expectedText) => {
    await renderAs('lsimmons', path);
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
    if (expectedText) expect((await screen.findAllByText(expectedText)).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('shows all seven required summary cards, both charts and top risky employees', async () => {
    await renderAs('lsimmons', '/');
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
    for (const label of ['Total employees', 'Total roles', 'Total permissions', 'Active temporary access', 'Critical findings', 'SoD violations', 'Unused permissions']) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(await screen.findByRole('img', { name: /Distribution of/ })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Access activity/ })).toBeInTheDocument();
    expect(await screen.findByText('Top risky employees')).toBeInTheDocument();
    expect((await screen.findAllByText('Derek Hughes')).length).toBeGreaterThan(0);
  });
});

describe('drill-downs and graph', () => {
  it('opens an employee profile with effective permissions and inherited paths', async () => {
    const user = userEvent.setup();
    await renderAs('lsimmons', '/employees');
    await user.click(await screen.findByText('Tom Baxter'));
    expect(await screen.findByRole('heading', { name: 'Tom Baxter', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/Effective permissions/)).toBeInTheDocument();
    expect((await screen.findAllByText('Inherited')).length).toBeGreaterThan(0);
  });

  it('draws the role DAG and traces ancestors on selection', async () => {
    const user = userEvent.setup();
    await renderAs('lsimmons', '/role-hierarchy');
    const node = await screen.findByRole('button', { name: 'Role DevOps Engineer' });
    await user.click(node);
    expect(await screen.findByText('Ancestors')).toBeInTheDocument();
    const dd = screen.getByText((_, el) => el?.tagName === 'DD' && /Developer/.test(el.textContent) && /Release Manager/.test(el.textContent) && /Employee/.test(el.textContent));
    expect(dd).toBeInTheDocument();
  });

  it('opens a finding for review', async () => {
    const user = userEvent.setup();
    await renderAs('lsimmons', '/findings');
    await screen.findAllByText(/Segregation|SoD violation|Privilege escalation|Anomalous|Unused permission/);
    const rows = await screen.findAllByRole('row');
    await user.click(rows[1]); // rows[0] is the header
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Evidence/)).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });
});

describe('role-based UI', () => {
  it('viewer is read-only: no admin menu, no reports, no create-role button', async () => {
    await renderAs('dchen', '/roles');
    await screen.findByRole('heading', { name: 'Roles & Permissions', level: 1 });
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument();
  });

  it('admin sees the management controls', async () => {
    await renderAs('lsimmons', '/roles');
    expect(await screen.findByRole('button', { name: 'New role' })).toBeInTheDocument();
  });
});
