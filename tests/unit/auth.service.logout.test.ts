import AuthSvc from '../../src/modules/auth/auth.service';
import CacheUtil from '../../src/utils/cache.util';
import { prisma } from '../../src/utils/prisma';

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
  prisma: { authSession: { deleteMany: jest.fn() } },
}));
jest.mock('../../src/modules/auth/better-auth', () => ({
  auth: {},
  ACCOUNT_BLOCKED_MESSAGE: 'User not found or deactivated',
}));

const deleteSessions = prisma.authSession.deleteMany as unknown as jest.Mock;
const USER_ID = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
  deleteSessions.mockResolvedValue({ count: 1 });
});

/**
 * Logout is idempotent by contract. The Flutter client treats any non-401, non-network
 * error here as a failure and deliberately keeps the user signed in, so a logout that
 * errored on an already-dead session would leave mobile users with a Logout button that
 * can never succeed.
 */
describe('AuthSvc.logout (Better Auth, #122)', () => {
  it("ends the user's sessions", async () => {
    await expect(AuthSvc.logout(USER_ID)).resolves.toBeDefined();

    expect(deleteSessions).toHaveBeenCalledWith({ where: { userId: USER_ID } });
  });

  it('succeeds when there is no session left to end', async () => {
    deleteSessions.mockResolvedValue({ count: 0 });

    await expect(AuthSvc.logout(USER_ID)).resolves.toBeDefined();
  });

  it('is safe to call twice', async () => {
    await AuthSvc.logout(USER_ID);
    deleteSessions.mockResolvedValue({ count: 0 });
    await expect(AuthSvc.logout(USER_ID)).resolves.toBeDefined();
  });

  it('drops the cached user so a stale copy cannot outlive the session', async () => {
    await AuthSvc.logout(USER_ID);

    expect(CacheUtil.del).toHaveBeenCalledWith(`user:${USER_ID}`);
  });

  it('propagates a genuine failure to end the session rather than reporting success', async () => {
    // Idempotency is about an already-dead session. If the delete itself fails, the
    // session really is still alive and saying "logged out" would be a lie.
    deleteSessions.mockRejectedValue(new Error('db down'));

    await expect(AuthSvc.logout(USER_ID)).rejects.toThrow('db down');
  });
});

describe('AuthSvc.refreshToken (retired with JWT)', () => {
  it('always answers 401, which sends an older client back to login', async () => {
    await expect(AuthSvc.refreshToken()).rejects.toMatchObject({ status: 401 });
  });
});
