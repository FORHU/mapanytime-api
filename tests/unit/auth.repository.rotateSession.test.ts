import AuthRepo from '../../src/modules/auth/auth.repository';
import { prisma } from '../../src/utils/prisma';

const tx = {
  session: {
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  users: { update: jest.fn() },
};

jest.mock('../../src/utils/prisma', () => ({
  prisma: { $transaction: jest.fn() },
}));

jest.mock('../../src/utils/cache.util');

/**
 * Guards repeat social sign-in.
 *
 * Session has `@@unique([provider, providerUserId])` and rows are never deleted, so a second
 * Facebook/Google login by the same account used to collide with its own earlier session and
 * surface as "A record with these details already exists". rotateSession must free the pair
 * before creating the new row.
 */
describe('AuthRepo.rotateSession', () => {
  const base = {
    userId: 'user-1',
    jti: 'jti-new',
    refreshTokenHash: 'hash',
    familyId: 'family-1',
    expiresAt: new Date('2030-01-01'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    tx.session.create.mockResolvedValue({ id: 'session-new' });
  });

  it('clears the provider id from earlier sessions before creating the new one', async () => {
    await AuthRepo.rotateSession({ ...base, provider: 'facebook', providerUserId: 'fb-123' });

    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { provider: 'facebook', providerUserId: 'fb-123' },
      data: { providerUserId: null },
    });
    const clearOrder = tx.session.updateMany.mock.invocationCallOrder[0];
    const createOrder = tx.session.create.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(createOrder);
    expect(tx.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'facebook', providerUserId: 'fb-123' }),
      }),
    );
  });

  it('leaves other sessions alone for a password login with no provider id', async () => {
    await AuthRepo.rotateSession(base);

    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(tx.session.create).toHaveBeenCalledTimes(1);
  });
});
