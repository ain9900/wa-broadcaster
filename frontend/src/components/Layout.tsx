import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Dashboard } from '../lib/types';
import { useAuth } from './auth';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/compose', label: 'New broadcast' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/reports', label: 'Reports' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/library', label: 'Templates & sets' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard/'), refetchInterval: 15000 });

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span>WA Broadcaster</span>
          <button type="button" className="ghost menu-btn" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(o => !o)}>☰</button>
        </div>
        <nav aria-label="Main">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
              {n.to === '/accounts' && data && <span className="meta">{data.accounts.connected}/{data.accounts.total}</span>}
              {n.to === '/campaigns' && !!data?.campaigns_active && <span className="badge">{data.campaigns_active}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="small">Signed in as <b>{user?.username}</b></span>
          <button type="button" className="ghost" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
