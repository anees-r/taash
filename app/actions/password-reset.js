'use server';
/**
 * Forgot / reset password. The request step always answers the same way,
 * whether or not the account exists, so it can't be used to discover emails
 * or usernames.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { config } from '@/lib/env';
import { log } from '@/lib/log';
import { createLimiter } from '@/lib/rate-limit';
import { hashPassword } from '@/lib/auth/password';
import { invalidateUser } from '@/lib/auth/user-cache';
import { findAccount, createReset, redeemReset, RESET_MINUTES } from '@/lib/auth/password-reset';
import { sendMail } from '@/lib/mail/mailer';
import { passwordResetEmail } from '@/lib/mail/templates';

const g = globalThis;
const limitForgot = g.__taashForgotLimiter || (g.__taashForgotLimiter = createLimiter({ capacity: 5, perSecond: 1 / 60 }));
const limitReset = g.__taashResetLimiter || (g.__taashResetLimiter = createLimiter({ capacity: 10, perSecond: 0.1 }));
async function clientKey() {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'local';
}

export async function requestPasswordResetAction(_prev, formData) {
  const login = String(formData.get('login') || '').trim().slice(0, 200);
  if (!login) return { error: 'Enter your email or username.', values: { login } };
  if (!limitForgot('f:' + await clientKey())) return { error: 'Too many requests. Wait a few minutes and try again.', values: { login } };
  try {
    const user = await findAccount(login);
    const token = user && await createReset(user.id);
    if (token) {
      const link = config.appUrl + '/reset?token=' + encodeURIComponent(token);
      const sent = await sendMail({ to: user.email, ...passwordResetEmail({ name: user.name, handle: user.handle, link, minutes: RESET_MINUTES }) });
      if (!sent.ok) log.error('password reset email not sent', { userId: user.id });
    }
  } catch (e) {
    log.error('password reset request failed', { err: e.message });
  }
  return { ok: true };
}

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, { message: 'Passwords don’t match.', path: ['confirm'] });

export async function resetPasswordAction(_prev, formData) {
  if (!limitReset('r:' + await clientKey())) return { error: 'Too many attempts. Wait a minute and try again.' };
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: parsed.error.issues[0].path[0] };
  const userId = await redeemReset(parsed.data.token, await hashPassword(parsed.data.password));
  if (!userId) return { error: 'This reset link has expired or was already used. Ask for a new one.', expired: true };
  invalidateUser(userId);
  redirect('/signin?reset=1');
}
