import { hashPassword, verifyPassword } from '../../src/utils/password.util';

describe('password.util', () => {
  const plainText = 'MySecureP@ssw0rd!';

  it('should hash a password', async () => {
    const hash = await hashPassword(plainText);
    expect(hash).toBeDefined();
    expect(hash).not.toBe(plainText);
    expect(hash.startsWith('$2b$')).toBe(true); // bcrypt format
  });

  it('should verify a correct password against its hash', async () => {
    const hash = await hashPassword(plainText);
    const isValid = await verifyPassword(plainText, hash);
    expect(isValid).toBe(true);
  });

  it('should reject an incorrect password', async () => {
    const hash = await hashPassword(plainText);
    const isValid = await verifyPassword('WrongPassword', hash);
    expect(isValid).toBe(false);
  });

  it('should produce a unique hash each time', async () => {
    const hash1 = await hashPassword(plainText);
    const hash2 = await hashPassword(plainText);
    expect(hash1).not.toBe(hash2);
  });
});
