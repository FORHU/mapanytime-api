import AuthRepo from '../../src/modules/auth/auth.repository';
import { prisma } from '../../src/utils/prisma';
import CacheUtil from '../../src/utils/cache.util';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    users: { findFirst: jest.fn() },
  },
}));

jest.mock('../../src/utils/cache.util');

/**
 * Guards the single-active-device policy.
 *
 * `authenticate` compares the token's `sessionId` against `user.activeSessionId` on every
 * request, and it gets that user from `AuthRepo.findUserById`. The comparison is only meaningful
 * if the read is fresh: a cached user carries whichever `activeSessionId` was current when the
 * entry was written, so a token revoked by a newer login (or by logout, which nulls the field)
 * would keep working until the cache expired.
 *
 * Nothing about `findUserById`'s signature communicates that, which makes "wrap this in
 * CacheUtil like the other reads" a natural and silent regression. These tests fail loudly if
 * anyone does.
 */
describe('AuthRepo.findUserById', () => {
  const mockUser = {
    id: 'user-1',
    email: 'someone@example.com',
    accountStatus: 'ACTIVE',
    activeSessionId: 'session-abc',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
  });

  it('reads straight from the database', async () => {
    const result = await AuthRepo.findUserById('user-1');

    expect(prisma.users.findFirst).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockUser);
  });

  it('filters to ACTIVE accounts by id', async () => {
    await AuthRepo.findUserById('user-1');

    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1', accountStatus: 'ACTIVE' },
      }),
    );
  });

  it('returns activeSessionId, which authenticate compares against the token', async () => {
    const result = await AuthRepo.findUserById('user-1');

    // If this drops out of the selection, the session check silently compares against undefined.
    expect(result).toHaveProperty('activeSessionId', 'session-abc');
  });

  it('does not serve the user from CacheUtil', async () => {
    // Self-check: assert these really are mocks, so the expectations below can't pass vacuously
    // if the automock ever stops covering static methods.
    expect(jest.isMockFunction(CacheUtil.get)).toBe(true);
    expect(jest.isMockFunction(CacheUtil.set)).toBe(true);

    await AuthRepo.findUserById('user-1');

    // Any caching here breaks single-active-device enforcement — see the block comment above.
    expect(CacheUtil.get).not.toHaveBeenCalled();
    expect(CacheUtil.set).not.toHaveBeenCalled();
  });

  it('hits the database again on a second call rather than reusing a first result', async () => {
    await AuthRepo.findUserById('user-1');
    await AuthRepo.findUserById('user-1');

    expect(prisma.users.findFirst).toHaveBeenCalledTimes(2);
  });
});
