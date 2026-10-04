import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null; // avoid a login-page flash while localStorage is read
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}