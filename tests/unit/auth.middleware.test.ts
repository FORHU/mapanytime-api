import { Request, Response } from 'express';
import { authenticate, resolveActiveUser } from '../../src/middleware/auth.middleware';
import AuthRepo from '../../src/modules/auth/auth.repository';
import { auth } from '../../src/modules/auth/better-auth';
import { signSessionToken } from '../../src/modules/auth/session-token';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../../src/modules/auth/better-auth', () => ({
  auth: { api: { getSession: jest.fn() } },
  ACCOUNT_BLOCKED_MESSAGE: 'User not found or deactivated',
}));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;
const getSession = auth.api.getSession as unknown as jest.Mock;

const SESSION_TOKEN = 'session-token-1';
const USER = { id: 'user-1', accountStatus: 'ACTIVE' };

/** A token exactly as /login hands it out: the session token plus its signature. */
const LIVE = signSessionToken(SESSION_TOKEN);

/** Minimal Express doubles: capture the status and body a rejection produced. */
const run = async (token?: string) => {
  const req = {
    method: 'GET',
    originalUrl: '/api/v1/protected',
    headers: {},
  } as unknown as Request;
  if (token) req.headers.authorization = `Bearer ${token}`;

  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })), json } as unknown as Response;
  const next = jest.fn();

  await authenticate(req, res, next);

  const statusCall = (res.status as jest.Mock).mock.calls[0];
  return {
    next,
    status: statusCall ? (statusCall[0] as number) : undefined,
    body: json.mock.calls[0]?.[0],
    req,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  getSession.mockResolvedValue({ session: { token: SESSION_TOKEN }, user: { id: USER.id } });
  mockRepo.findUserById.mockResolvedValue(USER as never);
});

describe('authenticate (Better Auth sessions, #122)', () => {
  it('admits a signed token for a live session and attaches the user', async () => {
    const { next, status, req } = await run(LIVE);

    expect(next).toHaveBeenCalled();
    expect(status).toBeUndefined();
    expect(req.user).toEqual(USER);
  });

  it('asks Better Auth about the session with the bearer token', async () => {
    await run(LIVE);

    const headers = getSession.mock.calls[0][0].headers as Headers;
    expect(headers.get('authorization')).toBe(`Bearer ${LIVE}`);
  });

  it('rejects a session that ended — signed out, superseded or expired', async () => {
    // Better Auth answers null for all three; the signature alone is not enough.
    getSession.mockResolvedValue(null);

    const { next, status } = await run(LIVE);

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(401);
  });

  it('rejects a forged token without touching the session store', async () => {
    // The signature is checked offline first, so forgeries cost no database read.
    const { next, status } = await run(`${SESSION_TOKEN}.not-the-signature`);

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects an unsigned session token', async () => {
    // A raw session token (say, read out of the database) is not a credential on
    // its own — Better Auth's bearer plugin runs with requireSignature.
    const { status } = await run(SESSION_TOKEN);

    expect(status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('answers 401 — never 403 or 404 — for a deactivated account', async () => {
    // Clients key their sign-out-and-redirect behaviour off 401 exclusively. This used
    // to be a 404, which neither the web fetcher nor the Flutter interceptor recognised
    // as an auth failure, stranding the user on a dead session.
    mockRepo.findUserById.mockResolvedValue({ ...USER, accountStatus: 'SUSPENDED' } as never);

    const { status, body } = await run(LIVE);

    expect(status).toBe(401);
    expect(body.message).toBe('User not found or deactivated');
  });

  it('answers 401 when the session lookup itself fails', async () => {
    getSession.mockRejectedValue(new Error('db down'));

    const { next, status } = await run(LIVE);

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(401);
  });

  it.each([
    ['no token', undefined],
    ['a JWT from before the switch', 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1In0.c2ln'],
  ])('rejects %s with 401', async (_label, token) => {
    const { next, status } = await run(token as string | undefined);

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(401);
  });

  it('shapes rejections to the ApiError contract clients parse', async () => {
    getSession.mockResolvedValue(null);

    const { body } = await run(LIVE);

    expect(body).toMatchObject({
      status: 'error',
      statusCode: 401,
      message: expect.any(String),
    });
  });
});

describe('resolveActiveUser (socket gateway, F107)', () => {
  it('returns the user for a live session', async () => {
    await expect(resolveActiveUser(LIVE)).resolves.toEqual(USER);
  });

  it('returns null — never throws — for anything else', async () => {
    getSession.mockRejectedValue(new Error('db down'));
    await expect(resolveActiveUser(LIVE)).resolves.toBeNull();
    await expect(resolveActiveUser('forged.sig')).resolves.toBeNull();
  });
});
