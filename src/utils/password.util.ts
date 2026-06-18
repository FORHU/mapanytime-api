import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * Hash a plain-text password.
 * Usage: const hashed = await hashPassword(plainText);
 */
export const hashPassword = (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare a plain-text password against a stored hash.
 * Usage: const isValid = await verifyPassword(plain, hash);
 */
export const verifyPassword = (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};
