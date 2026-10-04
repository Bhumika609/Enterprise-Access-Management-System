import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NAV_SECTIONS } from '../lib/nav';

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <span className="mono" style={styles.brandMark}>◆</span>
          <span style={styles.brandName}>EAPIS</span>
        </div>
        <nav style={styles.nav}>
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((i) => !i.roles || i.roles.includes(user?.role));
            if (!items.length) return null;
            return (
              <div key={section.label} style={styles.navSection}>
                <p style={styles.navLabel}>{section.label}</p>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div style={styles.main}>
        <header style={styles.topbar}>
          <div />
          <div style={styles.identity}>
            <span className="badge">{user?.role}</span>
            <span style={{ color: 'var(--text-muted)' }}>{user?.full_name || user?.username}</span>
            <button className="btn" onClick={handleLogout}>Sign out</button>
          </div>
        </header>
        <main style={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  sidebar: { width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', flexDirection: 'column' },
  brand: { display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px', borderBottom: '1px solid var(--border)' },
  brandMark: { color: 'var(--accent)', fontSize: 14 },
  brandName: { fontWeight: 600, letterSpacing: '0.02em' },
  nav: { padding: '16px 12px', overflowY: 'auto' },
  navSection: { marginBottom: 18 },
  navLabel: { fontSize: 10.5, letterSpacing: '0.07em', color: 'var(--text-faint)', textTransform: 'uppercase', margin: '0 8px 6px' },
  navItem: { display: 'block', padding: '7px 10px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 2 },
  navItemActive: { background: 'var(--accent-wash)', color: 'var(--text)' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  topbar: { height: 56, flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' },
  identity: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5 },
  content: { flex: 1, padding: 28, overflowY: 'auto' },
};