import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';
import { publish } from '../../src/infrastructure/rabbitmq/publisher';
import { prisma } from '../../src/utils/prisma';
import crypto from 'crypto';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/infrastructure/rabbitmq/publisher', () => ({ publish: jest.fn() }));
jest.mock('../../src/utils/cache.util', () => ({
  __esModule: true,
  default: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    passwordResetTokens: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    users: { update: jest.fn() },
    session: { deleteMany: jest.fn() },
  },
}));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;
const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  passwordResetTokens: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  users: { update: jest.Mock };
  session: { deleteMany: jest.Mock };
};

const USER = { id: 'user-1', email: 'buyer@example.com', passwordHash: 'salt:hash' };
const hashOf = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

/**
 * The Flutter client shipped `forgot_password_page` and `reset_password_page`
 * against endpoints that did not exist, so a locked-out user had two screens
 * and no way through. See FLAGS.md ID-6.
 */
describe('AuthSvc.requestPasswordReset', () => {
  beforeEach(() => jest.clearAllMocks());

  it('issues a code and emails it to a known address', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await AuthSvc.requestPasswordReset(USER.email);

    expect(mockPrisma.passwordResetTokens.create).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      'email.send.requested',
      expect.objectContaining({ email: USER.email }),
    );
  });

  // Answering differently for a known address turns this into an email
  // enumeration oracle for any unauthenticated caller.
  it('answers identically for an address that does not exist', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);
    const known = await AuthSvc.requestPasswordReset(USER.email);

    jest.clearAllMocks();
    mockRepo.findUserByEmail.mockResolvedValue(null as never);
    const unknown = await AuthSvc.requestPasswordReset('nobody@example.com');

    expect(unknown).toEqual(known);
    expect(mockPrisma.passwordResetTokens.create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  // Two live codes would leave the user unsure which one to type.
  it('retires any code already outstanding', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await AuthSvc.requestPasswordReset(USER.email);

    expect(mockPrisma.passwordResetTokens.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  // A leaked database row must not be a working code.
  it('stores the code hashed, never in plaintext', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await AuthSvc.requestPasswordReset(USER.email);

    const stored = mockPrisma.passwordResetTokens.create.mock.calls[0][0].data.codeHash;
    const emailed = (publish as jest.Mock).mock.calls[0][1].body.match(/code is (\d{4})/)![1];

    expect(stored).not.toContain(emailed);
    expect(stored).toBe(hashOf(emailed));
  });

  it('issues a 4-digit code, matching the client OTP field', async () => {
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);

    await AuthSvc.requestPasswordReset(USER.email);

    const emailed = (publish as jest.Mock).mock.calls[0][1].body.match(/code is (\d{4})/);
    expect(emailed).not.toBeNull();
  });
});

describe('AuthSvc.resetPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.findUserByEmail.mockResolvedValue(USER as never);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        passwordResetTokens: { update: jest.fn() },
        users: { update: jest.fn() },
        session: { deleteMany: jest.fn() },
      }),
    );
  });

  function givenToken(overrides: Record<string, unknown> = {}) {
    mockPrisma.passwordResetTokens.findFirst.mockResolvedValue({
      id: 'tok-1',
      userId: USER.id,
      codeHash: hashOf('1234'),
      attempts: 0,
      ...overrides,
    });
  }

  it('accepts the right code and resets the password', async () => {
    givenToken();

    const result = await AuthSvc.resetPassword({
      email: USER.email,
      code: '1234',
      newPassword: 'a-new-password',
    });

    expect(result.message).toMatch(/reset/i);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('rejects a wrong code and counts the attempt', async () => {
    givenToken();

    await expect(
      AuthSvc.resetPassword({ email: USER.email, code: '9999', newPassword: 'a-new-password' }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockPrisma.passwordResetTokens.update).toHaveBeenCalledWith({
      where: { id: 'tok-1' },
      data: { attempts: { increment: 1 } },
    });
  });

  // 4 digits is 10,000 possibilities — walkable in seconds without a ceiling.
  it('burns the code once the attempt budget is spent', async () => {
    givenToken({ attempts: 5 });

    await expect(
      AuthSvc.resetPassword({ email: USER.email, code: '1234', newPassword: 'a-new-password' }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockPrisma.passwordResetTokens.update).toHaveBeenCalledWith({
      where: { id: 'tok-1' },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('rejects when no live code exists', async () => {
    mockPrisma.passwordResetTokens.findFirst.mockResolvedValue(null);

    await expect(
      AuthSvc.resetPassword({ email: USER.email, code: '1234', newPassword: 'a-new-password' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  // Only unexpired, unconsumed codes are even considered.
  it('looks only at codes that are still live', async () => {
    givenToken();

    await AuthSvc.resetPassword({
      email: USER.email,
      code: '1234',
      newPassword: 'a-new-password',
    });

    const where = mockPrisma.passwordResetTokens.findFirst.mock.calls[0][0].where;
    expect(where.consumedAt).toBeNull();
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  // A reset that left an attacker's existing session alive has locked them out
  // of nothing.
  it('signs every device out on success', async () => {
    givenToken();
    const session = { deleteMany: jest.fn() };
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        passwordResetTokens: { update: jest.fn() },
        users: { update: jest.fn() },
        session,
      }),
    );

    await AuthSvc.resetPassword({
      email: USER.email,
      code: '1234',
      newPassword: 'a-new-password',
    });

    expect(session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER.id } });
  });

  it('gives the same error for an unknown address as for a bad code', async () => {
    givenToken();
    const badCode = await AuthSvc.resetPassword({
      email: USER.email,
      code: '9999',
      newPassword: 'a-new-password',
    }).catch((e) => e);

    mockRepo.findUserByEmail.mockResolvedValue(null as never);
    const unknownUser = await AuthSvc.resetPassword({
      email: 'nobody@example.com',
      code: '1234',
      newPassword: 'a-new-password',
    }).catch((e) => e);

    expect(unknownUser).toEqual(badCode);
  });
});
