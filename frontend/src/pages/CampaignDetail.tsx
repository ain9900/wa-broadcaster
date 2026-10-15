import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LiveStatus from '../components/LiveStatus';
import { ConfirmButton, Empty, PageHeader, Pill, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, fileSize, previewName, targetStatus, waToHtml } from '../lib/format';
import type { CampaignDetail as Detail, Rotation, TargetStatus } from '../lib/types';

const ROTATION: Record<Rotation, string> = { turns: 'taking turns', random: 'random', balanced: 'fewest sent today first' };
const DONE: Record<string, string> = { cancel: 'Cancelled', pause: 'Paused', resume: 'Resumed' };

export default function CampaignDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<TargetStatus | ''>('');

  const { data: c, isLoading, error } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api<Detail>(`/campaigns/${id}/`),
    refetchInterval: q => (q.state.data?.status === 'running' ? 1500 : q.state.data?.status === 'scheduled' ? 5000 : false),
  });

  const act = useMutation({
    mutationFn: (action: string) => api<Detail>(`/campaigns/${id}/${action}/`, { method: 'POST' }),
    onSuccess: (d, action) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (action === 'retry-failed') {
        toast('A new send for the failed recipients is queued.');
        nav(`/campaigns/${d.id}`);
      } else {
        qc.setQueryData(['campaign', id], d);
        toast(DONE[action] ?? 'Done');
      }
    },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  async function remove() {
    try {
      await api(`/campaigns/${id}/`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast('Deleted');
      nav('/campaigns');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  if (isLoading) return <Spinner />;
  if (error || !c) return <Empty>{(error as Error)?.message || 'Not found.'} <Link to="/campaigns">Back to campaigns</Link></Empty>;

  const active = ['scheduled', 'running', 'paused'].includes(c.status);
  const targets = filter ? c.targets.filter(t => t.status === filter) : c.targets;
  const counts = c.targets.reduce<Record<string, number>>((m, t) => ((m[t.status] = (m[t.status] || 0) + 1), m), {});

  return (
    <>
      <PageHeader
        title={c.name || 'Untitled campaign'}
        sub={<>Created {dateTime(c.created_at)}{c.created_by ? ` by ${c.created_by}` : ''} · <Link to="/campaigns">All campaigns</Link></>}
        actions={
          <>
            {(c.status === 'scheduled' || c.status === 'running') && <button type="button" onClick={() => act.mutate('pause')} disabled={act.isPending}>Pause</button>}
            {c.status === 'paused' && <button type="button" className="primary" onClick={() => act.mutate('resume')} disabled={act.isPending}>Resume</button>}
            {active && <ConfirmButton className="danger" confirm="Stop this send?" onConfirm={() => act.mutateAsync('cancel')}>Cancel send</ConfirmButton>}
            {!active && (c.failed > 0 || c.skipped > 0) && (
              <button type="button" onClick={() => act.mutate('retry-failed')} disabled={act.isPending}>Retry {c.failed + c.skipped} failed/skipped</button>
            )}
            <a className="btn" href={`/api/campaigns/${c.id}/export/`} download>Export CSV</a>
            <Link className="btn" to={`/compose?from=${c.id}`}>Reuse</Link>
            {!active && <ConfirmButton confirm="Delete this record?" onConfirm={remove}>Delete</ConfirmButton>}
          </>
        }
      />

      <LiveStatus c={c} onFilter={f => { setFilter(f); document.getElementById('recipients')?.scrollIntoView({ behavior: 'smooth' }); }} />

      <div className="grid-2">
        <section className="panel">
          <h2>Message</h2>
          {c.media && (
            <div className="filechip">
              {c.media.kind === 'image' ? <img className="thumb" src={c.media.url} alt="" /> : <span>📎</span>}
              <span>{c.media.original_name} · {fileSize(c.media.size)}</span>
            </div>
          )}
          {c.message ? <div className="bubble" dangerouslySetInnerHTML={{ __html: waToHtml(previewName(c.message)) }} /> : <span className="small">No text (attachment only).</span>}
          <p className="small" style={{ margin: 0 }}>
            Waits {c.delay_min_seconds}–{c.delay_max_seconds}s between messages
            {c.batch_size ? `, ${c.batch_pause_minutes} min break every ${c.batch_size} messages` : ''}
            {c.typing_indicator ? ', shows "typing…"' : ''}.
            {c.sender_account_ids.length > 1 && <> Sent from {c.sender_account_ids.length} accounts ({ROTATION[c.rotation_mode]}{c.rotation_mode === 'turns' ? `, ${c.rotate_every} per turn` : ''}{c.failover ? ', with failover' : ''}).</>}
          </p>
        </section>

        <section className="panel" id="recipients">
          <div className="row spread">
            <h2>Recipients</h2>
            <select value={filter} onChange={e => setFilter(e.target.value as TargetStatus | '')} aria-label="Filter recipients">
              <option value="">All ({c.targets.length})</option>
              {(Object.keys(targetStatus) as TargetStatus[]).filter(k => counts[k]).map(k => (
                <option key={k} value={k}>{targetStatus[k][0]} ({counts[k]})</option>
              ))}
            </select>
          </div>
          <ul className="list scroll">
            {targets.map(t => {
              const [tl, tt] = targetStatus[t.status];
              return (
                <li key={t.id} className={t.status === 'sending' ? 'sending-row' : ''}>
                  <span className="grow">
                    <span className="name">{t.recipient_name || '+' + t.phone}</span>
                    <span className="small">{t.recipient_name ? `+${t.phone}` : ''}{t.recipient_name && t.account_label ? ' · ' : ''}{t.account_label}{t.sent_at ? ` · ${dateTime(t.sent_at)}` : ''}{t.error ? ` · ${t.error}` : ''}</span>
                  </span>
                  <Pill tone={tt}>{tl}</Pill>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
