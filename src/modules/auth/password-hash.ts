import crypto from 'crypto';
import { hashPassword as scryptHash, verifyPassword as scryptVerify } from 'better-auth/crypto';

/**
 * Password hashing for Better Auth (#122), across two formats.
 *
 * Before Better Auth, every password was PBKDF2-SHA512 at 1,000 iterations,
 * stored as `salt:hash` (hex). That iteration count is far below current
 * guidance (F114), so new hashes use Better Auth's scrypt instead — but every
 * existing account still has to sign in with the password it already has, so
 * the legacy format stays verifiable. A legacy hash is replaced with scrypt the
 * next time its owner signs in (see the sign-in hook in better-auth.ts).
 *
 * Better Auth's scrypt output is also `hex-salt:hex-key` with the same lengths
 * as the legacy hashes, so the two cannot be told apart by shape. New hashes
 * carry an explicit prefix; anything without it is legacy PBKDF2.
 */
export const SCRYPT_PREFIX = '$scrypt$';

const LEGACY_ITERATIONS = 1000;
const LEGACY_KEY_LENGTH = 64;

export const isLegacyHash = (hash: string) => !hash.startsWith(SCRYPT_PREFIX);

export async function hashPassword(password: string): Promise<string> {
  return SCRYPT_PREFIX + (await scryptHash(password));
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!isLegacyHash(hash)) {
    return scryptVerify({ hash: hash.slice(SCRYPT_PREFIX.length), password });
  }
  return verifyLegacyPbkdf2(hash, password);
}

function verifyLegacyPbkdf2(stored: string, password: string): boolean {
  const [salt, storedHex] = stored.split(':');
  if (!salt || !storedHex) return false;
  const expected = Buffer.from(storedHex, 'hex');
  if (expected.length !== LEGACY_KEY_LENGTH) return false;
  const computed = crypto.pbkdf2Sync(
    password,
    salt,
    LEGACY_ITERATIONS,
    LEGACY_KEY_LENGTH,
    'sha512',
  );
  return crypto.timingSafeEqual(expected, computed);
}
