import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ContactPicker, { emptyPick, pastedCount, pickCount, type ContactPick } from '../components/ContactPicker';
import { ConfirmButton, Empty, PageHeader, Pill, useToast } from '../components/ui';
import { api, upload } from '../lib/api';
import { dateTime, duration, fileSize, localInput, plural, previewName, relative, waToHtml } from '../lib/format';
import type { AccountGroups, CampaignDetail, ContactList, GroupSet, Media, Settings, TargetRef, Template } from '../lib/types';

const DRAFT_KEY = 'wab-draft-v2';
const key = (accountId: number, jid: string) => `${accountId}|${jid}`;
const toRefs = (keys: Iterable<string>): TargetRef[] =>
  [...keys].map(k => { const i = k.indexOf('|'); return { account_id: Number(k.slice(0, i)), group_jid: k.slice(i + 1) }; });

type Timing = { delay_min_seconds: number; delay_max_seconds: number; batch_size: number; batch_pause_minutes: number; typing_indicator: boolean };

function readDraft(): { message: string; media: Media | null } {
  try { return { media: null, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; } catch { return { message: '', media: null }; }
}

export default function Compose() {
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const fromId = params.get('from');

  const draft = useMemo(readDraft, []);
  const [message, setMessage] = useState<string>(draft.message || '');
  const [media, setMedia] = useState<Media | null>(draft.media);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [timing, setTiming] = useState<Timing | null>(null);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState<'groups' | 'contacts'>('groups');
  const [pick, setPick] = useState<ContactPick>(emptyPick);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<AccountGroups[]>('/groups/') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings/') });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates/') });
  const sets = useQuery({ queryKey: ['group-sets'], queryFn: () => api<GroupSet[]>('/group-sets/') });
  const contactLists = useQuery({ queryKey: ['contact-lists'], queryFn: () => api<ContactList[]>('/contact-lists/') });

  // Defaults for timing come from Settings.
  useEffect(() => {
    if (settings.data && !timing) {
      const { delay_min_seconds, delay_max_seconds, batch_size, batch_pause_minutes, typing_indicator } = settings.data;
      setTiming({ delay_min_seconds, delay_max_seconds, batch_size, batch_pause_minutes, typing_indicator });
    }
  }, [settings.data, timing]);

  // "Reuse" from a past campaign.
  useEffect(() => {
    if (!fromId) return;
    api<CampaignDetail>(`/campaigns/${fromId}/`).then(c => {
      setMessage(c.message);
      setMedia(c.media);
      setSelected(new Set(c.targets.filter(t => t.kind === 'group' && t.account_id).map(t => key(t.account_id!, t.recipient_jid))));
      const people = c.targets.filter(t => t.kind === 'contact' && t.contact_id);
      setPick({
        ...emptyPick(),
        senders: [...new Set(people.map(t => t.account_id).filter((x): x is number => x !== null))],
        contacts: people.map(t => ({ id: t.contact_id!, name: t.recipient_name, phone: t.recipient_jid.split('@')[0] })),
      });
      if (people.length && !c.targets.some(t => t.kind === 'group')) setTab('contacts');
      setTiming({
        delay_min_seconds: c.delay_min_seconds, delay_max_seconds: c.delay_max_seconds, batch_size: c.batch_size,
        batch_pause_minutes: c.batch_pause_minutes, typing_indicator: c.typing_indicator,
      });
      toast('Message and recipients loaded. Check them, then send.');
    }).catch(e => toast(e.message, 'bad'));
  }, [fromId, toast]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ message, media })); } catch { /* private mode */ }
  }, [message, media]);

  // Only keep selections that still exist.
  const valid = useMemo(() => new Set((groups.data ?? []).flatMap(a => a.groups.map(g => key(a.account_id, g.jid)))), [groups.data]);
  const chosen = useMemo(() => [...selected].filter(k => valid.has(k)), [selected, valid]);

  // ---------- message ----------
  function wrapSelection(w: string) {
    const el = textRef.current;
    if (!el) return;
    const a = el.selectionStart, z = el.selectionEnd, v = message, sel = v.slice(a, z) || 'text';
    setMessage(v.slice(0, a) + w + sel + w + v.slice(z));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + w.length, a + w.length + sel.length); });
  }

  function insertAtCursor(snippet: string) {
    const el = textRef.current;
    const a = el?.selectionStart ?? message.length, z = el?.selectionEnd ?? message.length;
    setMessage(message.slice(0, a) + snippet + message.slice(z));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + snippet.length, a + snippet.length); });
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setUploadPct(0);
    try {
      const m = await upload<Media>('/media/', f, setUploadPct);
      setMedia(m);
      toast(m.kind === 'image' || m.kind === 'video' ? 'Attached. Your message becomes its caption.' : 'File attached');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setUploadPct(null);
    }
  }

  const saveTemplate = useMutation({
    mutationFn: (title: string) => api<Template>('/templates/', { method: 'POST', body: { title, body: message } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast('Template saved'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  // ---------- groups ----------
  function toggle(k: string, on: boolean) {
    setSelected(s => { const n = new Set(s); on ? n.add(k) : n.delete(k); return n; });
  }
  function selectAll(a: AccountGroups, on: boolean) {
    setSelected(s => {
      const n = new Set(s);
      a.groups.forEach(g => (on ? g.can_post && n.add(key(a.account_id, g.jid)) : n.delete(key(a.account_id, g.jid))));
      return n;
    });
  }
  const syncGroups = useMutation({
    mutationFn: (accountId: number) => api(`/accounts/${accountId}/sync-groups/`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['groups'] }); toast('Groups refreshed'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  function applySet(s: GroupSet) {
    const keys = s.targets.map(t => key(t.account_id, t.group_jid));
    const ok = keys.filter(k => valid.has(k));
    setSelected(new Set(ok));
    const missing = keys.length - ok.length;
    toast(`Selected "${s.name}"` + (missing ? ` (${plural(missing, 'group')} not available right now)` : ''));
  }
  const saveSet = useMutation({
    mutationFn: (name: string) => api<GroupSet>('/group-sets/', { method: 'POST', body: { name, targets: toRefs(chosen) } }),
    onSuccess: s => { qc.invalidateQueries({ queryKey: ['group-sets'] }); toast(`Saved "${s.name}"`); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });
  const deleteSet = useMutation({
    mutationFn: (id: number) => api(`/group-sets/${id}/`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-sets'] }),
  });

  // ---------- timing / schedule ----------
  const t = timing;
  const contactCount = pickCount(pick, contactLists.data);
  const hasContacts = contactCount > 0;
  const n = chosen.length + contactCount;
  let estimate = '';
  if (t && n > 1) {
    const lo = Math.min(t.delay_min_seconds, t.delay_max_seconds), hi = Math.max(t.delay_min_seconds, t.delay_max_seconds);
    const breaks = t.batch_size > 0 ? Math.floor((n - 1) / t.batch_size) : 0;
    const secs = (n - 1 - breaks) * (lo + hi) / 2 + breaks * t.batch_pause_minutes * 60 + n * (t.typing_indicator ? 3 : 1);
    estimate = `About ${duration(secs)} for ${hasContacts ? 'up to ' : ''}${plural(n, 'message')}${breaks ? `, including ${plural(breaks, 'break')}` : ''}.`;
  }
  const scheduleAt = later && when ? new Date(when) : null;
  const badTime = later && (!scheduleAt || Number.isNaN(scheduleAt.getTime()) || scheduleAt.getTime() < Date.now() - 60000);
  const hasContent = !!message.trim() || !!media;
  const needSender = hasContacts && !pick.senders.length;
  const ready = n > 0 && hasContent && !badTime && !needSender && !!t && uploadPct === null;

  const send = useMutation({
    mutationFn: () => api<CampaignDetail>('/campaigns/', {
      method: 'POST',
      body: {
        message, media_id: media?.id ?? null, targets: toRefs(chosen), scheduled_at: scheduleAt?.toISOString() ?? null, ...t,
        ...(hasContacts ? {
          contact_ids: pick.contacts.map(c => c.id), contact_list_ids: pick.listIds, numbers: pick.numbers, sender_account_ids: pick.senders,
        } : {}),
      },
    }),
    onSuccess: c => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(scheduleAt ? `Scheduled for ${dateTime(c.scheduled_at)}` : 'Sending started');
      setMessage(''); setMedia(null); setSelected(new Set()); setPick(emptyPick()); setConfirming(false);
      nav(`/campaigns/${c.id}`);
    },
    onError: (e: Error) => { toast(e.message, 'bad'); setConfirming(false); },
  });

  const q = search.trim().toLowerCase();
  const num = (v: string, fallback: number) => (v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

  return (
    <>
      <PageHeader title="New broadcast" sub="Write once, then send to groups and contacts, one at a time." />
      <div className="grid-2">
        {/* ---------------- message ---------------- */}
        <section className="panel">
          <div className="row spread">
            <h2>Message</h2>
            <span className="meta">{message.length.toLocaleString()} characters</span>
          </div>
          <div className="row fmt" role="group" aria-label="WhatsApp formatting">
            <button type="button" onClick={() => wrapSelection('*')} title="Bold"><b>B</b></button>
            <button type="button" onClick={() => wrapSelection('_')} title="Italic"><i>I</i></button>
            <button type="button" onClick={() => wrapSelection('~')} title="Strikethrough"><s>S</s></button>
            <button type="button" onClick={() => wrapSelection('```')} title="Monospace">{'{ }'}</button>
            <button type="button" onClick={() => insertAtCursor('{name|friend}')} title="Insert the contact's name (friend when there is none)">+ Name</button>
            {!!templates.data?.length && (
              <select aria-label="Insert a template" value="" onChange={e => {
                const tp = templates.data!.find(x => String(x.id) === e.target.value);
                if (tp) { setMessage(tp.body); toast(`Loaded "${tp.title}"`); }
              }}>
                <option value="">Use a template…</option>
                {templates.data.map(tp => <option key={tp.id} value={tp.id}>{tp.title}</option>)}
              </select>
            )}
          </div>
          <textarea ref={textRef} value={message} onChange={e => setMessage(e.target.value)} maxLength={60000}
            placeholder="Type your announcement. Bangla and emoji work too." aria-label="Message" />

          <div className="row">
            <label className="filebtn">
              {media ? 'Change file' : 'Attach photo, video or file'}
              <input type="file" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {uploadPct !== null && <span className="small">Uploading… {uploadPct}%</span>}
            {media && uploadPct === null && (
              <span className="filechip">
                {media.kind === 'image' && <img className="thumb-sm" src={media.url} alt="" />}
                <span>{media.original_name} · {fileSize(media.size)}</span>
                <button type="button" className="ghost" aria-label="Remove file" onClick={() => setMedia(null)}>✕</button>
              </span>
            )}
          </div>

          <div>
            <span className="lbl">Preview</span>
            <div className="chat">
              <div className="bubble">
                {media?.kind === 'image' && <img src={media.url} alt="" className="bubble-img" />}
                {media && media.kind !== 'image' && <div className="bubble-file">📎 {media.original_name}</div>}
                {message.trim()
                  ? <div dangerouslySetInnerHTML={{ __html: waToHtml(previewName(message)) }} />
                  : !media && <span className="empty">Your formatted message appears here.</span>}
              </div>
            </div>
          </div>

          {/\{name/i.test(message) && <p className="small" style={{ margin: 0 }}>Contacts see their own name; the preview uses "Rahim". In groups, the fallback after | is used.</p>}

          <NameAndSave placeholder="Name this message to save it as a template" button="Save as template"
            disabled={!message.trim()} onSave={name => saveTemplate.mutate(name)} />
        </section>

        {/* ---------------- groups ---------------- */}
        <section className="panel">
          <div className="row spread">
            <h2>Recipients</h2>
            <span className="meta">{chosen.length} groups · {hasContacts ? `up to ${contactCount}` : 0} contacts</span>
          </div>
          <div className="segmented" role="tablist" aria-label="Recipient type">
            <button type="button" role="tab" aria-selected={tab === 'groups'} onClick={() => setTab('groups')}>Groups{chosen.length ? ` (${chosen.length})` : ''}</button>
            <button type="button" role="tab" aria-selected={tab === 'contacts'} onClick={() => setTab('contacts')}>Contacts{hasContacts ? ` (${contactCount})` : ''}</button>
          </div>

          {tab === 'contacts' && <ContactPicker value={pick} onChange={setPick} accounts={groups.data ?? []} />}

          {tab === 'groups' && (<>

          {!!sets.data?.length && (
            <div className="chips" aria-label="Saved group sets">
              {sets.data.map(s => (
                <span className="chip" key={s.id}>
                  <button type="button" onClick={() => applySet(s)} title="Select these groups">{s.name} · {s.targets.length}</button>
                  <ConfirmButton className="x" confirm="Delete?" onConfirm={() => deleteSet.mutateAsync(s.id)}>✕</ConfirmButton>
                </span>
              ))}
            </div>
          )}

          <input type="search" placeholder="Search groups" value={search} onChange={e => setSearch(e.target.value)} />

          {groups.isLoading ? <span className="small">Loading groups…</span> : !groups.data?.length ? (
            <Empty>No connected accounts yet.<br /><Link className="btn primary" to="/accounts" style={{ marginTop: 10 }}>Link a WhatsApp account</Link></Empty>
          ) : (
            <div className="stack">
              {groups.data.map(a => {
                const shown = a.groups.filter(g => !q || g.name.toLowerCase().includes(q));
                const picked = a.groups.filter(g => selected.has(key(a.account_id, g.jid))).length;
                return (
                  <div className="acct" key={a.account_id}>
                    <header>
                      <span><span className="name">{a.label}</span> <span className="meta">+{a.phone} · {picked}/{a.groups.length}</span></span>
                      <span className="row">
                        <button type="button" className="ghost" onClick={() => selectAll(a, true)}>Select all</button>
                        <button type="button" className="ghost" onClick={() => selectAll(a, false)}>Clear</button>
                        <button type="button" className="ghost" disabled={syncGroups.isPending} title={`Last refreshed ${relative(a.groups_synced_at)}`}
                          onClick={() => syncGroups.mutate(a.account_id)}>Refresh</button>
                      </span>
                    </header>
                    <ul className="list">
                      {shown.length ? shown.map(g => {
                        const k = key(a.account_id, g.jid);
                        const id = `g-${a.account_id}-${g.id}`;
                        return (
                          <li key={g.id}>
                            <input type="checkbox" id={id} checked={selected.has(k)} onChange={e => toggle(k, e.target.checked)} />
                            <label className="grow" htmlFor={id}>
                              <span className="name">{g.name}</span>
                              <span className="small">{g.size} members</span>
                            </label>
                            {g.admins_only && (g.can_post
                              ? <Pill tone="warn">Admins only</Pill>
                              : <Pill tone="bad" title="Only admins can post here, and this account is not an admin">Can't post</Pill>)}
                          </li>
                        );
                      }) : <li className="small">{a.groups.length ? 'No groups match your search.' : 'This account is not in any groups yet.'}</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          <NameAndSave placeholder="Name the selected groups, e.g. Staff" button="Save as group set"
            disabled={!chosen.length} onSave={name => saveSet.mutate(name)} />
          </>)}

          {t && (
            <fieldset className="opts">
              <legend>Timing</legend>
              <div className="optgrid">
                <label htmlFor="dMin">Wait between groups</label>
                <span className="row nowrap">
                  <input id="dMin" type="number" min={3} max={600} value={t.delay_min_seconds}
                    onChange={e => setTiming({ ...t, delay_min_seconds: num(e.target.value, 3) })} />
                  to
                  <input type="number" min={3} max={600} aria-label="Maximum wait" value={t.delay_max_seconds}
                    onChange={e => setTiming({ ...t, delay_max_seconds: num(e.target.value, 3) })} /> sec
                </span>
                <label htmlFor="bSize">Take a break after</label>
                <span className="row nowrap">
                  <input id="bSize" type="number" min={0} max={500} value={t.batch_size}
                    onChange={e => setTiming({ ...t, batch_size: num(e.target.value, 0) })} />
                  groups, for
                  <input type="number" min={1} max={240} aria-label="Break length in minutes" value={t.batch_pause_minutes}
                    onChange={e => setTiming({ ...t, batch_pause_minutes: num(e.target.value, 1) })} /> min
                </span>
                <label htmlFor="typing">Typing indicator</label>
                <label className="row"><input id="typing" type="checkbox" checked={t.typing_indicator}
                  onChange={e => setTiming({ ...t, typing_indicator: e.target.checked })} /> Show "typing…" before each message</label>
                <label htmlFor="whenMode">When to send</label>
                <span className="row">
                  <select id="whenMode" value={later ? 'later' : 'now'} onChange={e => {
                    const l = e.target.value === 'later';
                    setLater(l);
                    if (l && !when) { const d = new Date(Date.now() + 3600000); d.setMinutes(0); setWhen(localInput(d)); }
                  }}>
                    <option value="now">Now</option>
                    <option value="later">Later</option>
                  </select>
                  {later && <input type="datetime-local" value={when} min={localInput(new Date())} onChange={e => setWhen(e.target.value)} aria-label="Send at" />}
                </span>
              </div>
              {estimate && <p className="small" style={{ margin: 0 }}>{estimate}</p>}
              <p className="small" style={{ margin: 0 }}>Each wait is a random time in your range. Set "break after" to 0 for no breaks.</p>
            </fieldset>
          )}

          <div className="row send-row">
            {confirming && ready ? (
              <span className="confirm">
                {scheduleAt ? 'Schedule' : 'Send'} to{' '}
                <b>{[chosen.length && plural(chosen.length, 'group'), hasContacts && `${pastedCount(pick.numbers) || pick.listIds.length ? 'up to ' : ''}${plural(contactCount, 'contact')}`].filter(Boolean).join(' and ')}</b>
                {' '}from {plural(new Set([...chosen.map(k => k.split('|')[0]), ...(hasContacts ? pick.senders.map(String) : [])]).size, 'account')}
                {scheduleAt ? ` on ${dateTime(scheduleAt.toISOString())}` : ''}?
                <button type="button" className="primary" disabled={send.isPending} onClick={() => send.mutate()}>
                  {send.isPending ? 'Working…' : scheduleAt ? 'Yes, schedule' : 'Yes, send'}
                </button>
                <button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="primary" disabled={!ready} onClick={() => setConfirming(true)}>
                {!n ? 'Pick groups or contacts' : !hasContent ? 'Write a message first' : badTime ? 'Pick a future time'
                  : needSender ? 'Pick an account to send from' : `${scheduleAt ? 'Schedule for' : 'Send to'} ${hasContacts ? 'up to ' : ''}${plural(n, 'recipient')}`}
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function NameAndSave({ placeholder, button, disabled, onSave }: { placeholder: string; button: string; disabled: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form className="row" onSubmit={e => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(''); } }}>
      <input type="text" placeholder={placeholder} value={name} onChange={e => setName(e.target.value)} maxLength={60} style={{ flex: 1, minWidth: 160 }} />
      <button type="submit" disabled={disabled || !name.trim()}>{button}</button>
    </form>
  );
}
