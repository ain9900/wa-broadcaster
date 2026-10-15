import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { plural } from '../lib/format';
import type { Contact, ContactList, Page } from '../lib/types';

export type ContactLite = Pick<Contact, 'id' | 'name' | 'phone'>;

/** Who a broadcast goes to. */
export type ContactPick = {
  listIds: number[];
  contacts: ContactLite[];
  numbers: string; // pasted, one per line or comma-separated
};

export const emptyPick = (): ContactPick => ({ listIds: [], contacts: [], numbers: '' });

export const pastedCount = (numbers: string) => numbers.split(/[\n,;]+/).filter(t => t.trim()).length;

/** Upper bound of contacts in the pick (the server removes duplicates and opted-out numbers). */
export function pickCount(p: ContactPick, lists: ContactList[] | undefined): number {
  const fromLists = p.listIds.reduce((n, id) => n + (lists?.find(l => l.id === id)?.contact_count ?? 0), 0);
  return p.contacts.length + fromLists + pastedCount(p.numbers);
}

export default function ContactPicker({ value, onChange }: { value: ContactPick; onChange: (p: ContactPick) => void }) {
  const [q, setQ] = useState('');
  const lists = useQuery({ queryKey: ['contact-lists'], queryFn: () => api<ContactList[]>('/contact-lists/') });
  const found = useQuery({
    queryKey: ['contacts', 'picker', q],
    queryFn: () => api<Page<Contact>>(`/contacts/?page_size=20&opted_out=false&q=${encodeURIComponent(q.trim())}`),
    enabled: q.trim().length > 0,
  });

  const set = (patch: Partial<ContactPick>) => onChange({ ...value, ...patch });
  const toggle = <T,>(arr: T[], x: T, on: boolean) => (on ? [...arr.filter(y => y !== x), x] : arr.filter(y => y !== x));
  const picked = new Set(value.contacts.map(c => c.id));

  return (
    <div className="stack">
      <div className="stack">
        <span className="lbl">Contact lists</span>
        {lists.data?.length ? (
          <div className="chips">
            {lists.data.map(l => (
              <label key={l.id} className={`chip chip-toggle ${value.listIds.includes(l.id) ? 'on' : ''}`}>
                <input type="checkbox" className="sr-only" checked={value.listIds.includes(l.id)}
                  onChange={e => set({ listIds: toggle(value.listIds, l.id, e.target.checked) })} />
                {l.name} · {l.contact_count}
              </label>
            ))}
          </div>
        ) : <span className="small">No lists yet. Create them on the <Link to="/contacts">Contacts</Link> page.</span>}
      </div>

      <div className="stack">
        <span className="lbl">Individual contacts</span>
        <input type="search" placeholder="Search saved contacts by name or number" value={q} onChange={e => setQ(e.target.value)} />
        {q.trim() && (
          <ul className="list scroll-sm">
            {found.data?.results.length ? found.data.results.map(c => (
              <li key={c.id}>
                <input type="checkbox" id={`pc-${c.id}`} checked={picked.has(c.id)} onChange={e => set({
                  contacts: e.target.checked ? [...value.contacts, { id: c.id, name: c.name, phone: c.phone }] : value.contacts.filter(x => x.id !== c.id),
                })} />
                <label className="grow" htmlFor={`pc-${c.id}`}><span className="name">{c.name || 'No name'}</span><span className="meta">+{c.phone}</span></label>
              </li>
            )) : <li className="small">{found.isLoading ? 'Searching…' : 'No matches.'}</li>}
          </ul>
        )}
        {value.contacts.length > 0 && (
          <div className="chips">
            {value.contacts.map(c => (
              <span key={c.id} className="chip">
                <span className="chip-text">{c.name || '+' + c.phone}</span>
                <button type="button" className="x" aria-label={`Remove ${c.name || c.phone}`} onClick={() => set({ contacts: value.contacts.filter(x => x.id !== c.id) })}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <label className="field">
        <span>Or paste numbers</span>
        <textarea value={value.numbers} onChange={e => set({ numbers: e.target.value })} style={{ minHeight: 90 }}
          placeholder={'+8801712345678\n01812345678, 01912345678'} />
        <span className="small">
          {pastedCount(value.numbers) ? `${plural(pastedCount(value.numbers), 'number')}. ` : ''}
          One per line or separated by commas. New numbers are saved to Contacts so opt-outs work.
        </span>
      </label>

      <div className="note">
        Each number is checked for WhatsApp before sending, and opted-out contacts are always skipped.
        Messaging people who haven't saved your number is the main cause of bans. Keep waits long and lists small at first.
      </div>
    </div>
  );
}
