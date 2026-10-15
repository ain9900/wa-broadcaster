import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmButton, Empty, PageHeader, Pill, Spinner, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { accountStatus } from '../lib/format';
import type { Account, AccountsResponse } from '../lib/types';

const BUSY = ['starting', 'qr', 'reconnecting'];

export default function Accounts() {
  const toast = useToast();
  const qc = useQueryClient();
  const [label, setLabel] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<AccountsResponse>('/accounts/'),
    refetchInterval: q => (q.state.data?.results.some(a => BUSY.includes(a.status)) ? 2000 : 15000),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const add = useMutation({
    mutationFn: () => api<Account>('/accounts/', { method: 'POST', body: { label: label.trim() || 'WhatsApp account' } }),
    onSuccess: () => { setLabel(''); refresh(); },
    onError: (e: Error) => { toast(e.message, 'bad'); refresh(); },
  });

  return (
    <>
      <PageHeader title="WhatsApp accounts" sub="Link phones by scanning a QR code. Logins are kept, so they reconnect by themselves after restarts." />

      {data && !data.provider_online && (
        <div className="note bad">
          The WhatsApp service ({data.provider === 'evolution' ? 'Evolution API' : 'gateway'}) is not reachable, so statuses below may be out of date.
          Make sure it is running.
        </div>
      )}

      <section className="panel">
        <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); add.mutate(); }}>
          <input type="text" placeholder="Name for this account, e.g. Office phone" value={label} maxLength={60}
            onChange={e => setLabel(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="primary" type="submit" disabled={add.isPending}>{add.isPending ? 'Starting…' : 'Link a new account'}</button>
        </form>
        <div className="note">
          On the phone: open WhatsApp → <b>Settings</b> (or ⋮ menu) → <b>Linked devices</b> → <b>Link a device</b>, then scan the QR code that appears here.
        </div>
        <p className="small" style={{ margin: 0 }}>
          This uses an unofficial WhatsApp Web connection. Numbers can be banned for bulk sending. Only message people who expect it, and keep waits long.
        </p>
      </section>

      {isLoading ? <Spinner /> : data?.results.length ? (
        <div className="cards">{data.results.map(a => <AccountCard key={a.id} a={a} onChange={refresh} />)}</div>
      ) : (
        <Empty>No accounts yet. Give one a name above and click "Link a new account".</Empty>
      )}
    </>
  );
}

function AccountCard({ a, onChange }: { a: Account; onChange: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(a.label);
  const [limit, setLimit] = useState(a.daily_limit === null ? '' : String(a.daily_limit));
  const [forceRemove, setForceRemove] = useState(false);
  const [text, tone] = accountStatus[a.status] ?? [a.status, ''];

  const call = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      api(`/accounts/${a.id}/${path}`, { method, body }),
    onSuccess: onChange,
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  async function remove() {
    try {
      await api(`/accounts/${a.id}/${forceRemove ? '?force=1' : ''}`, { method: 'DELETE' });
      toast('Account removed');
      onChange();
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) setForceRemove(true);
      toast((e as Error).message, 'bad');
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const daily_limit = limit.trim() === '' ? null : Math.max(0, Math.round(Number(limit)));
    call.mutate({ path: '', method: 'PATCH', body: { label: label.trim() || a.label, daily_limit } }, {
      onSuccess: () => { setEditing(false); toast('Saved'); },
    });
  }

  return (
    <div className="card">
      <div className="row spread">
        <span className="name">{a.label}</span>
        <Pill tone={tone}>{text}</Pill>
      </div>
      {a.phone && <span className="meta">+{a.phone}{a.display_name ? ` · ${a.display_name}` : ''}</span>}
      {a.phone && (
        <span className="small">
          Sent today: {a.sent_today}{a.effective_daily_limit ? ` of ${a.effective_daily_limit}` : ''}
        </span>
      )}
      {a.qr && (
        <>
          <div className="qr"><img src={a.qr} alt={`QR code to link ${a.label}`} /></div>
          <span className="small">The code changes every ~20 seconds. Scan the newest one.</span>
        </>
      )}
      {a.status === 'starting' && <span className="small">Preparing a QR code…</span>}
      {a.last_error && <span className="small err">{a.last_error}</span>}

      {editing ? (
        <form className="stack" onSubmit={save}>
          <label className="field"><span>Name</span><input type="text" value={label} maxLength={60} onChange={e => setLabel(e.target.value)} /></label>
          <label className="field">
            <span>Daily limit (empty = workspace default, 0 = no limit)</span>
            <input type="number" min={0} max={10000} value={limit} onChange={e => setLimit(e.target.value)} />
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={call.isPending}>Save</button>
            <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="row">
          {['disconnected', 'logged_out', 'error'].includes(a.status) && (
            <button type="button" className="primary" disabled={call.isPending} onClick={() => call.mutate({ path: 'relink/' })}>Show QR code</button>
          )}
          <button type="button" className="ghost" onClick={() => setEditing(true)}>Edit</button>
          <ConfirmButton confirm={forceRemove ? 'Remove from this app only?' : 'Unlink and remove?'} onConfirm={remove}>
            {forceRemove ? 'Remove anyway' : 'Remove'}
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
