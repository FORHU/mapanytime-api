import { serializeSignedCookie } from 'better-call';
import { AUTH_SECRET } from '../../src/modules/auth/auth-secret';
import {
  bearerFrom,
  signSessionToken,
  verifySessionToken,
} from '../../src/modules/auth/session-token';

/**
 * Our bearer token must be byte-for-byte the signed session-cookie value Better Auth
 * verifies — otherwise getSession quietly answers null and every signed-in request
 * is a 401. That shipped once: the signature was base64url, which passed every mocked
 * test and failed against a real database (#122). This pins it against Better Auth's
 * own signing function, not against a restatement of ours.
 */
describe('session tokens (#122)', () => {
  const sessionToken = 'p9QzX1-session_token_value';

  it("matches Better Auth's own signed-cookie value exactly", async () => {
    const serialized = await serializeSignedCookie('', sessionToken, AUTH_SECRET);
    const betterAuths = decodeURIComponent(serialized.replace('=', ''));

    expect(signSessionToken(sessionToken)).toBe(betterAuths);
  });

  it('verifies its own tokens offline and returns the session token', () => {
    expect(verifySessionToken(signSessionToken(sessionToken))).toBe(sessionToken);
  });

  it.each([
    ['a tampered signature', () => signSessionToken(sessionToken).slice(0, -2) + 'xx'],
    ['a tampered session token', () => 'X' + signSessionToken(sessionToken).slice(1)],
    ['an unsigned session token', () => sessionToken],
    ['an empty signature', () => `${sessionToken}.`],
    ['a JWT', () => 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1In0.c2ln'],
  ])('refuses %s', (_label, make) => {
    expect(verifySessionToken(make())).toBeNull();
  });

  it('reads only Bearer authorization headers', () => {
    expect(bearerFrom('Bearer abc.def')).toBe('abc.def');
    expect(bearerFrom('bearer abc.def')).toBe('abc.def');
    expect(bearerFrom('Basic abc')).toBeUndefined();
    expect(bearerFrom(undefined)).toBeUndefined();
  });
});
