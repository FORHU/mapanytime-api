import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/s3.util');
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
    authAccount: { upsert: jest.fn() },
  },
}));
jest.mock('../../src/modules/auth/better-auth', () => ({
  auth: {},
  ACCOUNT_BLOCKED_MESSAGE: 'User not found or deactivated',
}));
jest.mock('../../src/modules/auth/session-token', () => ({
  startSession: jest.fn().mockResolvedValue('mock-session-token'),
}));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;

describe('AuthSvc — social login and role connection', () => {
  const tx = {
    users: { create: jest.fn() },
    buyers: { create: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx));
  });

  it('uses connectOrCreate for the BUYER role when creating a new social buyer', async () => {
    mockRepo.findUserByEmail
      .mockResolvedValueOnce(null) // first check: user does not exist
      .mockResolvedValueOnce({
        id: 'user-new',
        email: 'social.buyer@example.com',
        accountStatus: 'ACTIVE',
        roles: [{ roleName: 'BUYER' }],
      } as any);

    tx.users.create.mockResolvedValue({ id: 'user-new' });
    tx.buyers.create.mockResolvedValue({ id: 'buyer-new' });

    // Call private findOrCreateSocialBuyer via reflection
    const user = await (AuthSvc as any).findOrCreateSocialBuyer({
      email: 'social.buyer@example.com',
      firstName: 'Social',
      lastName: 'User',
    });

    expect(user.id).toBe('user-new');
    expect(tx.users.create).toHaveBeenCalledTimes(1);
    const createData = tx.users.create.mock.calls[0][0].data;

    expect(createData.roles).toEqual({
      connectOrCreate: [
        {
          where: { roleName: 'BUYER' },
          create: {
            roleName: 'BUYER',
            description: 'Buyer account for map discovery and local checkout',
          },
        },
      ],
    });
    expect(tx.buyers.create).toHaveBeenCalledWith({
      data: { userId: 'user-new', displayName: 'Social User' },
    });
  });

  it('reuses existing user without transaction when user already exists', async () => {
    mockRepo.findUserByEmail.mockResolvedValueOnce({
      id: 'existing-user-id',
      email: 'existing@example.com',
      accountStatus: 'ACTIVE',
      roles: [{ roleName: 'BUYER' }],
    } as any);

    const user = await (AuthSvc as any).findOrCreateSocialBuyer({
      email: 'existing@example.com',
    });

    expect(user.id).toBe('existing-user-id');
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(tx.users.create).not.toHaveBeenCalled();
  });
});
