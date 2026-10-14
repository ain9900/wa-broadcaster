// Fire-and-forget event delivery to the backend, with a few retries if it is restarting.
import config from './config.js';
import { logger } from './logger.js';

async function deliver(body, attempt = 1) {
  try {
    const r = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    if (attempt >= 5) return logger.warn({ err: e.message, event: body.event }, 'webhook delivery failed');
    setTimeout(() => deliver(body, attempt + 1), 2000 * attempt);
  }
}

export function emit(event, session, data) {
  deliver({ event, session, data, at: Date.now() });
}
