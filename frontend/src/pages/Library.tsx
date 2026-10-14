import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ConfirmButton, Empty, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, plural, waToHtml } from '../lib/format';
import type { GroupSet, Template } from '../lib/types';

export default function Library() {
  return (
    <>
      <PageHeader title="Templates & group sets" sub="Messages you send often, and saved selections of groups." />
      <div className="grid-2">
        <Templates />
        <Sets />
      </div>
    </>
  );
}

function Templates() {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates/') });
  const [edit, setEdit] = useState<Partial<Template> | null>(null);

  const save = useMutation({
    mutationFn: (t: Partial<Template>) =>
      api<Template>(t.id ? `/templates/${t.id}/` : '/templates/', { method: t.id ? 'PATCH' : 'POST', body: { title: t.title, body: t.body } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setEdit(null); toast('Template saved'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/templates/${id}/`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  function use(t: Template) {
    try {
      const d = JSON.parse(localStorage.getItem('wab-draft-v2') || '{}');
      localStorage.setItem('wab-draft-v2', JSON.stringify({ ...d, message: t.body }));
    } catch { /* ignore */ }
    nav('/compose');
  }

  return (
    <section className="panel">
      <div className="row spread">
        <h2>Templates</h2>
        {!edit && <button type="button" onClick={() => setEdit({ title: '', body: '' })}>New template</button>}
      </div>
      {edit && (
        <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(edit); }}>
          <label className="field"><span>Name</span>
            <input type="text" value={edit.title ?? ''} maxLength={80} onChange={e => setEdit({ ...edit, title: e.target.value })} required />
          </label>
          <label className="field"><span>Text</span>
            <textarea value={edit.body ?? ''} onChange={e => setEdit({ ...edit, body: e.target.value })} required />
          </label>
          <div className="row">
            <button className="primary" type="submit" disabled={save.isPending}>Save</button>
            <button className="ghost" type="button" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      )}
      {data?.length ? (
        <ul className="list">
          {data.map(t => (
            <li key={t.id} className="top">
              <span className="grow">
                <span className="name">{t.title}</span>
                <span className="clamp" dangerouslySetInnerHTML={{ __html: waToHtml(t.body) }} />
                <span className="small">Updated {dateTime(t.updated_at)}</span>
              </span>
              <span className="row">
                <button type="button" onClick={() => use(t)}>Use</button>
                <button type="button" className="ghost" onClick={() => setEdit(t)}>Edit</button>
                <ConfirmButton confirm="Delete?" onConfirm={() => remove.mutateAsync(t.id)}>Delete</ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      ) : !edit && <Empty>No templates yet. Save one here or from the composer.</Empty>}
    </section>
  );
}

function Sets() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['group-sets'], queryFn: () => api<GroupSet[]>('/group-sets/') });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/group-sets/${id}/`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-sets'] }),
  });
  return (
    <section className="panel">
      <h2>Group sets</h2>
      <p className="small" style={{ margin: 0 }}>Create a set in the composer: tick groups, name them, then "Save as group set". Saving under an existing name replaces it.</p>
      {data?.length ? (
        <ul className="list">
          {data.map(s => (
            <li key={s.id}>
              <span className="grow"><span className="name">{s.name}</span><span className="small">{plural(s.targets.length, 'group')} · updated {dateTime(s.updated_at)}</span></span>
              <ConfirmButton confirm="Delete?" onConfirm={() => remove.mutateAsync(s.id)}>Delete</ConfirmButton>
            </li>
          ))}
        </ul>
      ) : <Empty>No group sets yet.</Empty>}
    </section>
  );
}
