// Internal HTTP API used by the Django backend. Never expose this port publicly.
import crypto from 'node:crypto';
import express from 'express';
import config from './config.js';
import { logger } from './logger.js';
import * as sessions from './sessions.js';

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => res.json({ ok: true, sessions: sessions.list().length }));

const keyHash = crypto.createHash('sha256').update(config.apiKey).digest();
app.use((req, res, next) => {
  const given = crypto.createHash('sha256').update(String(req.get('X-Api-Key') || '')).digest();
  if (!crypto.timingSafeEqual(given, keyHash)) return res.status(401).json({ error: 'Invalid API key' });
  next();
});
app.use(express.json({ limit: `${Math.ceil(config.maxBodyMb)}mb` }));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

app.get('/sessions', (req, res) => res.json(sessions.list()));
app.put('/sessions/:id', wrap(async (req, res) => res.json(await sessions.ensure(req.params.id))));
app.get('/sessions/:id', (req, res) => res.json(sessions.get(req.params.id)));
app.post('/sessions/:id/restart', wrap(async (req, res) => res.json(await sessions.restart(req.params.id))));
app.delete('/sessions/:id', wrap(async (req, res) => { await sessions.remove(req.params.id); res.json({ ok: true }); }));
app.post('/sessions/:id/check', wrap(async (req, res) => res.json(await sessions.check(req.params.id, req.body?.numbers))));
app.post('/sessions/:id/send', wrap(async (req, res) => {
  const msg = await sessions.send(req.params.id, req.body || {});
  res.json({ ok: true, messageId: msg?.key?.id || null });
}));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The attachment is too large' });
  const status = err.status || err?.output?.statusCode || 500;
  if (status >= 500) logger.error({ err, path: req.path }, 'request failed');
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: err.message || 'Gateway error' });
});

sessions.restoreAll();
const server = app.listen(config.port, config.host, () => logger.info(`WhatsApp gateway listening on http://${config.host}:${config.port}`));

function shutdown() {
  logger.info('shutting down');
  sessions.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
