/**
 * Tiny structured logger. Never pass tokens, passwords, cookies or hands here.
 */
import { config } from './env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[config.logLevel] ?? 20;

function write(level, msg, fields) {
  if (LEVELS[level] < min) return;
  const line = { t: new Date().toISOString(), level, msg, ...fields };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(config.isProd ? JSON.stringify(line) : `[${level}] ${msg}${fields ? ' ' + JSON.stringify(fields) : ''}`);
}

export const log = {
  debug: (m, f) => write('debug', m, f),
  info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f),
  error: (m, f) => write('error', m, f),
};
