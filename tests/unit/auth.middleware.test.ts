import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { authenticate } from '../../src/middleware/auth.middleware';
import AuthRepo from '../../src/modules/auth/auth.repository';
import { ACCESS_TOKEN_SECRET } from '../../src/config';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;

const SESSION_ID = 'session-1';
const USER = { id: 'user-1', accountStatus: 'ACTIVE', activeSessionId: SESSION_ID };

const sign = (payload: Record<string, unknown>) =>
  jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: '1h' });

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

beforeEach(() => jest.clearAllMocks());

describe('authenticate', () => {
  it('admits a token whose session is still the active one', async () => {
    mockRepo.findUserById.mockResolvedValue(USER as never);

    const { next, status } = await run(sign({ userId: USER.id, sessionId: SESSION_ID }));

    expect(next).toHaveBeenCalled();
    expect(status).toBeUndefined();
  });

  it('rejects a token whose session was superseded or logged out', async () => {
    mockRepo.findUserById.mockResolvedValue({ ...USER, activeSessionId: null } as never);

    const { next, status } = await run(sign({ userId: USER.id, sessionId: SESSION_ID }));

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(401);
  });

  it('rejects a token that carries no sessionId at all', async () => {
    // These predate the single-active-device policy and used to be waved through, which
    // meant logging out did not actually stop them for the rest of their 7-day life —
    // the one hole in "logout destroys the session".
    mockRepo.findUserById.mockResolvedValue(USER as never);

    const { next, status } = await run(sign({ userId: USER.id }));

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(401);
  });

  it('answers 401 — never 403 or 404 — for a deactivated account', async () => {
    // Clients key their sign-out-and-redirect behaviour off 401 exclusively. This used
    // to be a 404, which neither the web fetcher nor the Flutter interceptor recognised
    // as an auth failure, stranding the user on a dead session.
    mockRepo.findUserById.mockResolvedValue({ ...USER, accountStatus: 'SUSPENDED' } as never);

    const { status } = await run(sign({ userId: USER.id, sessionId: SESSION_ID }));

    expect(status).toBe(401);
  });

  it.each([
    ['no token', undefined],
    ['a malformed token', 'not-a-jwt'],
    ['a token signed with the wrong secret', jwt.sign({ userId: 'u' }, 'wrong-secret')],
  ])('rejects %s with 401', async (_label, token) => {
    mockRepo.findUserById.mockResolvedValue(USER as never);

    const { next, status } = await run(token as string | undefined);

    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(401);
  });

  it('shapes rejections to the ApiError contract clients parse', async () => {
    mockRepo.findUserById.mockResolvedValue(USER as never);

    const { body } = await run(sign({ userId: USER.id }));

    expect(body).toMatchObject({
      status: 'error',
      statusCode: 401,
      message: expect.any(String),
    });
  });
});
