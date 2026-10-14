import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Empty, PageHeader, Pill, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { campaignStatus } from '../lib/format';
import type { CampaignStatus } from '../lib/types';

type Counts = { sent: number; failed: number; skipped: number };
type Report = {
  from: string;
  to: string;
  totals: Counts;
  by_kind: Partial<Record<'group' | 'contact', Counts>>;
  days: ({ date: string } & Counts)[];
  accounts: ({ account_id: number | null; label: string } & Counts)[];
  campaigns: ({ id: number; name: string; status: CampaignStatus } & Counts)[];
  top_errors: { error: string; count: number }[];
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PRESETS = [['Today', 0], ['7 days', 6], ['30 days', 29], ['90 days', 89]] as const;

const rate = (c: Counts) => {
  const done = c.sent + c.failed;
  return done ? Math.round((c.sent / done) * 100) + '%' : '—';
};

/** Stacked daily bars: sent (accent) and failed (danger), with hover tooltip and a hidden table. */
function DayChart({ days }: { days: Report['days'] }) {
  const max = Math.max(1, ...days.map(d => d.sent + d.failed));
  const many = days.length > 31;
  return (
    <figure className="chart">
      <figcaption className="row spread">
        <span className="chart-title">Messages per day</span>
        <span className="legend"><i className="sw sent" />Sent <i className="sw failed" />Failed</span>
      </figcaption>
      <div className="bars" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }} aria-hidden="true">
        {days.map((d, i) => (
          <div className="bar-col" key={d.date} tabIndex={0}>
            <span className="tip">
              {new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}:{' '}
              <b>{d.sent}</b> sent, <b>{d.failed}</b> failed{d.skipped ? `, ${d.skipped} skipped` : ''}
            </span>
            <div className="bar-track stack-bar">
              <i className="failed" style={{ height: `${(d.failed / max) * 100}%` }} />
              <i style={{ height: `${(d.sent / max) * 100}%` }} />
            </div>
            <span className="bar-label">
              {!many || i % 7 === 0 ? new Date(d.date + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''}
            </span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Messages per day</caption>
        <thead><tr><th>Date</th><th>Sent</th><th>Failed</th><th>Skipped</th></tr></thead>
        <tbody>{days.map(d => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.sent}</td><td>{d.failed}</td><td>{d.skipped}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function CountsCells({ c }: { c: Counts }) {
  return <><td className="num">{c.sent.toLocaleString()}</td><td className="num">{c.failed.toLocaleString()}</td><td className="num">{c.skipped.toLocaleString()}</td><td className="num">{rate(c)}</td></>;
}

export default function Reports() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(iso(new Date()));
  const qs = `from=${from}&to=${to}`;
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', from, to],
    queryFn: () => api<Report>(`/reports/?${qs}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Reports"
        sub="How your messages did over a period. Counts use the time each message was processed."
        actions={<a className="btn primary" href={`/api/reports/export/?${qs}`} download>Download CSV</a>}
      />

      <section className="panel">
        <div className="row">
          <div className="segmented" role="group" aria-label="Quick ranges">
            {PRESETS.map(([label, n]) => (
              <button key={label} type="button" aria-selected={from === daysAgo(n) && to === iso(new Date())}
                onClick={() => { setFrom(daysAgo(n)); setTo(iso(new Date())); }}>{label}</button>
            ))}
          </div>
          <label className="row">From <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
          <label className="row">To <input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        </div>
        {error && <p className="err">{(error as Error).message}</p>}
      </section>

      {isLoading || !data ? <Spinner /> : (
        <>
          <section className="stats">
            <div className="stat"><span className="stat-label">Sent</span><span className="stat-value">{data.totals.sent.toLocaleString()}</span></div>
            <div className="stat"><span className="stat-label">Failed</span><span className="stat-value">{data.totals.failed.toLocaleString()}</span></div>
            <div className="stat"><span className="stat-label">Skipped</span><span className="stat-value">{data.totals.skipped.toLocaleString()}</span>
              <span className="small">opted out, daily limit, cancelled</span></div>
            <div className="stat"><span className="stat-label">Delivery rate</span><span className="stat-value">{rate(data.totals)}</span>
              <span className="small">sent ÷ (sent + failed)</span></div>
          </section>

          <section className="panel">
            {data.totals.sent + data.totals.failed ? <DayChart days={data.days} /> : <Empty>No messages in this period.</Empty>}
          </section>

          <div className="grid-2">
            <section className="panel">
              <h2>By recipient type</h2>
              <table className="table">
                <thead><tr><th>Type</th><th className="num">Sent</th><th className="num">Failed</th><th className="num">Skipped</th><th className="num">Rate</th></tr></thead>
                <tbody>
                  {(['group', 'contact'] as const).map(k => (
                    <tr key={k}><td>{k === 'group' ? 'Groups' : 'Contacts'}</td><CountsCells c={data.by_kind[k] ?? { sent: 0, failed: 0, skipped: 0 }} /></tr>
                  ))}
                </tbody>
              </table>

              <h2>By account</h2>
              {data.accounts.length ? (
                <table className="table">
                  <thead><tr><th>Account</th><th className="num">Sent</th><th className="num">Failed</th><th className="num">Skipped</th><th className="num">Rate</th></tr></thead>
                  <tbody>{data.accounts.map(a => <tr key={`${a.account_id}-${a.label}`}><td>{a.label}</td><CountsCells c={a} /></tr>)}</tbody>
                </table>
              ) : <Empty>No activity.</Empty>}
            </section>

            <section className="panel">
              <h2>Most common problems</h2>
              {data.top_errors.length ? (
                <ul className="list">
                  {data.top_errors.map(e => (
                    <li key={e.error}><span className="grow small">{e.error}</span><span className="meta">{e.count.toLocaleString()}</span></li>
                  ))}
                </ul>
              ) : <Empty>No failures in this period.</Empty>}
            </section>
          </div>

          <section className="panel">
            <h2>By campaign</h2>
            {data.campaigns.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Campaign</th><th>Status</th><th className="num">Sent</th><th className="num">Failed</th><th className="num">Skipped</th><th className="num">Rate</th><th /></tr></thead>
                  <tbody>
                    {data.campaigns.map(c => {
                      const [label, tone] = campaignStatus[c.status] ?? [c.status, ''];
                      return (
                        <tr key={c.id}>
                          <td><Link to={`/campaigns/${c.id}`}>{c.name || `Campaign #${c.id}`}</Link></td>
                          <td><Pill tone={tone}>{label}</Pill></td>
                          <CountsCells c={c} />
                          <td><a href={`/api/campaigns/${c.id}/export/`} download className="small">CSV</a></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No campaigns sent anything in this period.</Empty>}
          </section>
        </>
      )}
    </>
  );
}
