import { useEffect, useState } from 'react';
import { campaignStatus, dateTime, duration } from '../lib/format';
import type { CampaignDetail, CampaignTarget, TargetStatus } from '../lib/types';
import { Countdown, Pill, Progress } from './ui';

const who = (t: CampaignTarget) => {
  const phone = '+' + t.phone;
  return { name: t.recipient_name || phone, sub: [t.recipient_name ? phone : '', t.account_label].filter(Boolean).join(' · ') };
};

/** Seconds still to go: average wait per remaining message plus the breaks still ahead. */
function remainingSeconds(c: CampaignDetail): number {
  if (!c.pending) return 0;
  const avg = (c.delay_min_seconds + c.delay_max_seconds) / 2 + (c.typing_indicator ? 3 : 1);
  const breaks = c.batch_size ? Math.floor((c.pending - 1) / c.batch_size) : 0;
  const nextIn = c.next_action_at ? Math.max(0, (new Date(c.next_action_at).getTime() - Date.now()) / 1000) : 0;
  return nextIn + Math.max(0, c.pending - 1) * avg + breaks * c.batch_pause_minutes * 60;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** The live "what is happening right now" panel at the top of a campaign. */
export default function LiveStatus({ c, onFilter }: { c: CampaignDetail; onFilter: (s: TargetStatus | '') => void }) {
  const [label, tone] = campaignStatus[c.status];
  const running = c.status === 'running';
  const now = useNow(running);
  const done = c.total - c.pending;
  const pct = c.total ? Math.round((done / c.total) * 100) : 0;
  const current = c.targets.find(t => t.status === 'sending');
  const next = c.targets.find(t => t.status === 'pending');
  const last = [...c.targets].filter(t => t.finished_at).sort((a, b) => b.finished_at!.localeCompare(a.finished_at!))[0];
  const started = c.started_at ? new Date(c.started_at).getTime() : null;
  const ended = c.finished_at ? new Date(c.finished_at).getTime() : now;

  const tiles: [TargetStatus | '', string, number, string][] = [
    ['sent', 'Sent', c.sent, 'ok'],
    ['failed', 'Failed', c.failed, 'bad'],
    ['skipped', 'Skipped', c.skipped, ''],
    ['pending', 'Waiting', c.pending, 'warn'],
  ];

  return (
    <section className={`panel live ${running ? 'is-running' : ''}`} aria-live="polite">
      <div className="row spread">
        <span className="row">
          {running && <span className="pulse" aria-hidden="true" />}
          <Pill tone={tone}>{label}</Pill>
          <span className="live-pct">{pct}%</span>
          <span className="small">{done.toLocaleString()} of {c.total.toLocaleString()} done</span>
        </span>
        <span className="small">
          {c.status === 'scheduled' && <>Starts {dateTime(c.scheduled_at)}{new Date(c.scheduled_at).getTime() > Date.now() && <> (in <Countdown to={c.scheduled_at} />)</>}</>}
          {started && <>Started {dateTime(c.started_at)} · {c.finished_at ? 'took' : 'running for'} {duration((ended - started) / 1000)}</>}
          {c.finished_at && <> · Finished {dateTime(c.finished_at)}</>}
        </span>
      </div>

      <Progress value={done} total={c.total} label="Campaign progress" />

      <div className="tiles">
        {tiles.map(([status, name, n, t]) => (
          <button key={name} type="button" className={`tile ${t}`} onClick={() => onFilter(status)} title={`Show ${name.toLowerCase()} recipients`}>
            <span className="tile-value">{n.toLocaleString()}</span>
            <span className="tile-label">{name}</span>
          </button>
        ))}
      </div>

      {running && (
        <div className="now">
          <div>
            <span className="lbl">Now</span>
            {current ? (
              <span className="now-line"><b>Sending to {who(current).name}</b><span className="small">{who(current).sub}</span></span>
            ) : c.next_action_at ? (
              <span className="now-line"><b>{c.note || 'Waiting'}</b><span className="small">next message in <Countdown to={c.next_action_at} /></span></span>
            ) : (
              <span className="now-line"><b>{c.note || 'Starting…'}</b></span>
            )}
          </div>
          {next && (
            <div>
              <span className="lbl">Next</span>
              <span className="now-line"><b>{who(next).name}</b><span className="small">{who(next).sub}</span></span>
            </div>
          )}
          <div>
            <span className="lbl">Time left</span>
            <span className="now-line"><b>about {duration(remainingSeconds(c))}</b><span className="small">estimate, from your wait settings</span></span>
          </div>
        </div>
      )}

      {c.status === 'paused' && <p className="small" style={{ margin: 0 }}>Paused. Resume to continue with the remaining {c.pending.toLocaleString()} recipients.</p>}
      {last && (
        <p className="small" style={{ margin: 0 }}>
          Last result: {who(last).name}: <b>{last.status}</b>{last.error ? ` (${last.error})` : ''} at {dateTime(last.finished_at)}
        </p>
      )}
    </section>
  );
}
