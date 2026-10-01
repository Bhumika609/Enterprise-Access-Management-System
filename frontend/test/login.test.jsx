// Integration test: renders the REAL app (no mocked fetch) against the backend
// pointed to by VITE_API_URL / .env, and drives it exactly like a user would.
// Requires the backend to be running (npm start in backend/) before you run this.
//   npm run test
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext';
import App from '../src/App';

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => localStorage.clear());

describe('Login and routing', () => {
  it('redirects an unauthenticated visitor straight to the login screen', async () => {
    renderApp('/findings');
    expect(await screen.findByText('Access Terminal')).toBeInTheDocument();
  });

  it('shows an error and does not navigate away on a wrong password', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Username'), 'lsimmons');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/ACCESS DENIED/i)).toBeInTheDocument();
    expect(screen.getByText('Access Terminal')).toBeInTheDocument();
  });

  it('logs in with real backend credentials and reaches the dashboard with live data', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Username'), 'lsimmons');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Laura Simmons')).toBeInTheDocument();
    expect(await screen.findByText('admin')).toBeInTheDocument();
    // a real number from the database, not a hardcoded fixture
    await waitFor(() => expect(screen.getByText('22')).toBeInTheDocument());
    // session persisted for the next reload
    expect(JSON.parse(localStorage.getItem('eapis.session')).user.username).toBe('lsimmons');
  });

  it('hides the admin-only nav item for a non-admin role', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Username'), 'dchen');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('signs out and returns to the login screen', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Username'), 'pnair');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByRole('heading', { name: 'Dashboard' });

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByText('Access Terminal')).toBeInTheDocument();
    expect(localStorage.getItem('eapis.session')).toBeNull();
  });
});