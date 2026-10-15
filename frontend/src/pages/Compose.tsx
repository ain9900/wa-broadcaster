import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ContactPicker, { emptyPick, pastedCount, pickCount, type ContactPick } from '../components/ContactPicker';
import { Empty, PageHeader, useToast } from '../components/ui';
import { api, upload } from '../lib/api';
import { dateTime, duration, fileSize, localInput, plural, previewName, waToHtml } from '../lib/format';
import type { AccountsResponse, CampaignDetail, ContactList, Media, Rotation, Settings, Template } from '../lib/types';

const DRAFT_KEY = 'wab-draft-v2';

type Timing = {
  delay_min_seconds: number; delay_max_seconds: number; batch_size: number; batch_pause_minutes: number; typing_indicator: boolean;
  rotation_mode: Rotation; rotate_every: number; failover: boolean;
};
const TIMING_KEYS = ['delay_min_seconds', 'delay_max_seconds', 'batch_size', 'batch_pause_minutes', 'typing_indicator',
  'rotation_mode', 'rotate_every', 'failover'] as const;
const pickTiming = (src: Timing): Timing => Object.fromEntries(TIMING_KEYS.map(k => [k, src[k]])) as Timing;

const ROTATIONS: [Rotation, string, string][] = [
  ['turns', 'Take turns', 'Each account sends a few messages, then the next one takes over.'],
  ['random', 'Random', 'Any of the chosen accounts, picked at random for each message.'],
  ['balanced', 'Fewest sent today', 'The account that has sent the least today goes next.'],
];

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
  const [linkUrl, setLinkUrl] = useState('');
  const [senders, setSenders] = useState<number[] | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pick, setPick] = useState<ContactPick>(emptyPick);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<AccountsResponse>('/accounts/') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings/') });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates/') });
  const contactLists = useQuery({ queryKey: ['contact-lists'], queryFn: () => api<ContactList[]>('/contact-lists/') });

  const connected = useMemo(() => (accounts.data?.results ?? []).filter(a => a.status === 'connected'), [accounts.data]);

  // Defaults for timing and rotation come from Settings.
  useEffect(() => {
    if (settings.data && !timing) setTiming(pickTiming(settings.data));
  }, [settings.data, timing]);

  // By default every connected account shares the work.
  useEffect(() => {
    if (senders === null && accounts.data) setSenders(connected.map(a => a.id));
  }, [senders, accounts.data, connected]);

  // "Reuse" from a past campaign.
  useEffect(() => {
    if (!fromId) return;
    api<CampaignDetail>(`/campaigns/${fromId}/`).then(c => {
      setMessage(c.message);
      setMedia(c.media);
      // Recipients whose contact was deleted since come back as pasted numbers.
      const saved = c.targets.filter(t => t.contact_id);
      const gone = c.targets.filter(t => !t.contact_id);
      setPick({
        ...emptyPick(),
        contacts: saved.map(t => ({ id: t.contact_id!, name: t.recipient_name, phone: t.phone })),
        numbers: gone.map(t => '+' + t.phone).join('\n'),
      });
      setSenders(c.sender_account_ids);
      setTiming(pickTiming(c));
      toast('Message and recipients loaded. Check them, then send.');
    }).catch(e => toast(e.message, 'bad'));
  }, [fromId, toast]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ message, media })); } catch { /* private mode */ }
  }, [message, media]);

  // Only accounts that are connected right now can send.
  const chosenSenders = useMemo(() => (senders ?? []).filter(id => connected.some(a => a.id === id)), [senders, connected]);

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

  const attachLink = useMutation({
    mutationFn: (url: string) => api<Media>('/media/from-url/', { method: 'POST', body: { url } }),
    onSuccess: m => { setMedia(m); setLinkUrl(''); toast(`Attached ${m.original_name}`); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  const saveTemplate = useMutation({
    mutationFn: (title: string) => api<Template>('/templates/', { method: 'POST', body: { title, body: message } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast('Template saved'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  // ---------- senders ----------
  const toggleSender = (id: number, on: boolean) =>
    setSenders(cur => (on ? [...(cur ?? []).filter(x => x !== id), id] : (cur ?? []).filter(x => x !== id)));

  // ---------- timing / schedule ----------
  const t = timing;
  const n = pickCount(pick, contactLists.data);
  const upTo = pastedCount(pick.numbers) > 0 || pick.listIds.length > 0 ? 'up to ' : '';
  let estimate = '';
  if (t && n > 1) {
    const lo = Math.min(t.delay_min_seconds, t.delay_max_seconds), hi = Math.max(t.delay_min_seconds, t.delay_max_seconds);
    const breaks = t.batch_size > 0 ? Math.floor((n - 1) / t.batch_size) : 0;
    const secs = (n - 1 - breaks) * (lo + hi) / 2 + breaks * t.batch_pause_minutes * 60 + n * (t.typing_indicator ? 3 : 1);
    estimate = `About ${duration(secs)} for ${upTo}${plural(n, 'message')}${breaks ? `, including ${plural(breaks, 'break')}` : ''}.`;
  }
  const scheduleAt = later && when ? new Date(when) : null;
  const badTime = later && (!scheduleAt || Number.isNaN(scheduleAt.getTime()) || scheduleAt.getTime() < Date.now() - 60000);
  const hasContent = !!message.trim() || !!media;
  const needSender = !chosenSenders.length;
  const ready = n > 0 && hasContent && !badTime && !needSender && !!t && uploadPct === null;

  const send = useMutation({
    mutationFn: () => api<CampaignDetail>('/campaigns/', {
      method: 'POST',
      body: {
        message, media_id: media?.id ?? null, scheduled_at: scheduleAt?.toISOString() ?? null, ...t,
        contact_ids: pick.contacts.map(c => c.id), contact_list_ids: pick.listIds, numbers: pick.numbers,
        sender_account_ids: chosenSenders,
      },
    }),
    onSuccess: c => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(scheduleAt ? `Scheduled for ${dateTime(c.scheduled_at)}` : 'Sending started');
      setMessage(''); setMedia(null); setPick(emptyPick()); setConfirming(false);
      nav(`/campaigns/${c.id}`);
    },
    onError: (e: Error) => { toast(e.message, 'bad'); setConfirming(false); },
  });

  const num = (v: string, fallback: number) => (v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

  return (
    <>
      <PageHeader title="New broadcast" sub="Write once, then send it to each of your contacts, one at a time." />
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
          {!media && uploadPct === null && (
            <form className="row" onSubmit={e => { e.preventDefault(); if (linkUrl.trim()) attachLink.mutate(linkUrl.trim()); }}>
              <input type="url" placeholder="…or paste a link to a file, e.g. https://example.com/banner.jpg" value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)} style={{ flex: 1, minWidth: 200 }} aria-label="Attach a file by link" />
              <button type="submit" disabled={!linkUrl.trim() || attachLink.isPending}>{attachLink.isPending ? 'Downloading…' : 'Attach link'}</button>
            </form>
          )}

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

          {/\{name/i.test(message) && <p className="small" style={{ margin: 0 }}>Each contact sees their own name; the preview uses "Rahim". Contacts without a name get the word after |.</p>}

          <NameAndSave placeholder="Name this message to save it as a template" button="Save as template"
            disabled={!message.trim()} onSave={name => saveTemplate.mutate(name)} />
        </section>

        {/* ---------------- recipients ---------------- */}
        <section className="panel">
          <div className="row spread">
            <h2>Recipients</h2>
            <span className="meta">{n ? `${upTo}${plural(n, 'contact')}` : 'None yet'}</span>
          </div>

          <ContactPicker value={pick} onChange={setPick} />

          <fieldset className="opts">
            <legend>Send from</legend>
            {accounts.isLoading ? <span className="small">Loading accounts…</span> : !connected.length ? (
              <Empty>No connected WhatsApp accounts.<br /><Link className="btn primary" to="/accounts" style={{ marginTop: 10 }}>Go to Accounts</Link></Empty>
            ) : (<>
              <div className="row">
                {connected.map(a => (
                  <label key={a.id} className="row chip-check">
                    <input type="checkbox" checked={chosenSenders.includes(a.id)} onChange={e => toggleSender(a.id, e.target.checked)} />
                    {a.label} <span className="meta">+{a.phone}{a.effective_daily_limit ? ` · ${a.sent_today}/${a.effective_daily_limit} today` : ''}</span>
                  </label>
                ))}
              </div>
              {t && chosenSenders.length > 1 && (
                <div className="optgrid">
                  <label htmlFor="rot">Share the work</label>
                  <span className="row">
                    <select id="rot" value={t.rotation_mode} onChange={e => setTiming({ ...t, rotation_mode: e.target.value as Rotation })}>
                      {ROTATIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                    {t.rotation_mode === 'turns' && (<>
                      <input type="number" min={1} max={100} aria-label="Messages per turn" value={t.rotate_every}
                        onChange={e => setTiming({ ...t, rotate_every: Math.max(1, num(e.target.value, 1)) })} />
                      per turn
                    </>)}
                  </span>
                  <label htmlFor="failover">Failover</label>
                  <label className="row"><input id="failover" type="checkbox" checked={t.failover}
                    onChange={e => setTiming({ ...t, failover: e.target.checked })} /> If an account disconnects or hits its daily limit, another one takes over</label>
                </div>
              )}
              <p className="small" style={{ margin: 0 }}>
                {t && chosenSenders.length > 1 ? ROTATIONS.find(r => r[0] === t.rotation_mode)?.[2] + ' ' : ''}
                More accounts means fewer messages from each one, which lowers the ban risk.
              </p>
            </>)}
          </fieldset>

          {t && (
            <fieldset className="opts">
              <legend>Timing</legend>
              <div className="optgrid">
                <label htmlFor="dMin">Wait between messages</label>
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
                  messages, for
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
                <b>{upTo}{plural(n, 'contact')}</b>
                {' '}from {plural(chosenSenders.length, 'account')}
                {scheduleAt ? ` on ${dateTime(scheduleAt.toISOString())}` : ''}?
                <button type="button" className="primary" disabled={send.isPending} onClick={() => send.mutate()}>
                  {send.isPending ? 'Working…' : scheduleAt ? 'Yes, schedule' : 'Yes, send'}
                </button>
                <button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="primary" disabled={!ready} onClick={() => setConfirming(true)}>
                {!n ? 'Pick contacts to send to' : !hasContent ? 'Write a message first' : badTime ? 'Pick a future time'
                  : needSender ? 'Pick an account to send from' : `${scheduleAt ? 'Schedule for' : 'Send to'} ${upTo}${plural(n, 'contact')}`}
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
