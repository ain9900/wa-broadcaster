require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const store = require('./store');
const wa = require('./wa');
const jobs = require('./jobs');

const PASSWORD = process.env.ADMIN_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
if (!PASSWORD || PASSWORD === 'change-me-to-a-long-password' || !SECRET || SECRET === 'replace-with-a-random-string') {
  console.error('\nSet ADMIN_PASSWORD and SESSION_SECRET in your .env file first (see .env.example).\n');
  process.exit(1);
}
const MAX_UPLOAD_MB = 25;
fs.mkdirSync(wa.UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1); // behind Nginx on the VPS
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  next();
});
app.use(
  session({
    name: 'wab.sid',
    secret: SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

const authed = (req, res, next) => (req.session?.ok ? next() : res.status(401).json({ error: 'Please log in.' }));
const wrap = fn => (req, res) =>
  Promise.resolve(fn(req, res)).catch(e => res.status(e.status || 500).json({ error: e.message || 'Something went wrong.' }));

// ---------- file upload (raw body, before the small JSON parser) ----------
app.post(
  '/api/upload',
  authed,
  express.raw({ type: () => true, limit: MAX_UPLOAD_MB + 'mb' }),
  wrap(async (req, res) => {
    if (!req.body?.length) return res.status(400).json({ error: 'The file is empty.' });
    const id = crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(path.join(wa.UPLOAD_DIR, id), req.body);
    const name = decodeURIComponent(String(req.get('X-File-Name') || 'file')).replace(/[\\/]/g, '_').slice(0, 120);
    const type = String(req.get('Content-Type') || 'application/octet-stream').split(';')[0];
    res.json({ id, name, type, size: req.body.length });
  })
);

app.use(express.json({ limit: '200kb' }));

// ---------- login ----------
const attempts = new Map(); // ip -> { n, until }
function safeEqual(a, b) {
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

app.post('/login', (req, res) => {
  const ip = req.ip;
  const rec = attempts.get(ip) || { n: 0, until: 0 };
  if (rec.until > Date.now()) return res.status(429).json({ error: 'Too many wrong passwords. Try again in 10 minutes.' });
  if (!safeEqual(req.body?.password || '', PASSWORD)) {
    rec.n += 1;
    if (rec.n >= 5) { rec.until = Date.now() + 10 * 60 * 1000; rec.n = 0; }
    attempts.set(ip, rec);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  attempts.delete(ip);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.ok = true;
    res.json({ ok: true });
  });
});

app.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// ---------- pages ----------
const pub = p => path.join(__dirname, 'public', p);
app.get('/', (req, res) => (req.session?.ok ? res.sendFile(pub('index.html')) : res.redirect('/login')));
app.get('/login', (req, res) => (req.session?.ok ? res.redirect('/') : res.sendFile(pub('login.html'))));
app.use('/assets', express.static(pub('assets'), { maxAge: '1h' }));

// ---------- API ----------
const api = express.Router();
api.use(authed);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

api.get('/accounts', (req, res) => res.json(wa.list()));
api.post('/accounts', wrap(async (req, res) => res.json(await wa.add(String(req.body?.label || '').trim().slice(0, 60)))));
api.patch('/accounts/:id', wrap(async (req, res) => res.json(wa.rename(req.params.id, req.body?.label))));
api.post('/accounts/:id/relink', wrap(async (req, res) => res.json(await wa.relink(req.params.id))));
api.post('/accounts/:id/refresh', wrap(async (req, res) => res.json(await wa.refreshGroups(req.params.id))));
api.delete('/accounts/:id', wrap(async (req, res) => { await wa.remove(req.params.id); res.json({ ok: true }); }));

api.get('/groups', (req, res) => res.json(wa.groups()));

api.post('/send', wrap(async (req, res) => {
  const b = req.body || {};
  const message = String(b.message || '');
  const targets = Array.isArray(b.targets) ? b.targets : [];
  const attachment = b.attachment && /^[a-f0-9]{16}$/.test(b.attachment.id) && fs.existsSync(path.join(wa.UPLOAD_DIR, b.attachment.id))
    ? { id: b.attachment.id, name: String(b.attachment.name || 'file').slice(0, 120), type: String(b.attachment.type || ''), size: num(b.attachment.size, 0) }
    : null;
  if (!message.trim() && !attachment) return res.status(400).json({ error: 'Write a message or attach a file first.' });
  if (message.length > 60000) return res.status(400).json({ error: 'That message is too long for WhatsApp.' });
  if (!targets.length) return res.status(400).json({ error: 'Pick at least one group.' });

  const d = b.delay || {};
  let min = clamp(num(d.min, 8), 3, 600);
  let max = clamp(num(d.max, 15), 3, 600);
  if (max < min) [min, max] = [max, min];
  const delay = { min, max, batchSize: clamp(Math.round(num(d.batchSize, 0)), 0, 500), batchPauseMin: clamp(num(d.batchPauseMin, 5), 1, 240) };

  let scheduleAt = num(b.scheduleAt, 0);
  if (scheduleAt && scheduleAt < Date.now() - 60000) return res.status(400).json({ error: 'The scheduled time is in the past.' });
  if (!scheduleAt) scheduleAt = Date.now();

  const index = new Map();
  for (const a of wa.groups()) for (const g of a.groups) index.set(a.accountId + '|' + g.id, { accountLabel: a.label, groupName: g.name });
  const clean = targets
    .map(t => ({ accountId: String(t.accountId), groupId: String(t.groupId) }))
    .filter(t => index.has(t.accountId + '|' + t.groupId));
  if (!clean.length) return res.status(400).json({ error: 'Those groups are no longer available. Refresh and try again.' });

  res.json(jobs.create({ message, targets: clean, delay, scheduleAt, attachment, groupInfo: t => index.get(t.accountId + '|' + t.groupId) }));
}));

api.get('/jobs', (req, res) => res.json(jobs.list()));
api.get('/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); j ? res.json(j) : res.status(404).json({ error: 'Not found' }); });
api.post('/jobs/:id/cancel', (req, res) => res.json(jobs.cancel(req.params.id) || {}));

// settings (daily limit per account; 0 = no limit)
api.get('/settings', (req, res) => res.json(store.read('settings.json', { dailyLimit: 0 })));
api.put('/settings', (req, res) => {
  const s = { dailyLimit: clamp(Math.round(num(req.body?.dailyLimit, 0)), 0, 10000) };
  store.write('settings.json', s);
  res.json(s);
});

// saved group sets
api.get('/sets', (req, res) => res.json(store.read('sets.json', [])));
api.post('/sets', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const targets = (Array.isArray(req.body?.targets) ? req.body.targets : [])
    .map(t => ({ accountId: String(t.accountId), groupId: String(t.groupId) }))
    .slice(0, 2000);
  if (!name || !targets.length) return res.status(400).json({ error: 'A set needs a name and at least one group.' });
  const list = store.read('sets.json', []).filter(s => s.name.toLowerCase() !== name.toLowerCase());
  list.unshift({ id: crypto.randomBytes(5).toString('hex'), name, targets });
  store.write('sets.json', list);
  res.json(list);
});
api.delete('/sets/:id', (req, res) => {
  const list = store.read('sets.json', []).filter(s => s.id !== req.params.id);
  store.write('sets.json', list);
  res.json(list);
});

// templates
api.get('/templates', (req, res) => res.json(store.read('templates.json', [])));
api.post('/templates', (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 80);
  const body = String(req.body?.body || '');
  if (!title || !body.trim()) return res.status(400).json({ error: 'A template needs a name and text.' });
  const list = store.read('templates.json', []);
  list.unshift({ id: crypto.randomBytes(5).toString('hex'), title, body });
  store.write('templates.json', list);
  res.json(list);
});
api.delete('/templates/:id', (req, res) => {
  const list = store.read('templates.json', []).filter(t => t.id !== req.params.id);
  store.write('templates.json', list);
  res.json(list);
});

app.use('/api', api);

// Errors from body parsing (e.g. a file that's too big)
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: `Files can be up to ${MAX_UPLOAD_MB} MB.` });
  res.status(err?.status || 500).json({ error: err?.message || 'Something went wrong.' });
});

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
wa.init().then(() => {
  app.listen(PORT, HOST, () => console.log(`Announcement sender running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
});
