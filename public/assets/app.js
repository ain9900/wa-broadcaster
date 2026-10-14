(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (a, g) => a + '|' + g;

  async function api(path, opts = {}) {
    const r = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong.');
    return d;
  }

  let tt;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 4000); }

  // ---------- tabs ----------
  document.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => showTab(b.dataset.tab)));
  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    document.querySelectorAll('[data-view]').forEach(v => (v.hidden = v.dataset.view !== name));
    if (name === 'history') loadHistory();
    if (name === 'accounts') loadAccounts();
    if (name === 'send') loadGroups();
  }
  $('#logout').onclick = async () => { await fetch('/logout', { method: 'POST' }); location.href = '/login'; };

  // ---------- message ----------
  const msg = $('#msg');
  try { msg.value = localStorage.getItem('wab-draft') || ''; } catch {}
  function fmt(t) {
    let h = esc(t);
    h = h.replace(/```([\s\S]+?)```/g, '<code style="font-family:var(--mono)">$1</code>');
    for (const [m, tag] of [['\\*', 'b'], ['_', 'i'], ['~', 's']]) {
      h = h.replace(new RegExp(`(^|[\\s(])${m}(\\S(?:[^${m}\\n]*\\S)?)${m}(?=$|[\\s.,!?)])`, 'gm'), `$1<${tag}>$2</${tag}>`);
    }
    return h;
  }
  function renderMsg() {
    $('#count').textContent = msg.value.length.toLocaleString() + ' characters';
    $('#preview').innerHTML = msg.value.trim() ? fmt(msg.value) : '<span class="empty">Your formatted message appears here.</span>';
    try { localStorage.setItem('wab-draft', msg.value); } catch {}
    renderSendBtn();
  }
  msg.addEventListener('input', renderMsg);
  document.querySelectorAll('[data-wrap]').forEach(b => (b.onclick = () => {
    const w = b.dataset.wrap, a = msg.selectionStart, z = msg.selectionEnd, v = msg.value, sel = v.slice(a, z) || 'text';
    msg.value = v.slice(0, a) + w + sel + w + v.slice(z);
    msg.focus(); msg.setSelectionRange(a + w.length, a + w.length + sel.length);
    renderMsg();
  }));

  // ---------- attachment ----------
  let attachment = null, thumbUrl = null;
  const kb = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  function renderAttach(uploading) {
    const box = $('#attach');
    if (uploading) { box.innerHTML = `<span class="small">Uploading ${esc(uploading)}…</span>`; return; }
    box.innerHTML = attachment
      ? `<span class="filechip">${thumbUrl ? `<img class="thumb" src="${thumbUrl}" alt="">` : ''}<span>${esc(attachment.name)} · ${kb(attachment.size)}</span><button type="button" class="ghost" id="unattach" aria-label="Remove file">✕</button></span>`
      : '';
    $('.filebtn').textContent = attachment ? 'Change file' : 'Attach photo, video or file';
    renderSendBtn();
  }
  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 25 * 1048576) return toast('Files can be up to 25 MB.');
    renderAttach(f.name);
    try {
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: f });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      attachment = d;
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      thumbUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
      toast(f.type.startsWith('image/') || f.type.startsWith('video/') ? 'Attached. Your message will be its caption.' : 'File attached');
    } catch (err) { toast(err.message); }
    renderAttach();
  });
  $('#attach').addEventListener('click', e => { if (e.target.id === 'unattach') { attachment = null; thumbUrl = null; renderAttach(); } });

  // ---------- group sets ----------
  let sets = [], setConfirm = null;
  async function loadSets() { sets = await api('/sets'); renderSets(); }
  function renderSets() {
    $('#sets').innerHTML = sets.map(s => setConfirm === s.id
      ? `<span class="chip"><button type="button" class="danger" data-sdelyes="${s.id}">Delete "${esc(s.name)}"?</button><button type="button" class="x" data-sdelno>Keep</button></span>`
      : `<span class="chip"><button type="button" data-suse="${s.id}" title="Select these groups">${esc(s.name)} · ${s.targets.length}</button><button type="button" class="x" data-sdel="${s.id}" aria-label="Delete set ${esc(s.name)}">✕</button></span>`).join('');
  }
  $('#sets').addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.suse) {
      const s = sets.find(x => x.id === t.dataset.suse);
      const valid = new Set(groupData.flatMap(a => a.groups.map(g => key(a.accountId, g.id))));
      selected.clear();
      let missing = 0;
      s.targets.forEach(x => { const k = key(x.accountId, x.groupId); valid.has(k) ? selected.add(k) : missing++; });
      renderGroups();
      toast(`Selected "${s.name}"` + (missing ? ` (${missing} group${missing > 1 ? 's' : ''} not available right now)` : ''));
    }
    if (t.dataset.sdel) { setConfirm = t.dataset.sdel; renderSets(); }
    if (t.dataset.sdelno !== undefined) { setConfirm = null; renderSets(); }
    if (t.dataset.sdelyes) { sets = await api('/sets/' + t.dataset.sdelyes, { method: 'DELETE' }); setConfirm = null; renderSets(); }
  });
  $('#setSave').onclick = async () => {
    const name = $('#setName').value.trim();
    if (!selected.size) return toast('Tick some groups first.');
    if (!name) return toast('Give the set a name.');
    const targets = [...selected].map(k => { const [accountId, groupId] = k.split('|'); return { accountId, groupId }; });
    try { sets = await api('/sets', { method: 'POST', body: { name, targets } }); $('#setName').value = ''; renderSets(); toast(`Saved "${name}"`); }
    catch (err) { toast(err.message); }
  };

  // ---------- timing ----------
  const timingIds = ['dMin', 'dMax', 'bSize', 'bPause'];
  try { const t = JSON.parse(localStorage.getItem('wab-timing') || '{}'); timingIds.forEach(id => { if (t[id] != null) $('#' + id).value = t[id]; }); } catch {}
  function timing() {
    const v = id => Number($('#' + id).value);
    let min = v('dMin') || 10, max = v('dMax') || min;
    if (max < min) [min, max] = [max, min];
    return { min, max, batchSize: Math.max(0, Math.round(v('bSize') || 0)), batchPauseMin: v('bPause') || 5 };
  }
  function fmtDur(sec) {
    if (sec < 90) return Math.round(sec) + ' seconds';
    const m = Math.round(sec / 60);
    return m < 90 ? m + ' minutes' : (m / 60).toFixed(1) + ' hours';
  }
  function renderEstimate() {
    const n = selected.size, t = timing();
    if (n < 2) { $('#estimate').textContent = ''; return; }
    const breaks = t.batchSize > 0 ? Math.floor((n - 1) / t.batchSize) : 0;
    const waits = n - 1 - breaks;
    const secs = waits * (t.min + t.max) / 2 + breaks * t.batchPauseMin * 60 + n * 2;
    $('#estimate').textContent = `About ${fmtDur(secs)} for ${n} groups${breaks ? `, including ${breaks} break${breaks > 1 ? 's' : ''}` : ''}.`;
  }
  timingIds.forEach(id => $('#' + id).addEventListener('input', () => {
    try { localStorage.setItem('wab-timing', JSON.stringify(Object.fromEntries(timingIds.map(i => [i, $('#' + i).value])))); } catch {}
    renderEstimate();
  }));
  function localInput(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
  $('#whenMode').addEventListener('change', () => {
    const later = $('#whenMode').value === 'later';
    $('#when').hidden = !later;
    if (later && !$('#when').value) { const d = new Date(Date.now() + 3600000); d.setMinutes(0); $('#when').value = localInput(d); }
    $('#when').min = localInput(new Date());
    renderSendBtn();
  });
  $('#when').addEventListener('input', renderSendBtn);
  function scheduleAt() {
    if ($('#whenMode').value !== 'later') return 0;
    const t = new Date($('#when').value).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  // ---------- templates ----------
  let templates = [];
  async function loadTemplates() { templates = await api('/templates'); renderTemplates(); }
  function renderTemplates() {
    $('#tplList').innerHTML = templates.length
      ? templates.map(t => `<li><span class="grow"><span class="name">${esc(t.title)}</span><span class="clamp">${esc(t.body)}</span></span>
          <button type="button" data-tuse="${t.id}">Use</button><button type="button" class="ghost" data-tdel="${t.id}">Delete</button></li>`).join('')
      : '<li class="small">No templates yet. Write a message, name it below and save it.</li>';
  }
  $('#tplList').onclick = async e => {
    const u = e.target.dataset.tuse, d = e.target.dataset.tdel;
    if (u) { msg.value = templates.find(t => t.id === u).body; renderMsg(); toast('Template loaded'); }
    if (d) { templates = await api('/templates/' + d, { method: 'DELETE' }); renderTemplates(); }
  };
  $('#tplSave').onclick = async () => {
    const title = $('#tplName').value.trim();
    if (!msg.value.trim()) return toast('Write a message first.');
    if (!title) return toast('Give the template a name.');
    templates = await api('/templates', { method: 'POST', body: { title, body: msg.value } });
    $('#tplName').value = ''; renderTemplates(); toast('Template saved');
  };

  // ---------- groups ----------
  let groupData = [];
  const selected = new Set();
  async function loadGroups() {
    try { groupData = await api('/groups'); } catch (e) { return toast(e.message); }
    const valid = new Set(groupData.flatMap(a => a.groups.map(g => key(a.accountId, g.id))));
    [...selected].forEach(k => { if (!valid.has(k)) selected.delete(k); });
    renderGroups();
  }
  function renderGroups() {
    const q = $('#search').value.trim().toLowerCase();
    if (!groupData.length) {
      $('#groupBox').innerHTML = `<div class="empty-state">No connected accounts yet.<br><button type="button" class="primary" data-goto="accounts" style="margin-top:10px">Link a WhatsApp account</button></div>`;
    } else {
      $('#groupBox').innerHTML = groupData.map(a => {
        const gs = a.groups.filter(g => !q || g.name.toLowerCase().includes(q));
        const n = a.groups.filter(g => selected.has(key(a.accountId, g.id))).length;
        return `<div class="acct"><header>
            <span><span class="name">${esc(a.label)}</span> <span class="meta">+${esc(a.phone)} · ${n}/${a.groups.length}</span></span>
            <span class="row"><button type="button" class="ghost" data-all="${a.accountId}">Select all</button><button type="button" class="ghost" data-none="${a.accountId}">Clear</button><button type="button" class="ghost" data-refresh="${a.accountId}">Refresh</button></span>
          </header>
          <ul class="list">${gs.length ? gs.map(g => {
            const k = key(a.accountId, g.id);
            const lock = g.adminsOnly ? (g.isAdmin === false ? '<span class="pill bad" title="Only admins can post here, and this account is not an admin">Can\'t post</span>' : '<span class="pill warn">Admins only</span>') : '';
            return `<li><input type="checkbox" id="c-${esc(k)}" data-k="${esc(k)}" ${selected.has(k) ? 'checked' : ''}>
              <label class="grow" for="c-${esc(k)}"><span class="name">${esc(g.name)}</span><span class="small">${g.size} members</span></label>${lock}</li>`;
          }).join('') : `<li class="small">${a.groups.length ? 'No groups match your search.' : 'This account is not in any groups yet.'}</li>`}</ul></div>`;
      }).join('');
    }
    renderSendBtn();
  }
  $('#search').addEventListener('input', renderGroups);
  $('#groupBox').addEventListener('click', async e => {
    const t = e.target.closest('button,input'); if (!t) return;
    if (t.dataset.goto) return showTab(t.dataset.goto);
    if (t.dataset.k) { t.checked ? selected.add(t.dataset.k) : selected.delete(t.dataset.k); return renderGroups(); }
    const a = groupData.find(x => x.accountId === (t.dataset.all || t.dataset.none || t.dataset.refresh));
    if (!a) return;
    if (t.dataset.all) a.groups.forEach(g => { if (!(g.adminsOnly && g.isAdmin === false)) selected.add(key(a.accountId, g.id)); });
    if (t.dataset.none) a.groups.forEach(g => selected.delete(key(a.accountId, g.id)));
    if (t.dataset.refresh) { try { await api(`/accounts/${a.accountId}/refresh`, { method: 'POST' }); await loadGroups(); toast('Groups refreshed'); } catch (err) { toast(err.message); } return; }
    renderGroups();
  });

  // ---------- send ----------
  let confirming = false;
  function renderSendBtn() {
    const n = selected.size, accts = new Set([...selected].map(k => k.split('|')[0])).size;
    const row = $('#sendRow');
    const hasContent = msg.value.trim() || attachment;
    const at = scheduleAt();
    const badTime = Number.isNaN(at) || (at && at < Date.now() - 60000);
    const whenTxt = at ? ` on ${new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
    if (confirming && n && hasContent && !badTime) {
      row.innerHTML = `<span class="confirm">${at ? 'Schedule' : 'Send'} to <b>${n}</b> group${n > 1 ? 's' : ''} from ${accts} account${accts > 1 ? 's' : ''}${whenTxt}?
        <button class="primary" type="button" id="sendYes">Yes, ${at ? 'schedule' : 'send'}</button><button class="ghost" type="button" id="sendNo">Cancel</button></span>`;
    } else {
      confirming = false;
      const label = !n ? 'Pick groups to send' : !hasContent ? 'Write a message first' : badTime ? 'Pick a future time' : `${at ? 'Schedule for' : 'Send to'} ${n} group${n > 1 ? 's' : ''}`;
      row.innerHTML = `<button class="primary" id="sendBtn" type="button" ${n && hasContent && !badTime ? '' : 'disabled'}>${label}</button>
        ${runningJob && !at ? '<span class="small">Another send is running. This one will start right after it.</span>' : ''}`;
    }
    $('#selCount').textContent = `${n} selected`;
    renderEstimate();
  }
  $('#sendRow').addEventListener('click', async e => {
    if (e.target.id === 'sendBtn') { confirming = true; return renderSendBtn(); }
    if (e.target.id === 'sendNo') { confirming = false; return renderSendBtn(); }
    if (e.target.id === 'sendYes') {
      confirming = false;
      const targets = [...selected].map(k => { const [accountId, groupId] = k.split('|'); return { accountId, groupId }; });
      const at = scheduleAt();
      try {
        const job = await api('/send', { method: 'POST', body: { message: msg.value, targets, delay: timing(), scheduleAt: at || 0, attachment } });
        if (at) toast('Scheduled. Keep the server running until then.');
        else toast(runningJob ? 'Queued. It starts after the current send.' : 'Sending started');
        $('#whenMode').value = 'now'; $('#when').hidden = true;
        refreshJobs(job.id);
      } catch (err) { toast(err.message); renderSendBtn(); }
    }
  });

  // ---------- running / scheduled sends ----------
  let runningJob = null, jobTimer, watchedId = null, lastJobs = [];
  async function refreshJobs(focusId) {
    clearTimeout(jobTimer);
    try { lastJobs = await api('/jobs'); } catch { jobTimer = setTimeout(refreshJobs, 5000); return; }
    if (focusId) watchedId = focusId;
    const running = lastJobs.find(j => j.status === 'running');
    const prev = runningJob;
    runningJob = running || null;
    if (running) watchedId = running.id;
    const watched = lastJobs.find(j => j.id === watchedId);
    if (watched && watched.status !== 'scheduled' && (watched.status === 'running' || !$('#jobPanel').dataset.closed || focusId)) renderJob(watched);
    if (prev && (!running || running.id !== prev.id)) {
      const done = lastJobs.find(j => j.id === prev.id);
      if (done) toast(`Finished: ${done.items.filter(i => i.status === 'sent').length} sent, ${done.items.filter(i => i.status === 'failed').length} failed`);
    }
    renderQueue();
    renderSendBtn();
    const busy = running || lastJobs.some(j => j.status === 'scheduled');
    jobTimer = setTimeout(refreshJobs, running ? 1500 : busy ? 10000 : 30000);
  }
  function renderQueue() {
    const q = lastJobs.filter(j => j.status === 'scheduled').sort((a, b) => a.scheduleAt - b.scheduleAt);
    const p = $('#queuePanel');
    p.hidden = !q.length;
    p.innerHTML = q.length ? `<h2>Waiting to send</h2><ul class="list">${q.map(j => `<li>
        <span class="grow"><span class="name">${j.scheduleAt > Date.now() ? new Date(j.scheduleAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Next in line'} · ${j.items.length} groups</span>
        <span class="clamp">${j.attachment ? '📎 ' + esc(j.attachment.name) + ' · ' : ''}${esc(j.message)}</span></span>
        <button type="button" class="danger" data-cancel="${j.id}">Cancel</button></li>`).join('')}</ul>` : '';
  }
  $('#queuePanel').addEventListener('click', async e => {
    if (e.target.dataset.cancel) { await api(`/jobs/${e.target.dataset.cancel}/cancel`, { method: 'POST' }); toast('Cancelled'); refreshJobs(); }
  });
  let countdown;
  function renderJob(job) {
    const p = $('#jobPanel');
    delete p.dataset.closed;
    const sent = job.items.filter(i => i.status === 'sent').length, failed = job.items.filter(i => i.status === 'failed').length, total = job.items.length;
    const doneN = job.items.filter(i => i.status !== 'pending').length;
    const titles = { running: 'Sending now', done: 'Last send', cancelled: 'Stopped', stopped: 'Interrupted', scheduled: 'Waiting to start' };
    p.hidden = false;
    p.innerHTML = `<div class="row spread"><h2>${titles[job.status] || 'Send'}</h2>
        <span class="row"><span class="meta">${sent} sent · ${failed} failed · ${total} total</span>
        ${job.status === 'running' ? `<button type="button" class="danger" data-cancel="${job.id}">Stop</button>` : `<button type="button" class="ghost" data-close>Hide</button>`}</span></div>
      ${job.status === 'running' ? `<p class="small" style="margin:0" id="nextInfo"></p>` : ''}
      <div class="bar"><i style="width:${total ? (doneN / total) * 100 : 0}%"></i></div>
      <ul class="list">${job.items.map(i => `<li><span class="grow"><span class="name">${esc(i.groupName)}</span><span class="small">${esc(i.accountLabel)}${i.error ? ' · ' + esc(i.error) : ''}</span></span>
        <span class="pill ${i.status === 'sent' ? 'ok' : i.status === 'failed' ? 'bad' : i.status === 'skipped' ? '' : 'warn'}">${{ sent: 'Sent', failed: 'Failed', skipped: 'Skipped', pending: 'Waiting' }[i.status]}</span></li>`).join('')}</ul>`;
    clearInterval(countdown);
    const tickInfo = () => {
      const el = $('#nextInfo'); if (!el) return clearInterval(countdown);
      if (job.nextAt) {
        const s = Math.max(0, Math.round((job.nextAt - Date.now()) / 1000));
        el.textContent = `${job.note || 'Waiting'}: next group in ${s >= 120 ? Math.ceil(s / 60) + ' min' : s + 's'}`;
      } else el.textContent = 'Posting to the next group…';
    };
    if (job.status === 'running') { tickInfo(); countdown = setInterval(tickInfo, 1000); }
  }
  $('#jobPanel').addEventListener('click', async e => {
    if (e.target.dataset.cancel) { await api(`/jobs/${e.target.dataset.cancel}/cancel`, { method: 'POST' }); toast('Stopped'); refreshJobs(); }
    if (e.target.dataset.close !== undefined) { $('#jobPanel').hidden = true; $('#jobPanel').dataset.closed = '1'; }
  });

  // ---------- accounts ----------
  let acctTimer, acctConfirm = null;
  const statusText = {
    starting: ['Starting…', 'warn'], qr: ['Scan the QR code', 'warn'], connected: ['Connected', 'ok'], reconnecting: ['Reconnecting…', 'warn'],
    qr_expired: ['Not linked', ''], logged_out: ['Logged out from phone', 'bad'], error: ['Error', 'bad'],
  };
  async function loadAccounts() {
    clearTimeout(acctTimer);
    let list = [];
    try { list = await api('/accounts'); } catch (e) { toast(e.message); }
    const connected = list.filter(a => a.status === 'connected').length;
    $('#acctBadge').textContent = list.length ? `${connected}/${list.length}` : '';
    $('#acctCards').innerHTML = list.length ? list.map(a => {
      const [txt, cls] = statusText[a.status] || [a.status, ''];
      return `<div class="card">
        <div class="row spread"><span class="name">${esc(a.label)}</span><span class="pill ${cls}">${txt}</span></div>
        ${a.phone ? `<span class="meta">+${esc(a.phone)}${a.name ? ' · ' + esc(a.name) : ''} · ${a.groupCount} groups</span>` : ''}
        ${a.phone ? `<span class="small">Sent today: ${a.sentToday}${dailyLimit ? ' of ' + dailyLimit : ''}</span>` : ''}
        ${a.qr ? `<div class="qr"><img src="${a.qr}" alt="QR code to link ${esc(a.label)}"></div><span class="small">The code changes every ~20 seconds. Scan the newest one.</span>` : ''}
        ${a.status === 'starting' ? '<span class="small">Preparing a QR code…</span>' : ''}
        ${a.error ? `<span class="small">${esc(a.error)}</span>` : ''}
        <div class="row">
          ${['qr_expired', 'logged_out', 'error'].includes(a.status) ? `<button type="button" class="primary" data-relink="${a.id}">Show QR code</button>` : ''}
          ${acctConfirm === a.id
            ? `<span class="confirm">Unlink and remove? <button type="button" class="danger" data-delyes="${a.id}">Remove</button><button type="button" class="ghost" data-delno>Keep</button></span>`
            : `<button type="button" class="ghost" data-del="${a.id}">Remove</button>`}
        </div></div>`;
    }).join('') : '<div class="empty-state">No accounts yet. Give one a name above and tap "Link a new account".</div>';
    const busy = list.some(a => ['starting', 'qr', 'reconnecting'].includes(a.status));
    if (!$('[data-view=accounts]').hidden) acctTimer = setTimeout(loadAccounts, busy ? 2000 : 15000);
  }
  let dailyLimit = 0;
  async function loadSettings() { const s = await api('/settings'); dailyLimit = s.dailyLimit; $('#dailyLimit').value = s.dailyLimit; }
  $('#limitForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { const s = await api('/settings', { method: 'PUT', body: { dailyLimit: Number($('#dailyLimit').value) } }); dailyLimit = s.dailyLimit; $('#dailyLimit').value = s.dailyLimit; toast(s.dailyLimit ? `Limit set to ${s.dailyLimit} a day per account` : 'Daily limit turned off'); loadAccounts(); }
    catch (err) { toast(err.message); }
  });
  $('#addAcct').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/accounts', { method: 'POST', body: { label: $('#acctLabel').value } }); $('#acctLabel').value = ''; loadAccounts(); }
    catch (err) { toast(err.message); }
  });
  $('#acctCards').addEventListener('click', async e => {
    const t = e.target;
    try {
      if (t.dataset.relink) { await api(`/accounts/${t.dataset.relink}/relink`, { method: 'POST' }); }
      if (t.dataset.del) acctConfirm = t.dataset.del;
      if (t.dataset.delno !== undefined) acctConfirm = null;
      if (t.dataset.delyes) { await api('/accounts/' + t.dataset.delyes, { method: 'DELETE' }); acctConfirm = null; toast('Account removed'); }
    } catch (err) { toast(err.message); }
    loadAccounts();
  });

  // ---------- history ----------
  let history = [];
  async function loadHistory() {
    try { history = await api('/jobs'); } catch (e) { return toast(e.message); }
    const label = { running: 'Sending', done: 'Done', cancelled: 'Cancelled', stopped: 'Interrupted', scheduled: 'Scheduled' };
    $('#histList').innerHTML = history.length ? history.map(j => {
      const sent = j.items.filter(i => i.status === 'sent').length, failed = j.items.filter(i => i.status === 'failed').length;
      return `<li><span class="grow" style="gap:4px">
          <span class="row"><span class="meta">${new Date(j.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          <span class="pill ${failed ? 'warn' : 'ok'}">${label[j.status] || j.status}: ${sent}/${j.items.length} sent</span></span>
          <span class="clamp">${j.attachment ? '📎 ' + esc(j.attachment.name) + (j.message ? ' · ' : '') : ''}${esc(j.message)}</span>
          <details><summary class="small">Groups</summary><ul class="list" style="margin-top:6px">${j.items.map(i => `<li><span class="grow"><span>${esc(i.groupName)}</span><span class="small">${esc(i.accountLabel)}${i.error ? ' · ' + esc(i.error) : ''}</span></span><span class="pill ${i.status === 'sent' ? 'ok' : i.status === 'failed' ? 'bad' : ''}">${i.status}</span></li>`).join('')}</ul></details>
        </span><button type="button" data-reuse="${j.id}">Reuse</button></li>`;
    }).join('') : '<li class="small">Nothing sent yet.</li>';
  }
  $('#histList').addEventListener('click', e => {
    const id = e.target.dataset.reuse; if (!id) return;
    const j = history.find(x => x.id === id);
    msg.value = j.message;
    attachment = j.attachment || null; thumbUrl = null;
    selected.clear(); j.items.forEach(i => selected.add(key(i.accountId, i.groupId)));
    renderMsg(); renderAttach(); showTab('send'); toast('Message and groups loaded. Check them, then send.');
  });

  // ---------- start ----------
  renderMsg();
  loadTemplates().catch(() => {});
  loadSets().catch(() => {});
  loadSettings().catch(() => {});
  loadGroups();
  api('/accounts').then(l => { $('#acctBadge').textContent = l.length ? `${l.filter(a => a.status === 'connected').length}/${l.length}` : ''; if (!l.length) showTab('accounts'); }).catch(() => {});
  $('#jobPanel').dataset.closed = '1'; // only show the last send when one is running or just started
  refreshJobs();
})();
