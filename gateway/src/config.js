import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', '..', '.env') });

const config = {
  host: process.env.GATEWAY_HOST || '127.0.0.1',
  port: Number(process.env.GATEWAY_PORT || 3100),
  apiKey: process.env.GATEWAY_API_KEY || '',
  // Where the gateway reports connection changes (the Django backend).
  webhookUrl: process.env.GATEWAY_WEBHOOK_URL || 'http://127.0.0.1:8000/api/whatsapp/webhook/',
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || path.join(here, '..', 'sessions')),
  logLevel: process.env.LOG_LEVEL_GATEWAY || 'info',
  waLogLevel: process.env.WA_LOG_LEVEL || 'warn',
  maxBodyMb: Number(process.env.MAX_UPLOAD_MB || 25) * 1.4 + 1, // base64 is ~4/3 the size of the file
};

if (!config.apiKey || config.apiKey.startsWith('change-me')) {
  console.error('\nSet GATEWAY_API_KEY in .env first (see .env.example).\n');
  process.exit(1);
}

export default config;
