import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CampaignRow } from './Campaigns';
import { Empty, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import type { Campaign, Dashboard as Stats, Page } from '../lib/types';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</span>
      {hint && <span className="small">{hint}</span>}
    </div>
  );
}

/** Single-series bar chart: messages sent per day. One hue, hover tooltip per bar, table for screen readers. */
function WeekChart({ days }: { days: Stats['last_7_days'] }) {
  const max = Math.max(1, ...days.map(d => d.sent));
  const label = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
  return (
    <figure className="chart">
      <figcaption className="chart-title">Messages sent, last 7 days</figcaption>
      <div className="bars" aria-hidden="true">
        {days.map(d => (
          <div className="bar-col" key={d.date} tabIndex={0}>
            <span className="tip">{new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}: <b>{d.sent.toLocaleString()}</b></span>
            <div className="bar-track"><i style={{ height: `${(d.sent / max) * 100}%` }} /></div>
            <span className="bar-label">{label(d.date)}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Messages sent per day</caption>
        <tbody>{days.map(d => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.sent}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export default function Dashboard() {
  const stats = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Stats>('/dashboard/'), refetchInterval: 15000 });
  const active = useQuery({
    queryKey: ['campaigns', 'active'],
    queryFn: () => api<Page<Campaign>>('/campaigns/?status=active'),
    refetchInterval: q => (q.state.data?.results.some(c => c.status === 'running') ? 2000 : 10000),
  });
  const recent = useQuery({ queryKey: ['campaigns', 'recent'], queryFn: () => api<Page<Campaign>>('/campaigns/?page=1') });

  if (stats.isLoading) return <Spinner />;
  const s = stats.data;
  const recentDone = recent.data?.results.filter(c => !['scheduled', 'running', 'paused'].includes(c.status)).slice(0, 5) ?? [];

  return (
    <>
      <PageHeader title="Dashboard" sub="What's sending now and how the week went." actions={<Link className="btn primary" to="/compose">New broadcast</Link>} />

      {s && s.accounts.total === 0 && (
        <div className="note">No WhatsApp accounts are linked yet. <Link to="/accounts">Link your first account</Link> to start sending.</div>
      )}

      {s && (
        <section className="stats">
          <Stat label="Accounts connected" value={`${s.accounts.connected}/${s.accounts.total}`} />
          <Stat label="Sent today" value={s.sent_today} hint={s.failed_today ? `${s.failed_today} failed` : undefined} />
          <Stat label="Active campaigns" value={s.campaigns_active} />
          <Stat label="Sent all time" value={s.sent_total} />
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="row spread"><h2>Active and scheduled</h2><Link to="/campaigns" className="small">All campaigns →</Link></div>
          {active.data?.results.length ? (
            <ul className="list">{active.data.results.map(c => <CampaignRow key={c.id} c={c} />)}</ul>
          ) : (
            <Empty>Nothing sending or scheduled.</Empty>
          )}
        </section>
        <section className="panel">{s && <WeekChart days={s.last_7_days} />}</section>
      </div>

      <section className="panel">
        <h2>Recently finished</h2>
        {recentDone.length ? <ul className="list">{recentDone.map(c => <CampaignRow key={c.id} c={c} />)}</ul> : <Empty>No finished campaigns yet.</Empty>}
      </section>
    </>
  );
}
