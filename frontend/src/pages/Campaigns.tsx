import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Countdown, Empty, PageHeader, Pill, Progress, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { campaignStatus, dateTime, plural } from '../lib/format';
import type { Campaign, Page } from '../lib/types';

export function CampaignRow({ c }: { c: Campaign }) {
  const [label, tone] = campaignStatus[c.status];
  const done = c.total - c.pending;
  return (
    <li>
      <Link to={`/campaigns/${c.id}`} className="row-link">
        <span className="grow">
          <span className="row">
            <span className="name">{c.name || 'Untitled'}</span>
            <Pill tone={tone}>{label}</Pill>
          </span>
          <span className="small">
            {c.status === 'scheduled' ? `Starts ${dateTime(c.scheduled_at)}` : `Created ${dateTime(c.created_at)}`}
            {' · '}{c.sent}/{plural(c.total, 'recipient')} sent{c.failed ? ` · ${c.failed} failed` : ''}{c.skipped ? ` · ${c.skipped} skipped` : ''}
            {c.media ? ` · 📎 ${c.media.original_name}` : ''}
          </span>
          {c.status === 'running' && (
            <>
              <Progress value={done} total={c.total} />
              <span className="small">
                {c.next_action_at ? <>{c.note || 'Waiting'}: next message in <Countdown to={c.next_action_at} /></> : c.note || 'Posting…'}
              </span>
            </>
          )}
        </span>
        <span aria-hidden="true" className="chev">›</span>
      </Link>
    </li>
  );
}

const FILTERS = [
  ['', 'All'],
  ['active', 'Active'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
] as const;

export default function Campaigns() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', 'list', status, q, page],
    queryFn: () => api<Page<Campaign>>(`/campaigns/?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: d => (d.state.data?.results.some(c => c.status === 'running') ? 2000 : 15000),
  });
  const pages = data ? Math.max(1, Math.ceil(data.count / 25)) : 1;

  return (
    <>
      <PageHeader title="Campaigns" sub="Every broadcast: scheduled, sending and finished." actions={<Link className="btn primary" to="/compose">New broadcast</Link>} />
      <section className="panel">
        <div className="row spread">
          <div className="segmented" role="tablist">
            {FILTERS.map(([v, l]) => (
              <button key={v} type="button" role="tab" aria-selected={status === v} onClick={() => { setStatus(v); setPage(1); }}>{l}</button>
            ))}
          </div>
          <input type="search" placeholder="Search messages" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} style={{ maxWidth: 280 }} />
        </div>
        {isLoading ? <Spinner /> : data?.results.length ? (
          <ul className="list">{data.results.map(c => <CampaignRow key={c.id} c={c} />)}</ul>
        ) : (
          <Empty>{q || status ? 'No campaigns match.' : 'Nothing sent yet.'}</Empty>
        )}
        {pages > 1 && (
          <div className="row spread">
            <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Newer</button>
            <span className="meta">Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Older →</button>
          </div>
        )}
      </section>
    </>
  );
}
