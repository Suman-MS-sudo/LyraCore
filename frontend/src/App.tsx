import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Layout from './components/Layout';

// Sales
import SalesDashboard from './pages/sales/Dashboard';
import LeadsList from './pages/sales/LeadsList';
import LeadDetail from './pages/sales/LeadDetail';
import NewLead from './pages/sales/NewLead';
import Customers from './pages/sales/Customers';
import Products from './pages/sales/Products';
import SayHi from './pages/sales/SayHi';

// Production
import ProductionDashboard from './pages/production/Dashboard';
import OrdersList from './pages/production/OrdersList';
import OrderDetail from './pages/production/OrderDetail';
import InstallationList from './pages/production/InstallationList';

// CEO
import CeoDashboard from './pages/ceo/Dashboard';
import AuditLogs from './pages/ceo/AuditLogs';
import Settings from './pages/ceo/Settings';
import Attendance from './pages/ceo/Attendance';

function RoleRoute({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'sales') return <Navigate to="/sales" replace />;
  if (user.role === 'production') return <Navigate to="/production" replace />;
  if (user.role === 'management') return <Navigate to="/management" replace />;
  if (user.role === 'installation') return <Navigate to="/installation" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <HomeRedirect /> : <Login />} />
        <Route path="/" element={<HomeRedirect />} />

        {/* Sales Routes */}
        <Route path="/sales" element={<RoleRoute roles={['sales', 'management']}><Layout /></RoleRoute>}>
          <Route index element={<SalesDashboard />} />
          <Route path="leads" element={<LeadsList />} />
          <Route path="leads/new" element={<NewLead />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="customers" element={<Customers />} />
          <Route path="products" element={<Products />} />
          <Route path="sayhi" element={<SayHi />} />
        </Route>

        {/* Production Routes */}
        <Route path="/production" element={<RoleRoute roles={['production', 'management']}><Layout /></RoleRoute>}>
          <Route index element={<ProductionDashboard />} />
          <Route path="orders" element={<OrdersList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="installation" element={<InstallationList />} />
        </Route>

        {/* Management Routes */}
        <Route path="/management" element={<RoleRoute roles={['management']}><Layout /></RoleRoute>}>
          <Route index element={<CeoDashboard />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="audit" element={<AuditLogs />} />
          <Route path="settings" element={<Settings />} />
          {/* Management can also access sales and production views */}
          <Route path="leads" element={<LeadsList />} />
          <Route path="leads/new" element={<NewLead />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="customers" element={<Customers />} />
          <Route path="products" element={<Products />} />
          <Route path="sayhi" element={<SayHi />} />
          <Route path="orders" element={<OrdersList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="installation" element={<InstallationList />} />
        </Route>

        {/* Installation Role Routes */}
        <Route path="/installation" element={<RoleRoute roles={['installation', 'management']}><Layout /></RoleRoute>}>
          <Route index element={<InstallationList />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
