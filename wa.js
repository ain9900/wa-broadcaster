// Manages linked WhatsApp accounts. Each account is one WhatsApp Web-style login,
// saved in data/sessions/<id> so it survives restarts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const store = require('./store');

const SESS_DIR = path.join(store.DATA_DIR, 'sessions');
fs.mkdirSync(SESS_DIR, { recursive: true });

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });
const accounts = new Map(); // id -> runtime state

let waVersion = null;
async function getVersion() {
  if (waVersion) return waVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
  } catch {
    // fall back to the version bundled with the library
  }
  return waVersion;
}

function saveList() {
  store.write(
    'accounts.json',
    [...accounts.values()].map(a => ({ id: a.id, label: a.label, createdAt: a.createdAt }))
  );
}

function countToday(id) {
  const c = store.read('counters.json', {});
  return c.date === new Date().toLocaleDateString('en-CA') ? c.byAccount?.[id] || 0 : 0;
}

function publicView(a) {
  return {
    id: a.id,
    label: a.label,
    createdAt: a.createdAt,
    status: a.status, // starting | qr | connected | reconnecting | qr_expired | logged_out | error
    qr: a.status === 'qr' ? a.qrDataUrl : null,
    phone: a.phone,
    name: a.name,
    error: a.error,
    groupCount: a.groups.length,
    groupsAt: a.groupsAt,
    sentToday: countToday(a.id),
  };
}

async function start(acc) {
  acc.stopped = false;
  acc.error = null;
  acc.status = 'starting';
  const dir = path.join(SESS_DIR, acc.id);
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const version = await getVersion();

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  acc.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async update => {
    if (acc.sock !== sock) return; // an older socket we already replaced
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      acc.status = 'qr';
      acc.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    }

    if (connection === 'open') {
      acc.status = 'connected';
      acc.qrDataUrl = null;
      acc.retries = 0;
      const me = sock.user || {};
      acc.phone = String(me.id || '').split(':')[0].split('@')[0];
      acc.name = me.name || me.verifiedName || '';
      acc.myIds = [me.id, me.lid].filter(Boolean).map(j => jidNormalizedUser(j));
      refreshGroups(acc).catch(e => logger.warn({ err: e }, 'group fetch failed'));
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone (Linked devices > Log out). Old login is useless now.
        acc.status = 'logged_out';
        acc.sock = null;
        acc.groups = [];
        fs.rmSync(dir, { recursive: true, force: true });
        return;
      }
      if (acc.stopped) return;

      // Nobody scanned the QR in time: stop, so we don't make new codes forever.
      if (!state.creds.registered && code === DisconnectReason.timedOut) {
        acc.status = 'qr_expired';
        acc.sock = null;
        acc.qrDataUrl = null;
        return;
      }

      acc.status = 'reconnecting';
      acc.retries = (acc.retries || 0) + 1;
      const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(30000, 1000 * 2 ** Math.min(acc.retries, 5));
      setTimeout(() => {
        if (!acc.stopped) start(acc).catch(e => fail(acc, e));
      }, wait);
    }
  });

  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(() => refreshGroups(acc).catch(() => {}), 3000); };
  sock.ev.on('groups.update', soon);
  sock.ev.on('groups.upsert', soon);
  sock.ev.on('group-participants.update', soon);
}

function fail(acc, e) {
  acc.status = 'error';
  acc.error = String(e?.message || e);
  logger.error({ err: e, account: acc.id }, 'account failed to start');
}

async function refreshGroups(acc) {
  if (!acc.sock || acc.status !== 'connected') throw new Error('Account is not connected');
  const all = await acc.sock.groupFetchAllParticipating();
  acc.groups = Object.values(all)
    .map(g => {
      const meP = (g.participants || []).find(p => acc.myIds?.includes(jidNormalizedUser(p.id)));
      return {
        id: g.id,
        name: g.subject || '(no name)',
        size: g.participants?.length || g.size || 0,
        adminsOnly: !!g.announce, // only admins can post
        isAdmin: meP ? !!meP.admin : null, // null = couldn't tell
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  acc.groupsAt = Date.now();
  return acc.groups;
}

function makeAccount({ id, label, createdAt }) {
  return { id, label, createdAt, status: 'starting', groups: [], groupsAt: null, qrDataUrl: null, phone: '', name: '', retries: 0 };
}

// --- public API ---

async function init() {
  for (const saved of store.read('accounts.json', [])) {
    const acc = makeAccount(saved);
    accounts.set(acc.id, acc);
    const linked = fs.existsSync(path.join(SESS_DIR, acc.id, 'creds.json'));
    if (linked) start(acc).catch(e => fail(acc, e));
    else acc.status = 'qr_expired'; // never finished linking; user can ask for a new QR
  }
}

async function add(label) {
  const acc = makeAccount({ id: crypto.randomBytes(6).toString('hex'), label: label || 'WhatsApp account', createdAt: Date.now() });
  accounts.set(acc.id, acc);
  saveList();
  start(acc).catch(e => fail(acc, e));
  return publicView(acc);
}

async function relink(id) {
  const acc = get(id);
  if (acc.status === 'connected') return publicView(acc);
  acc.stopped = true;
  try { acc.sock?.end(undefined); } catch {}
  acc.sock = null;
  await start(acc);
  return publicView(acc);
}

async function remove(id) {
  const acc = get(id);
  acc.stopped = true;
  try {
    if (acc.status === 'connected') await acc.sock.logout(); // also removes it from the phone's Linked devices
  } catch {}
  try { acc.sock?.end(undefined); } catch {}
  fs.rmSync(path.join(SESS_DIR, id), { recursive: true, force: true });
  accounts.delete(id);
  saveList();
}

function rename(id, label) {
  const acc = get(id);
  acc.label = String(label || '').slice(0, 60) || acc.label;
  saveList();
  return publicView(acc);
}

function get(id) {
  const acc = accounts.get(id);
  if (!acc) {
    const e = new Error('Account not found');
    e.status = 404;
    throw e;
  }
  return acc;
}

function list() {
  return [...accounts.values()].map(publicView);
}

function groups() {
  return [...accounts.values()]
    .filter(a => a.status === 'connected')
    .map(a => ({ accountId: a.id, label: a.label, phone: a.phone, groups: a.groups }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const UPLOAD_DIR = path.join(store.DATA_DIR, 'uploads');

// attachment: { id, name, type } saved by the upload endpoint in data/uploads/<id>
async function send(accountId, groupId, { text, attachment }) {
  const acc = get(accountId);
  if (acc.status !== 'connected' || !acc.sock) throw new Error(`${acc.label} is not connected`);

  // Show "typing…" briefly, like a person would.
  try {
    await acc.sock.sendPresenceUpdate('composing', groupId);
    await sleep(800 + Math.random() * 1500);
    await acc.sock.sendPresenceUpdate('paused', groupId);
  } catch {}

  if (!attachment) {
    await acc.sock.sendMessage(groupId, { text });
    return;
  }

  const file = path.join(UPLOAD_DIR, path.basename(attachment.id));
  if (!fs.existsSync(file)) throw new Error('The attached file is missing on the server');
  const type = attachment.type || 'application/octet-stream';
  const caption = text || undefined;

  if (type.startsWith('image/') && type !== 'image/gif') {
    await acc.sock.sendMessage(groupId, { image: { url: file }, caption });
  } else if (type.startsWith('video/') || type === 'image/gif') {
    await acc.sock.sendMessage(groupId, { video: { url: file }, caption, gifPlayback: type === 'image/gif' });
  } else if (type.startsWith('audio/')) {
    // Audio can't carry a caption, so the text goes as its own message first.
    if (text) await acc.sock.sendMessage(groupId, { text });
    await acc.sock.sendMessage(groupId, { audio: { url: file }, mimetype: type });
  } else {
    await acc.sock.sendMessage(groupId, { document: { url: file }, mimetype: type, fileName: attachment.name || 'file', caption });
  }
}

module.exports = { init, add, relink, remove, rename, list, groups, refreshGroups: id => refreshGroups(get(id)), send, UPLOAD_DIR };
