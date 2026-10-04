import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import Home from './pages/Home';
import Employees from './pages/Employees';
import EmployeeProfile from './pages/EmployeeProfile';
import Roles from './pages/Roles';
import RoleHierarchy from './pages/RoleHierarchy';
import AccessRequests from './pages/AccessRequests';
import Delegations from './pages/Delegations';
import Findings from './pages/Findings';
import SodViolations from './pages/SodViolations';
import UnusedAccess from './pages/UnusedAccess';
import Recertification from './pages/Recertification';
import Reports from './pages/Reports';
import AccessLogs from './pages/AccessLogs';
import AuditLogs from './pages/AuditLogs';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/:id" element={<EmployeeProfile />} />
        <Route path="roles" element={<Roles />} />
        <Route path="role-hierarchy" element={<RoleHierarchy />} />
        <Route path="access-requests" element={<AccessRequests />} />
        <Route path="delegations" element={<Delegations />} />
        <Route path="findings" element={<Findings />} />
        <Route path="sod-violations" element={<SodViolations />} />
        <Route path="unused-access" element={<UnusedAccess />} />
        <Route path="recertification" element={<Recertification />} />
        <Route path="reports" element={<Reports />} />
        <Route path="access-logs" element={<AccessLogs />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
