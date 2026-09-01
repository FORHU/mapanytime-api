import crypto from 'crypto';
import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/cache.util', () => ({
  __esModule: true,
  default: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    users: { update: jest.fn() },
    session: { deleteMany: jest.fn() },
  },
}));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;

const PASSWORD = 'correct-horse-battery-staple';
const SALT = 'a1b2c3d4';

/** Mirrors the storage format the service writes: `<salt>:<pbkdf2 hex>`. */
const hashFor = (password: string) =>
  `${SALT}:${crypto.pbkdf2Sync(password, SALT, 1000, 64, 'sha512').toString('hex')}`;

const USER = {
  id: 'user-1',
  email: 'buyer@example.com',
  passwordHash: hashFor(PASSWORD),
  accountStatus: 'ACTIVE',
  roles: [{ roleName: 'BUYER' }],
};

const loginWith = (over: Partial<{ email: string; password: string }> = {}) =>
  AuthSvc.login({ email: USER.email, password: PASSWORD, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.updateUserLoginStatus.mockResolvedValue(USER as never);
  mockRepo.rotateSession.mockResolvedValue({ id: 'session-1' } as never);
});

describe('AuthSvc.login', () => {
  it('rejects an unknown address and a wrong password with the identical error', async () => {
    // Any difference between these two — status, message, even wording — turns the
    // login form into an oracle for whether an account exists.
    mockRepo.findUserByEmail.mockResolvedValue(null as never);
    const unknown = await loginWith().catch((e) => e);

    mockRepo.findUserByEmail.mockResolvedValue(USER as never);
    const wrongPassword = await loginWith({ password: 'not-the-password' }).catch((e) => e);

    expect(unknown).toEqual(wrongPassword);
    expect(unknown).toMatchObject({ status: 401, message: 'Incorrect email or password.' });
  });

  it('answers 401 for an unknown address, not 404', async () => {
    // 404 would distinguish "no such account" from "wrong password" by status even if
    // the message text matched, and neither client treats 404 as an auth failure.
    mockRepo.findUserByEmail.mockResolvedValue(null as never);

    await expect(loginWith()).rejects.toMatchObject({ status: 401 });
  });

  it('never returns the password hash to the caller', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    const result = (await loginWith()) as { user?: Record<string, unknown> };

    expect(result.user).toBeDefined();
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain(SALT);
  });

  it('rejects an account with no password hash rather than treating it as valid', async () => {
    // A social-only account has no local password; comparing against an empty hash
    // must not become a way in.
    mockRepo.findUserByEmail.mockResolvedValue({ ...USER, passwordHash: null } as never);

    await expect(loginWith()).rejects.toMatchObject({ status: 401 });
  });

  it('accepts the correct password', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await expect(loginWith()).resolves.toBeDefined();
    expect(mockRepo.updateUserLoginStatus).toHaveBeenCalledWith(USER.id);
  });

  it('compares the hash in constant time', async () => {
    // `!==` on a hex digest returns at the first differing byte, so how long the
    // comparison takes reveals how much of the hash the caller guessed right.
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await loginWith();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('runs the KDF even for an unknown address', async () => {
    // The whole point of the dummy salt/hash: bailing out before the PBKDF2 pass
    // would make "no such user" measurably faster than "wrong password".
    const spy = jest.spyOn(crypto, 'pbkdf2Sync');
    mockRepo.findUserByEmail.mockResolvedValue(null as never);

    await loginWith().catch(() => undefined);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('revokes other sessions so only one device stays signed in', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await loginWith();

    expect(mockRepo.rotateSession).toHaveBeenCalledWith(
      expect.objectContaining({ revokeOtherSessions: true }),
    );
  });

  // Guards the crypto.timingSafeEqual call: a corrupt/short stored hash must
  // not throw past the length check and 500 instead of cleanly 401ing.
  it('rejects a truncated stored hash instead of throwing', async () => {
    mockRepo.findUserByEmail.mockResolvedValue({
      ...USER,
      passwordHash: `${SALT}:deadbeef`,
    } as never);

    await expect(loginWith()).rejects.toMatchObject({
      status: 401,
      message: 'Incorrect email or password.',
    });
  });

  // The nastier shape of the same bug: `Buffer.from` stops at the first non-hex
  // character, so this decodes to nothing while still being digest-length as a
  // string. A length check done before decoding would wave it through and let
  // timingSafeEqual throw.
  it('rejects a digest-length non-hex stored hash instead of throwing', async () => {
    mockRepo.findUserByEmail.mockResolvedValue({
      ...USER,
      passwordHash: `${SALT}:${'z'.repeat(128)}`,
    } as never);

    await expect(loginWith()).rejects.toMatchObject({
      status: 401,
      message: 'Incorrect email or password.',
    });
  });

  // A hash with no ':' separator leaves the salt undefined; pbkdf2Sync throws a
  // TypeError on that, which would surface as a 500.
  it('rejects a stored hash with no salt separator instead of throwing', async () => {
    mockRepo.findUserByEmail.mockResolvedValue({ ...USER, passwordHash: 'no-separator' } as never);

    await expect(loginWith()).rejects.toMatchObject({
      status: 401,
      message: 'Incorrect email or password.',
    });
  });
});
