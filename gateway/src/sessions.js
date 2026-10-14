// One Baileys socket per WhatsApp account. Logins are saved in SESSIONS_DIR/<id> so they survive restarts.
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import config from './config.js';
import { logger, waLogger } from './logger.js';
import * as webhook from './webhook.js';

fs.mkdirSync(config.sessionsDir, { recursive: true });
const sessions = new Map(); // id -> runtime state
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

let waVersion = null;
async function getVersion() {
  if (waVersion) return waVersion;
  try {
    ({ version: waVersion } = await fetchLatestBaileysVersion());
  } catch {
    // fall back to the version bundled with the library
  }
  return waVersion;
}

const dirOf = id => path.join(config.sessionsDir, id);
const isLinked = id => fs.existsSync(path.join(dirOf(id), 'creds.json'));

function view(s) {
  return {
    id: s.id,
    status: s.status, // starting | qr | connected | reconnecting | disconnected | logged_out | error
    qr: s.status === 'qr' ? s.qr : null,
    phone: s.phone,
    name: s.name,
    error: s.error,
  };
}

function setStatus(s, status, extra = {}) {
  const changed = s.status !== status || Object.entries(extra).some(([k, v]) => s[k] !== v);
  Object.assign(s, extra, { status });
  if (changed) webhook.emit('session.status', s.id, { status, phone: s.phone, name: s.name, error: s.error });
}

async function connect(s) {
  s.stopped = false;
  s.error = '';
  setStatus(s, 'starting');
  const dir = dirOf(s.id);
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const version = await getVersion();

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: waLogger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  s.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (s.sock !== sock) return; // an older socket we already replaced

    if (qr) {
      try {
        s.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        if (s.sock === sock && s.status !== 'connected') setStatus(s, 'qr');
      } catch (e) {
        logger.warn({ err: e }, 'QR render failed');
      }
    }

    if (connection === 'open') {
      const me = sock.user || {};
      s.qr = null;
      s.retries = 0;
      setStatus(s, 'connected', {
        phone: String(me.id || '').split(':')[0].split('@')[0],
        name: me.name || me.verifiedName || '',
      });
      logger.info({ session: s.id, phone: s.phone }, 'connected');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      s.sock = null;
      s.qr = null;

      if (code === DisconnectReason.loggedOut) {
        // Removed from the phone (Linked devices > Log out). The saved login is useless now.
        fs.rmSync(dir, { recursive: true, force: true });
        setStatus(s, 'logged_out');
        return;
      }
      if (s.stopped) return;

      // Nobody scanned the QR in time: stop, so we don't make new codes forever.
      if (!state.creds.registered && code === DisconnectReason.timedOut) {
        setStatus(s, 'disconnected');
        return;
      }

      s.retries = (s.retries || 0) + 1;
      setStatus(s, 'reconnecting');
      const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(30000, 1000 * 2 ** Math.min(s.retries, 5));
      setTimeout(() => {
        if (!s.stopped && !s.sock) connect(s).catch(e => fail(s, e));
      }, wait);
    }
  });
}

function fail(s, e) {
  s.sock = null;
  setStatus(s, 'error', { error: String(e?.message || e).slice(0, 300) });
  logger.error({ err: e, session: s.id }, 'session failed to start');
}

function make(id) {
  const s = { id, status: 'disconnected', qr: null, phone: '', name: '', error: '', retries: 0, sock: null };
  sessions.set(id, s);
  return s;
}

function stop(s) {
  s.stopped = true;
  try { s.sock?.end(undefined); } catch {}
  s.sock = null;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function need(id) {
  const s = sessions.get(id);
  if (!s) throw httpError(404, 'Session not found');
  return s;
}

function needConnected(id) {
  const s = need(id);
  if (s.status !== 'connected' || !s.sock) throw httpError(409, 'This WhatsApp account is not connected');
  return s;
}

// ---------------- public API ----------------

export function restoreAll() {
  for (const id of fs.readdirSync(config.sessionsDir)) {
    if (!ID_RE.test(id) || !isLinked(id)) continue;
    const s = make(id);
    connect(s).catch(e => fail(s, e));
  }
  logger.info({ count: sessions.size }, 'restored sessions');
}

export async function ensure(id) {
  if (!ID_RE.test(id)) throw httpError(400, 'Invalid session id');
  const s = sessions.get(id) || make(id);
  if (!s.sock && !['connected', 'reconnecting'].includes(s.status)) await connect(s);
  return view(s);
}

export async function restart(id) {
  if (!ID_RE.test(id)) throw httpError(400, 'Invalid session id');
  const s = sessions.get(id) || make(id);
  if (s.status === 'connected') return view(s);
  stop(s);
  await connect(s);
  return view(s);
}

export async function remove(id) {
  const s = sessions.get(id);
  if (s) {
    s.stopped = true;
    try {
      if (s.status === 'connected') await s.sock.logout(); // also removes it from the phone's Linked devices
    } catch {}
    stop(s);
    sessions.delete(id);
  }
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function send(id, { to, text = '', media, typing = true }) {
  const s = needConnected(id);
  if (!/@(s\.whatsapp\.net|lid)$/.test(String(to))) throw httpError(400, 'Invalid recipient');
  const sock = s.sock;

  if (typing) {
    // Show "typing…" briefly, like a person would.
    try {
      await sock.sendPresenceUpdate('composing', to);
      await sleep(800 + Math.random() * 1500);
      await sock.sendPresenceUpdate('paused', to);
    } catch {}
  }

  if (!media) {
    if (!text.trim()) throw httpError(400, 'Nothing to send');
    return sock.sendMessage(to, { text });
  }

  const buf = Buffer.from(String(media.base64 || ''), 'base64');
  if (!buf.length) throw httpError(400, 'The attachment is empty');
  const type = media.mimetype || 'application/octet-stream';
  const caption = text || undefined;

  if (type.startsWith('image/') && type !== 'image/gif') return sock.sendMessage(to, { image: buf, caption });
  if (type.startsWith('video/') || type === 'image/gif') {
    return sock.sendMessage(to, { video: buf, caption, gifPlayback: type === 'image/gif' });
  }
  if (type.startsWith('audio/')) {
    // Audio can't carry a caption, so the text goes as its own message first.
    if (text) await sock.sendMessage(to, { text });
    return sock.sendMessage(to, { audio: buf, mimetype: type });
  }
  return sock.sendMessage(to, { document: buf, mimetype: type, fileName: media.filename || 'file', caption });
}

/** Which of these phone numbers (international digits) have WhatsApp, and the chat id to use for each.
 *  All numbers go to WhatsApp in one query. */
export async function check(id, numbers = []) {
  const s = needConnected(id);
  if (!Array.isArray(numbers) || !numbers.length || numbers.length > 50) throw httpError(400, 'Send 1 to 50 numbers');
  const digits = numbers.map(n => String(n).replace(/\D/g, ''));
  const valid = digits.filter(d => d.length >= 8 && d.length <= 15);
  const hits = valid.length ? (await s.sock.onWhatsApp(...valid.map(d => `${d}@s.whatsapp.net`))) || [] : [];
  const found = new Map();
  for (const h of hits) if (h?.exists) found.set(String(h.jid).split('@')[0].split(':')[0], h.jid);
  return digits.map(d => ({ number: d, exists: found.has(d), jid: found.get(d) || null }));
}

export function list() {
  return [...sessions.values()].map(view);
}

export function get(id) {
  return view(need(id));
}

export function shutdown() {
  for (const s of sessions.values()) stop(s);
}
