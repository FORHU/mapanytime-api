import { APIError } from 'better-auth/api';
import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';
import { auth } from '../../src/modules/auth/better-auth';
import { verifySessionToken } from '../../src/modules/auth/session-token';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/cache.util', () => ({
  __esModule: true,
  default: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock('../../src/modules/auth/better-auth', () => ({
  auth: { api: { signInEmail: jest.fn() } },
  ACCOUNT_BLOCKED_MESSAGE: 'User not found or deactivated',
}));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;
const signInEmail = auth.api.signInEmail as unknown as jest.Mock;

const PASSWORD = 'correct-horse-battery-staple';
const SESSION_TOKEN = 'session-token-abc';

const USER = {
  id: 'user-1',
  email: 'buyer@example.com',
  passwordHash: 'legacy-salt:legacy-hash',
  accountStatus: 'ACTIVE',
  roles: [{ roleName: 'BUYER' }],
};

const loginWith = (over: Partial<{ email: string; password: string }> = {}) =>
  AuthSvc.login({ email: USER.email, password: PASSWORD, ...over });

/** What Better Auth throws for a wrong password or an unknown address alike. */
const invalidCredentials = () =>
  new APIError('UNAUTHORIZED', { message: 'Invalid email or password' });

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.updateUserLoginStatus.mockResolvedValue(USER as never);
  signInEmail.mockResolvedValue({ token: SESSION_TOKEN, user: { id: USER.id } });
});

describe('AuthSvc.login (Better Auth, #122)', () => {
  it('rejects an unknown address and a wrong password with the identical error', async () => {
    // Any difference between these two — status, message, even wording — turns the
    // login form into an oracle for whether an account exists.
    signInEmail.mockRejectedValueOnce(invalidCredentials());
    const unknown = await loginWith({ email: 'nobody@example.com' }).catch((e) => e);

    signInEmail.mockRejectedValueOnce(invalidCredentials());
    const wrongPassword = await loginWith({ password: 'not-the-password' }).catch((e) => e);

    expect(unknown).toEqual(wrongPassword);
    expect(unknown).toMatchObject({ status: 401, message: 'Incorrect email or password.' });
  });

  it('answers 401 for any sign-in failure, never 404 or 500', async () => {
    // Even an unexpected error from Better Auth must not reveal more than "no".
    signInEmail.mockRejectedValueOnce(new Error('something internal'));

    await expect(loginWith()).rejects.toMatchObject({
      status: 401,
      message: 'Incorrect email or password.',
    });
  });

  it('tells a blocked account apart only after a correct password', async () => {
    // Better Auth checks the password first; the session hook refuses the blocked
    // account afterwards, so this message is never reachable without the password.
    signInEmail.mockRejectedValueOnce(
      new APIError('UNAUTHORIZED', { message: 'User not found or deactivated' }),
    );

    await expect(loginWith()).rejects.toMatchObject({
      status: 401,
      message: 'User not found or deactivated',
    });
  });

  it('returns a signed bearer token for the new session, and no refresh token', async () => {
    const result = (await loginWith()) as Record<string, unknown>;

    expect(typeof result.accessToken).toBe('string');
    // The signature verifies offline, and wraps exactly the session Better Auth made.
    expect(verifySessionToken(result.accessToken as string)).toBe(SESSION_TOKEN);
    expect(result).not.toHaveProperty('refreshToken');
    expect(mockRepo.updateUserLoginStatus).toHaveBeenCalledWith(USER.id);
  });

  it('never returns password material to the caller', async () => {
    const result = (await loginWith()) as { user?: Record<string, unknown> };

    expect(result.user).toBeDefined();
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('legacy-hash');
  });

  it('hands Better Auth only the email and password', async () => {
    await AuthSvc.login({ email: USER.email, password: PASSWORD, roleName: 'BUYER' });

    expect(signInEmail).toHaveBeenCalledWith({
      body: { email: USER.email, password: PASSWORD },
    });
  });
});
