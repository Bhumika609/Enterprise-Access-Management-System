import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import Home from './pages/Home';
import ComingSoon from './pages/ComingSoon';
import NotFound from './pages/NotFound';
import { NAV_SECTIONS } from './lib/nav';

// Every nav item other than "/" is rendered as a placeholder until its own
// stage replaces it with a real page — this keeps the sidebar link list and
// the route list impossible to get out of sync.
const placeholderRoutes = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.to !== '/');

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Home />} />
        {placeholderRoutes.map((item) => (
          <Route key={item.to} path={item.to.slice(1)} element={<ComingSoon title={item.label} />} />
        ))}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}