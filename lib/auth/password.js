/** Password hashing with Argon2id (prebuilt native binaries, no compiler needed on Windows or Alpine). */
import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended Argon2id baseline, sized for a small home server (~19 MiB, ~50 ms).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(plain) { return hash(plain, OPTS); }
export async function verifyPassword(hashed, plain) {
  if (!hashed) return false;
  try { return await verify(hashed, plain); } catch { return false; }
}
/** Spend comparable time when the email is unknown, so timing does not reveal which emails have accounts. */
let dummy;
export async function dummyVerify() {
  dummy ??= hashPassword('no-account-' + Math.random());
  await verifyPassword(await dummy, 'wrong-password');
}
