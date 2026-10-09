/**
 * Outgoing email. Brevo's transactional API is the main route; if it is not
 * configured or fails, Gmail through nodemailer (with an app password) is the
 * fallback. In development with neither configured, the message is printed to
 * the server console instead so flows like "forgot password" can be tested.
 */
import 'server-only';
import nodemailer from 'nodemailer';
import { config } from '../env.js';
import { log } from '../log.js';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
let gmail = null;

async function viaBrevo({ to, subject, html, text }) {
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': config.mail.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: config.mail.from, name: config.mail.fromName },
      to: [{ email: to }],
      subject, htmlContent: html, textContent: text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('Brevo answered ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
}

async function viaGmail({ to, subject, html, text }) {
  gmail ||= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.mail.gmailUser, pass: config.mail.gmailAppPassword },
    connectionTimeout: 10_000, socketTimeout: 15_000,
  });
  // Gmail only sends as the signed-in account (or its aliases).
  await gmail.sendMail({ from: { name: config.mail.fromName, address: config.mail.gmailUser }, to, subject, html, text });
}

/**
 * @param {{to:string, subject:string, html:string, text:string}} msg
 * @returns {Promise<{ok:boolean, via?:'brevo'|'gmail'|'console'}>}
 */
export async function sendMail(msg) {
  if (config.mail.brevoApiKey && config.mail.from) {
    try { await viaBrevo(msg); return { ok: true, via: 'brevo' }; }
    catch (e) { log.warn('brevo send failed, trying gmail', { err: e.message }); }
  }
  if (config.mail.gmailUser && config.mail.gmailAppPassword) {
    try { await viaGmail(msg); return { ok: true, via: 'gmail' }; }
    catch (e) { log.error('gmail send failed', { err: e.message }); }
  }
  if (!config.isProd && !config.mail.brevoApiKey && !config.mail.gmailUser) {
    // Development only, nothing configured: show the message so the flow can be tried.
    console.log('\n[mail] (not sent: no mailer configured)\nTo: ' + msg.to + '\nSubject: ' + msg.subject + '\n\n' + msg.text + '\n');
    return { ok: true, via: 'console' };
  }
  log.error('email could not be sent', { subject: msg.subject });
  return { ok: false };
}
