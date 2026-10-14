import pino from 'pino';
import config from './config.js';

export const logger = pino({ level: config.logLevel, base: { svc: 'gateway' } });
export const waLogger = pino({ level: config.waLogLevel, base: { svc: 'baileys' } });
