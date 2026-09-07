import jwt from 'jsonwebtoken';
import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';
import { REFRESH_TOKEN_SECRET } from '../../src/config';

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
const JTI = 'jti-1';
const FAMILY = 'fam-1';

const signedToken = (claims: Record<string, unknown> = {}) =>
  jwt.sign({ userId: USER_ID, jti: JTI, familyId: FAMILY, ...claims }, REFRESH_TOKEN_SECRET, {
    expiresIn: '30d',
  });

const sessionRow = { jti: JTI, familyId: FAMILY, provider: 'local' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.findUserById.mockResolvedValue({ id: USER_ID, roles: [] } as never);
  mockRepo.rotateSession.mockResolvedValue({ id: 'session-2' } as never);
  mockRepo.revokeFamily.mockResolvedValue(3 as never);
});

/**
 * The refresh path is the one place a stolen credential can be turned into indefinite
 * access, so these cases are about what happens when a token comes back twice — not
 * about the happy path, which is one line of it.
 */
describe('AuthSvc.refreshToken', () => {
  it('rotates when the token is claimed, carrying the family forward', async () => {
    mockRepo.claimRefreshSession.mockResolvedValue({
      outcome: 'claimed',
      session: sessionRow,
    } as never);

    const result = await AuthSvc.refreshToken(signedToken());

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');

    // A new family per rotation would leave every chain one link long, which is the
    // same as having no reuse detection at all.
    expect(mockRepo.rotateSession).toHaveBeenCalledWith(
      expect.objectContaining({ familyId: FAMILY, replacesJti: JTI }),
    );
  });

  it('never hands the raw token to the repository', async () => {
    mockRepo.claimRefreshSession.mockResolvedValue({
      outcome: 'claimed',
      session: sessionRow,
    } as never);

    const token = signedToken();
    await AuthSvc.refreshToken(token);

    // The point of F100: what reaches storage is a hash and an identifier, never the
    // credential. A 64-char hex digest, and not the token itself.
    const claimArg = mockRepo.claimRefreshSession.mock.calls[0][0];
    expect(claimArg.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(claimArg.tokenHash).not.toBe(token);

    const rotateArg = mockRepo.rotateSession.mock.calls[0][0];
    expect(rotateArg.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rotateArg)).not.toContain(token);
  });

  it('revokes the family when a consumed token is replayed', async () => {
    mockRepo.claimRefreshSession.mockResolvedValue({
      outcome: 'replayed',
      session: sessionRow,
    } as never);

    await expect(AuthSvc.refreshToken(signedToken())).rejects.toMatchObject({ status: 401 });

    expect(mockRepo.revokeFamily).toHaveBeenCalledWith(FAMILY, USER_ID);
    expect(mockRepo.rotateSession).not.toHaveBeenCalled();
  });

  it('revokes the family when the jti is known but the hash does not match', async () => {
    // A real jti carrying the wrong secret is a forgery attempt, not a stale token.
    mockRepo.claimRefreshSession.mockResolvedValue({
      outcome: 'mismatch',
      session: sessionRow,
    } as never);

    await expect(AuthSvc.refreshToken(signedToken())).rejects.toMatchObject({ status: 401 });

    expect(mockRepo.revokeFamily).toHaveBeenCalledWith(FAMILY, USER_ID);
  });

  it('refuses a token that lost the race without revoking the family', async () => {
    // Two legitimate parallel refreshes must not look like theft. The loser is refused
    // and retries; the session survives.
    mockRepo.claimRefreshSession.mockResolvedValue({
      outcome: 'raced',
      session: sessionRow,
    } as never);

    await expect(AuthSvc.refreshToken(signedToken())).rejects.toMatchObject({ status: 401 });

    expect(mockRepo.revokeFamily).not.toHaveBeenCalled();
    expect(mockRepo.rotateSession).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'revoked', 'expired'])(
    'refuses a %s token without revoking anything',
    async (outcome) => {
      mockRepo.claimRefreshSession.mockResolvedValue({ outcome, session: sessionRow } as never);

      await expect(AuthSvc.refreshToken(signedToken())).rejects.toMatchObject({ status: 401 });

      expect(mockRepo.revokeFamily).not.toHaveBeenCalled();
    },
  );

  it('rejects a pre-migration token that carries no jti', async () => {
    // Tokens minted before the jti column existed cannot be looked up and cannot be told
    // apart from a forgery, so they are spent rather than honoured.
    const legacy = jwt.sign({ userId: USER_ID }, REFRESH_TOKEN_SECRET, { expiresIn: '30d' });

    await expect(AuthSvc.refreshToken(legacy)).rejects.toMatchObject({ status: 401 });

    expect(mockRepo.claimRefreshSession).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret before touching the database', async () => {
    const forged = jwt.sign({ userId: USER_ID, jti: JTI }, 'not-the-secret', { expiresIn: '30d' });

    await expect(AuthSvc.refreshToken(forged)).rejects.toThrow();

    expect(mockRepo.claimRefreshSession).not.toHaveBeenCalled();
  });

  it('answers replay and ordinary failure with the same status', async () => {
    // The messages differ deliberately — "session revoked" is better for a real user than
    // "invalid token", and it leaks nothing, since reaching it at all requires a token
    // signed with the refresh secret. What must match is the status: both clients key
    // their sign-out-and-redirect behaviour off 401 and nothing else.
    mockRepo.claimRefreshSession.mockResolvedValue({
      outcome: 'unknown',
      session: null,
    } as never);
    const ordinary = await AuthSvc.refreshToken(signedToken()).catch((e) => e);

    mockRepo.claimRefreshSession.mockResolvedValue({
      outcome: 'replayed',
      session: sessionRow,
    } as never);
    const replay = await AuthSvc.refreshToken(signedToken()).catch((e) => e);

    expect(ordinary.status).toBe(401);
    expect(replay.status).toBe(401);
  });
});
