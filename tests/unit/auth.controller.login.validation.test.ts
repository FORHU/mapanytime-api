import { Request, Response } from 'express';
import AuthController from '../../src/modules/auth/auth.controller';
import AuthSvc from '../../src/modules/auth/auth.service';

jest.mock('../../src/modules/auth/auth.service');
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const mockSvc = AuthSvc as jest.Mocked<typeof AuthSvc>;

const VALID = { email: 'buyer@example.com', password: 'hunter2', roleName: 'BUYER' };

const post = async (body: unknown) => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })), json } as unknown as Response;
  const next = jest.fn();

  await AuthController.login({ body } as Request, res, next);

  const statusCall = (res.status as jest.Mock).mock.calls[0];
  return {
    next,
    status: statusCall ? (statusCall[0] as number) : undefined,
    body: json.mock.calls[0]?.[0] as { message?: string; details?: Record<string, string[]> },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSvc.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' } as never);
});

describe('AuthController.login validation', () => {
  it('rejects a malformed email with 422 and a per-field message', async () => {
    // 422 is what routes the frontend to inline field errors rather than a toast.
    const { status, body } = await post({ ...VALID, email: 'not-an-email' });

    expect(status).toBe(422);
    expect(body.details?.email?.[0]).toBe('Enter a valid email address.');
    expect(mockSvc.login).not.toHaveBeenCalled();
  });

  it.each([
    ['missing password', { email: VALID.email, roleName: 'BUYER' }],
    ['empty password', { ...VALID, password: '' }],
  ])('rejects %s with 422 naming the password field', async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(422);
    expect(res.body.details).toHaveProperty('password');
    expect(mockSvc.login).not.toHaveBeenCalled();
  });

  it('reports every bad field at once rather than one per round-trip', async () => {
    const { body } = await post({ email: 'nope', password: '', roleName: 'BUYER' });

    expect(Object.keys(body.details ?? {}).sort()).toEqual(['email', 'password']);
  });

  it('rejects an over-long password before it reaches PBKDF2', async () => {
    const { status } = await post({ ...VALID, password: 'x'.repeat(129) });

    expect(status).toBe(422);
    expect(mockSvc.login).not.toHaveBeenCalled();
  });

  it('accepts a weak-but-correct password', async () => {
    // Login validates shape only. Applying the register/reset strength policy here
    // would permanently lock out anyone whose stored password predates it.
    const { status, next } = await post({ ...VALID, password: 'abc' });

    expect(status).toBe(200);
    expect(next).not.toHaveBeenCalled();
    expect(mockSvc.login).toHaveBeenCalled();
  });

  it('ignores unrecognised keys instead of failing the request', async () => {
    // Joi rejects unknown keys by default, which turns an additive client change
    // (a device id, an analytics field) into a login outage for that client.
    const { status } = await post({ ...VALID, deviceId: 'abc-123' });

    expect(status).toBe(200);
    expect(mockSvc.login).toHaveBeenCalledWith(
      expect.not.objectContaining({ deviceId: 'abc-123' }),
    );
  });

  it('normalises the email before the lookup', async () => {
    await post({ ...VALID, email: '  BUYER@Example.COM  ' });

    expect(mockSvc.login).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'buyer@example.com' }),
    );
  });
});
