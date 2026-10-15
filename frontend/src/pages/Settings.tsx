import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../components/auth';
import { ConfirmButton, Empty, PageHeader, Pill, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import type { Rotation, Settings as S, TeamMember, TeamRole } from '../lib/types';

type Health = { ok: boolean; database: boolean; whatsapp_gateway: boolean };

export default function Settings() {
  const toast = useToast();
  const { user } = useAuth();
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
          {field('daily_limit', 'Daily limit per account', 0, 10000, '0 = no limit. Each account can override this. With failover, another account takes over at the limit; otherwise the rest are skipped.')}
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
          <label className="field">
            <span>When several accounts send</span>
            <select value={form.rotation_mode} onChange={e => setForm({ ...form, rotation_mode: e.target.value as Rotation })}>
              <option value="turns">Take turns</option>
              <option value="random">Random</option>
              <option value="balanced">Fewest sent today</option>
            </select>
          </label>
          {form.rotation_mode === 'turns' && field('rotate_every', 'Messages per turn', 1, 100, 'Each account sends this many, then the next one takes over.')}
          <label className="row">
            <input type="checkbox" checked={form.failover} onChange={e => setForm({ ...form, failover: e.target.checked })} />
            Failover: if an account disconnects or reaches its daily limit, another one takes over
          </label>
          <label className="row">
            <input type="checkbox" checked={form.typing_indicator} onChange={e => setForm({ ...form, typing_indicator: e.target.checked })} />
            Show "typing…" before each message
          </label>
          <div><button className="primary" type="submit" disabled={save.isPending}>Save</button></div>
        </form>

        <div className="stack">
          {user?.is_owner ? <><Team /><PasswordForm /></> : (
            <section className="panel">
              <h2>Your account</h2>
              <p className="small" style={{ margin: 0 }}>
                You are a {user?.role === 'support' ? 'support assistant' : 'employee'} in <b>{user?.workspace}</b>'s workspace.
                To change your password, ask {user?.workspace}.
              </p>
            </section>
          )}
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

const ROLES: [TeamRole, string][] = [['employee', 'Employee'], ['support', 'Support assistant']];
const roleName = (r: TeamRole) => ROLES.find(x => x[0] === r)?.[1] ?? r;

/** The owner's employees and support assistants. They share this workspace but can't manage the team or passwords. */
function Team() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['team'], queryFn: () => api<TeamMember[]>('/team/') });
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<number | null>(null);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['team'] }); toast(msg); };

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<TeamMember> & { password?: string } }) =>
      api<TeamMember>(`/team/${id}/`, { method: 'PATCH', body }),
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  return (
    <section className="panel">
      <div className="row spread">
        <h2>Team</h2>
        {!adding && <button type="button" onClick={() => setAdding(true)}>Add team member</button>}
      </div>
      <p className="small" style={{ margin: 0 }}>
        Employees and support assistants sign in with their own username and work in this workspace: same accounts, contacts and campaigns.
        They can't add people or change passwords; you do that here.
      </p>
      {adding && <AddMember onDone={() => { setAdding(false); done('Team member added'); }} onCancel={() => setAdding(false)} />}
      {isLoading ? <Spinner /> : data?.length ? (
        <ul className="list">
          {data.map(m => (
            <li key={m.id} className="top">
              <span className="grow">
                <span className="name">{m.name || m.username}</span>
                <span className="small">@{m.username} · {m.last_login ? `last signed in ${dateTime(m.last_login)}` : 'never signed in'}</span>
                {resetFor === m.id && (
                  <ResetPassword onCancel={() => setResetFor(null)} onSave={password => update.mutate({ id: m.id, body: { password } }, {
                    onSuccess: () => { setResetFor(null); done(`New password set for ${m.username}`); },
                  })} />
                )}
              </span>
              <span className="row">
                <select aria-label={`Role of ${m.username}`} value={m.role}
                  onChange={e => update.mutate({ id: m.id, body: { role: e.target.value as TeamRole } }, { onSuccess: () => done('Role changed') })}>
                  {ROLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                {resetFor !== m.id && <button type="button" className="ghost" onClick={() => setResetFor(m.id)}>Reset password</button>}
                <ConfirmButton confirm={`Remove ${m.username}?`} onConfirm={async () => {
                  try { await api(`/team/${m.id}/`, { method: 'DELETE' }); done(`${m.username} removed. Their work stays.`); }
                  catch (e) { toast((e as Error).message, 'bad'); }
                }}>Remove</ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      ) : !adding && <Empty>No team members yet.</Empty>}
    </section>
  );
}

function AddMember({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'employee' as TeamRole });
  const add = useMutation({
    mutationFn: () => api<TeamMember>('/team/', { method: 'POST', body: { ...form, username: form.username.trim() } }),
    onSuccess: onDone,
    onError: (e: Error) => toast(e.message, 'bad'),
  });
  return (
    <form className="stack" onSubmit={e => { e.preventDefault(); add.mutate(); }}>
      <div className="row">
        <label className="field"><span>Username</span>
          <input type="text" value={form.username} maxLength={150} required autoComplete="off" onChange={e => setForm({ ...form, username: e.target.value })} />
        </label>
        <label className="field"><span>Name (optional)</span>
          <input type="text" value={form.name} maxLength={150} onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <label className="field"><span>Password (10+ characters)</span>
          <input type="password" value={form.password} minLength={10} required autoComplete="new-password" onChange={e => setForm({ ...form, password: e.target.value })} />
        </label>
        <label className="field"><span>Role</span>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as TeamRole })}>
            {ROLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      </div>
      <p className="small" style={{ margin: 0 }}>Give them the username and password yourself. Both roles can do all the work; the role is a label so you know who is who ({roleName('support')} or {roleName('employee')}).</p>
      <div className="row">
        <button type="submit" className="primary" disabled={add.isPending}>{add.isPending ? 'Adding…' : 'Add'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ResetPassword({ onSave, onCancel }: { onSave: (password: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState('');
  return (
    <form className="row" style={{ marginTop: 6 }} onSubmit={e => { e.preventDefault(); onSave(pw); }}>
      <input type="password" placeholder="New password (10+ characters)" value={pw} minLength={10} required autoComplete="new-password"
        onChange={e => setPw(e.target.value)} aria-label="New password" style={{ flex: 1, minWidth: 180 }} />
      <button type="submit" className="primary">Set</button>
      <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
    </form>
  );
}
