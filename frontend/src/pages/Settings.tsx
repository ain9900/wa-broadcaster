import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Pill, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import type { Settings as S } from '../lib/types';

type Health = { ok: boolean; database: boolean; whatsapp_gateway: boolean };

export default function Settings() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<S>('/settings/') });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health/'), refetchInterval: 15000 });
  const [form, setForm] = useState<S | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (s: S) => api<S>('/settings/', { method: 'PUT', body: s }),
    onSuccess: s => { qc.setQueryData(['settings'], s); toast('Settings saved'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  if (!form) return <Spinner />;
  const field = (k: keyof S, label: string, min: number, max: number, hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} value={form[k] as number} onChange={e => setForm({ ...form, [k]: Number(e.target.value) })} />
      {hint && <span className="small">{hint}</span>}
    </label>
  );

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid-2">
        <form className="panel" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(form); }}>
          <h2>Sending defaults</h2>
          <p className="small" style={{ margin: 0 }}>New broadcasts start with these values. Each broadcast can change them.</p>
          {field('daily_limit', 'Daily limit per account', 0, 10000, '0 = no limit. Groups over the limit are skipped. Each account can override this.')}
          <div className="row">
            {field('delay_min_seconds', 'Shortest wait (seconds)', 3, 600)}
            {field('delay_max_seconds', 'Longest wait (seconds)', 3, 600)}
          </div>
          <div className="row">
            {field('batch_size', 'Break after (messages)', 0, 500, '0 = no breaks')}
            {field('batch_pause_minutes', 'Break length (minutes)', 1, 240)}
          </div>
          <label className="field">
            <span>Default country code</span>
            <input type="text" inputMode="numeric" maxLength={4} value={form.default_country_code}
              onChange={e => setForm({ ...form, default_country_code: e.target.value.replace(/\D/g, '') })} style={{ maxWidth: 120 }} />
            <span className="small">Added to local numbers that start with 0, e.g. 880 turns 01712345678 into +8801712345678. Leave empty to require full international numbers.</span>
          </label>
          <label className="row">
            <input type="checkbox" checked={form.typing_indicator} onChange={e => setForm({ ...form, typing_indicator: e.target.checked })} />
            Show "typing…" before each message
          </label>
          <div><button className="primary" type="submit" disabled={save.isPending}>Save</button></div>
        </form>

        <div className="stack">
          <PasswordForm />
          <section className="panel">
            <h2>System status</h2>
            <ul className="list">
              <li><span className="grow">Database</span><Pill tone={health.data?.database ? 'ok' : 'bad'}>{health.data?.database ? 'OK' : 'Down'}</Pill></li>
              <li><span className="grow">WhatsApp service</span><Pill tone={health.data?.whatsapp_gateway ? 'ok' : 'bad'}>{health.data?.whatsapp_gateway ? 'OK' : 'Not reachable'}</Pill></li>
            </ul>
            <p className="small" style={{ margin: 0 }}>Manage users and see raw data in the <a href="/admin/" target="_blank" rel="noreferrer">admin panel</a>.</p>
          </section>
        </div>
      </div>
    </>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api('/auth/password/', { method: 'POST', body: { current_password: cur, new_password: next } }),
    onSuccess: () => { setCur(''); setNext(''); toast('Password changed'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });
  return (
    <form className="panel" onSubmit={e => { e.preventDefault(); change.mutate(); }}>
      <h2>Change password</h2>
      <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required /></label>
      <label className="field"><span>New password (10+ characters)</span><input type="password" autoComplete="new-password" minLength={10} value={next} onChange={e => setNext(e.target.value)} required /></label>
      <div><button type="submit" disabled={change.isPending}>Change password</button></div>
    </form>
  );
}
