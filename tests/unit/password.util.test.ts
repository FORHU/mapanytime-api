import { hashPassword, verifyPassword } from '../../src/utils/password.util';

/**
 * bcrypt at SALT_ROUNDS = 12 is intentionally slow — a few hundred milliseconds
 * per hash on an idle machine, and several seconds when jest is running many
 * suites in parallel and every worker is competing for CPU.
 *
 * Jest's default 5s timeout is not enough headroom for that. These tests were
 * the intermittent failure recorded in docs/RESUME-HERE.md as "not
 * reproducible": it needs enough parallel load to starve the hash, which is why
 * it showed up under a full run and never in isolation. It is a timeout, not a
 * defect in the hashing — so the fix is headroom, not a lower cost factor.
 */
const BCRYPT_TIMEOUT_MS = 30_000;

describe('password.util', () => {
  const plainText = 'MySecureP@ssw0rd!';

  it(
    'should hash a password',
    async () => {
      const hash = await hashPassword(plainText);
      expect(hash).toBeDefined();
      expect(hash).not.toBe(plainText);
      expect(hash.startsWith('$2b$')).toBe(true); // bcrypt format
    },
    BCRYPT_TIMEOUT_MS,
  );

  it(
    'should verify a correct password against its hash',
    async () => {
      const hash = await hashPassword(plainText);
      const isValid = await verifyPassword(plainText, hash);
      expect(isValid).toBe(true);
    },
    BCRYPT_TIMEOUT_MS,
  );

  it(
    'should reject an incorrect password',
    async () => {
      const hash = await hashPassword(plainText);
      const isValid = await verifyPassword('WrongPassword', hash);
      expect(isValid).toBe(false);
    },
    BCRYPT_TIMEOUT_MS,
  );

  it(
    'should produce a unique hash each time',
    async () => {
      const hash1 = await hashPassword(plainText);
      const hash2 = await hashPassword(plainText);
      expect(hash1).not.toBe(hash2);
    },
    BCRYPT_TIMEOUT_MS,
  );
});
