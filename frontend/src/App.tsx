import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './components/auth';
import { Spinner } from './components/ui';
import Accounts from './pages/Accounts';
import CampaignDetail from './pages/CampaignDetail';
import Campaigns from './pages/Campaigns';
import Compose from './pages/Compose';
import Contacts from './pages/Contacts';
import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import Login from './pages/Login';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="center-screen"><Spinner /></div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="compose" element={<Compose />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="campaigns/:id" element={<CampaignDetail />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="reports" element={<Reports />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="library" element={<Library />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
