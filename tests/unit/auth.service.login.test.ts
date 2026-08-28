import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';
import crypto from 'crypto';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/cache.util', () => ({
  __esModule: true,
  default: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;

const PASSWORD = 'correct-horse-battery-staple';
const SALT = 'fixed-test-salt';
const HASH = crypto.pbkdf2Sync(PASSWORD, SALT, 1000, 64, 'sha512').toString('hex');
const USER = { id: 'user-1', email: 'buyer@example.com', passwordHash: `${SALT}:${HASH}` };

describe('AuthSvc.login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.updateUserLoginStatus.mockResolvedValue(USER as never);
    mockRepo.rotateSession.mockResolvedValue({ id: 'session-1' } as never);
  });

  it('logs in with the right password', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    const result = await AuthSvc.login({ email: USER.email, password: PASSWORD });

    expect(result.accessToken).toBeDefined();
    expect(mockRepo.updateUserLoginStatus).toHaveBeenCalledWith(USER.id);
  });

  it('rejects a wrong password with a generic message', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await expect(
      AuthSvc.login({ email: USER.email, password: 'wrong-password' }),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
  });

  // Same status/message as a wrong password — a different one here would let a
  // caller enumerate which emails are registered.
  it('rejects an unknown email with the same generic message', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(null as never);

    await expect(
      AuthSvc.login({ email: 'nobody@example.com', password: PASSWORD }),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    expect(mockRepo.updateUserLoginStatus).not.toHaveBeenCalled();
  });

  // Guards the crypto.timingSafeEqual call: a corrupt/short stored hash must
  // not throw past the length check and 500 instead of cleanly 401ing.
  it('rejects a malformed stored hash instead of throwing', async () => {
    mockRepo.findUserByEmail.mockResolvedValue({
      ...USER,
      passwordHash: `${SALT}:deadbeef`,
    } as never);

    await expect(AuthSvc.login({ email: USER.email, password: PASSWORD })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    });
  });
});
