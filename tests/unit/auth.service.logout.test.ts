import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';
import CacheUtil from '../../src/utils/cache.util';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/cache.util', () => ({
  __esModule: true,
  default: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;
const USER_ID = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.updateActiveSession.mockResolvedValue({} as never);
  mockRepo.deleteSession.mockResolvedValue({ count: 0 } as never);
});

/**
 * Logout is idempotent by contract. The Flutter client treats any non-401, non-network
 * error here as a failure and deliberately keeps the user signed in, so a rejection for
 * a stale refresh token would leave mobile users with a Logout button that can never
 * succeed — and under single-active-device, a stale refresh token is the normal case.
 */
describe('AuthSvc.logout', () => {
  it('clears the active session when no refresh token is supplied', async () => {
    await expect(AuthSvc.logout(USER_ID)).resolves.toBeDefined();

    expect(mockRepo.updateActiveSession).toHaveBeenCalledWith(USER_ID, null);
    expect(mockRepo.deleteSession).not.toHaveBeenCalled();
  });

  it('succeeds when the refresh token matches no session row', async () => {
    mockRepo.deleteSession.mockResolvedValue({ count: 0 } as never);

    await expect(AuthSvc.logout(USER_ID, 'already-revoked-token')).resolves.toBeDefined();

    expect(mockRepo.updateActiveSession).toHaveBeenCalledWith(USER_ID, null);
  });

  it('is safe to call twice', async () => {
    await AuthSvc.logout(USER_ID, 'token');
    await expect(AuthSvc.logout(USER_ID, 'token')).resolves.toBeDefined();

    expect(mockRepo.updateActiveSession).toHaveBeenCalledTimes(2);
  });

  it('kills the active session before tidying up the refresh row', async () => {
    // Clearing activeSessionId is the authoritative revocation — authenticate() checks
    // it on every request. If the refresh-row delete runs first and fails, the old order
    // left a fully live session behind.
    const order: string[] = [];
    mockRepo.updateActiveSession.mockImplementation(async () => {
      order.push('updateActiveSession');
      return {} as never;
    });
    mockRepo.deleteSession.mockImplementation(async () => {
      order.push('deleteSession');
      return { count: 1 } as never;
    });

    await AuthSvc.logout(USER_ID, 'token');

    expect(order).toEqual(['updateActiveSession', 'deleteSession']);
  });

  it('drops the cached user so a stale copy cannot outlive the session', async () => {
    await AuthSvc.logout(USER_ID, 'token');

    expect(CacheUtil.del).toHaveBeenCalledWith(`user:${USER_ID}`);
  });

  it('propagates a genuine failure to revoke rather than reporting success', async () => {
    // The idempotency above is about stale *input*. If the revocation itself fails, the
    // session really is still alive and saying "logged out" would be a lie.
    mockRepo.updateActiveSession.mockRejectedValue(new Error('db down') as never);

    await expect(AuthSvc.logout(USER_ID, 'token')).rejects.toThrow('db down');
  });
});
