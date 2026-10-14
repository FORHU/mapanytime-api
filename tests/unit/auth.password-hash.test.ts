import crypto from 'crypto';
import {
  SCRYPT_PREFIX,
  hashPassword,
  isLegacyHash,
  verifyPassword,
} from '../../src/modules/auth/password-hash';

/** A hash exactly as the pre-Better-Auth code wrote it (auth.service.ts register). */
function legacyHash(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

describe('password hashing across the Better Auth migration (#122, F114)', () => {
  it('still accepts every existing PBKDF2 password', async () => {
    const stored = legacyHash('correct horse');
    expect(isLegacyHash(stored)).toBe(true);
    await expect(verifyPassword({ hash: stored, password: 'correct horse' })).resolves.toBe(true);
    await expect(verifyPassword({ hash: stored, password: 'wrong horse' })).resolves.toBe(false);
  });

  it('hashes new passwords with prefixed scrypt, never PBKDF2', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.startsWith(SCRYPT_PREFIX)).toBe(true);
    expect(isLegacyHash(stored)).toBe(false);
    await expect(verifyPassword({ hash: stored, password: 'correct horse' })).resolves.toBe(true);
    await expect(verifyPassword({ hash: stored, password: 'wrong horse' })).resolves.toBe(false);
  });

  it('rejects malformed stored values instead of throwing', async () => {
    for (const hash of ['', 'no-separator', 'abc:not-hex', 'salt:00ff']) {
      await expect(verifyPassword({ hash, password: 'anything' })).resolves.toBe(false);
    }
  });
});
