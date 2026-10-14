// Runs sends. One send runs at a time; others wait in line (or until their scheduled time).
const crypto = require('crypto');
const store = require('./store');
const wa = require('./wa');

const MAX_HISTORY = 300;
let history = store.read('history.json', []);
let current = null;

// Anything that was mid-send when the server stopped can't continue.
for (const j of history) {
  if (j.status === 'running') {
    j.status = 'stopped';
    j.nextAt = null;
    j.items.forEach(i => { if (i.status === 'pending') i.status = 'skipped'; });
  }
}
save();

function save() {
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  store.write('history.json', history);
}

// ---------- daily limit per account ----------
function today() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the server's time zone
}
function counts() {
  const c = store.read('counters.json', {});
  return c.date === today() ? c : { date: today(), byAccount: {} };
}
function bump(accountId) {
  const c = counts();
  c.byAccount[accountId] = (c.byAccount[accountId] || 0) + 1;
  store.write('counters.json', c);
}
function sentToday(accountId) {
  return counts().byAccount[accountId] || 0;
}

// ---------- create / cancel ----------
function create({ message, targets, delay, scheduleAt, attachment, groupInfo }) {
  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    createdAt: Date.now(),
    scheduleAt: scheduleAt || Date.now(),
    message,
    attachment: attachment || null, // { id, name, type, size }
    delay, // { min, max, batchSize, batchPauseMin }
    status: 'scheduled',
    nextAt: null,
    note: null,
    items: targets.map(t => ({
      accountId: t.accountId,
      groupId: t.groupId,
      accountLabel: groupInfo(t)?.accountLabel || '',
      groupName: groupInfo(t)?.groupName || t.groupId,
      status: 'pending',
      error: null,
      at: null,
    })),
  };
  history.unshift(job);
  save();
  tick();
  return job;
}

function cancel(id) {
  const job = history.find(j => j.id === id);
  if (!job) return null;
  if (job.status === 'running' || job.status === 'scheduled') {
    job.status = 'cancelled';
    job.nextAt = null;
    job.items.forEach(i => { if (i.status === 'pending') i.status = 'skipped'; });
    save();
  }
  return job;
}

// ---------- runner ----------
function tick() {
  if (current) return;
  const due = history
    .filter(j => j.status === 'scheduled' && j.scheduleAt <= Date.now())
    .sort((a, b) => a.scheduleAt - b.scheduleAt)[0];
  if (due) run(due).catch(e => console.error('send failed', e));
}
setInterval(tick, 10000);

// Sleep that wakes early if the send is cancelled.
async function wait(job, ms, note) {
  job.nextAt = Date.now() + ms;
  job.note = note;
  save();
  const end = Date.now() + ms;
  while (Date.now() < end && job.status === 'running') {
    await new Promise(r => setTimeout(r, Math.min(1000, end - Date.now())));
  }
  job.nextAt = null;
  job.note = null;
}

const rand = (min, max) => min + Math.random() * (max - min);

async function run(job) {
  current = job;
  job.status = 'running';
  job.startedAt = Date.now();
  save();
  const settings = store.read('settings.json', { dailyLimit: 0 });
  const { min, max, batchSize, batchPauseMin } = job.delay;
  let sentInBatch = 0;

  for (let i = 0; i < job.items.length; i++) {
    if (job.status !== 'running') break;
    const item = job.items[i];

    if (settings.dailyLimit > 0 && sentToday(item.accountId) >= settings.dailyLimit) {
      item.status = 'skipped';
      item.error = `Daily limit of ${settings.dailyLimit} reached for this account`;
      item.at = Date.now();
      save();
      continue;
    }

    try {
      await wa.send(item.accountId, item.groupId, { text: job.message, attachment: job.attachment });
      item.status = 'sent';
      bump(item.accountId);
      sentInBatch++;
    } catch (e) {
      item.status = 'failed';
      item.error = String(e?.message || e).slice(0, 200);
    }
    item.at = Date.now();
    save();

    const more = job.items.slice(i + 1).some(x => x.status === 'pending');
    if (!more || job.status !== 'running') continue;

    if (batchSize > 0 && sentInBatch >= batchSize) {
      sentInBatch = 0;
      await wait(job, batchPauseMin * 60000, `Break after ${batchSize} groups`);
    } else {
      await wait(job, rand(min, max) * 1000, 'Pause before next group');
    }
  }

  if (job.status === 'running') job.status = 'done';
  job.finishedAt = Date.now();
  current = null;
  save();
  setTimeout(tick, 1000); // start the next one in line, if any
}

module.exports = {
  create,
  cancel,
  get: id => history.find(j => j.id === id),
  list: () => history.slice(0, 100),
  sentToday,
};
