/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Credentials (email or username + password) with Argon2id hashes. Auth.js requires the
 * JWT session strategy for Credentials; to keep real logout / "sign out
 * everywhere" behaviour, each token carries the user's session_version and is
 * rejected as soon as that number changes in the database.
 */
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { sql as dsql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { users, accounts, sessions, verificationTokens } from '../db/schema.js';
import { config } from '../env.js';
import { verifyPassword, dummyVerify } from './password.js';
import { getUserAuthInfo } from './user-cache.js';

const signInSchema = z.object({
  login: z.string().trim().toLowerCase().min(1).max(200),     // email, or username (with or without @)
  password: z.string().min(1).max(200),
});

class BadCredentials extends CredentialsSignin { code = 'bad-credentials'; }

export const SESSION_COOKIE = config.secureCookies ? '__Secure-authjs.session-token' : 'authjs.session-token';

export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth({
  adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }),
  secret: config.authSecret,
  trustHost: true,
  useSecureCookies: config.secureCookies,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/signin' },
  // Wrong passwords are expected; don't fill the logs with their stack traces.
  logger: {
    error(e) { if (e?.type === 'CredentialsSignin' || e?.name === 'CredentialsSignin') return; console.error('[auth]', e?.type || '', e?.message || e); },
    warn(code) { if (code !== 'debug-enabled') console.warn('[auth] warning', code); },
    debug() {},
  },
  providers: [
    Credentials({
      credentials: { login: {}, password: {} },
      async authorize(raw) {
        const parsed = signInSchema.safeParse(raw);
        if (!parsed.success) throw new BadCredentials();
        const { login, password } = parsed.data;
        const byEmail = login.includes('@') && !login.startsWith('@');
        const key = byEmail ? login : login.replace(/^@/, '');
        const [u] = await db.select().from(users)
          .where(byEmail ? dsql`lower(${users.email}) = ${key}` : dsql`lower(${users.handle}) = ${key}`).limit(1);
        if (!u || !u.passwordHash) { await dummyVerify(); throw new BadCredentials(); }
        if (!(await verifyPassword(u.passwordHash, password))) throw new BadCredentials();
        return { id: u.id, name: u.name, email: u.email, handle: u.handle, sv: u.sessionVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id; token.sv = user.sv; token.handle = user.handle; token.name = user.name;
        return token;
      }
      const info = await getUserAuthInfo(token.uid);
      if (!info || info.sv !== token.sv) return null;          // signed out everywhere / deleted
      token.name = info.name; token.handle = info.handle;
      return token;
    },
    session({ session, token }) {
      session.user = { id: token.uid, name: token.name, handle: token.handle, email: session.user?.email };
      return session;
    },
  },
});
