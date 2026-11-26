import { Request, Response, NextFunction } from 'express';
import AuthRepo from '../modules/auth/auth.repository';
import { ACCOUNT_BLOCKED_MESSAGE, auth } from '../modules/auth/better-auth';
import { bearerFrom, verifySessionToken } from '../modules/auth/session-token';
import { responseError } from '../helpers/response.helper';
import logger from '../utils/logger';

type SessionUser = NonNullable<Awaited<ReturnType<typeof AuthRepo.findUserById>>>;

/**
 * Who a bearer token belongs to, under Better Auth sessions (#122):
 *
 * - `invalid` — unsigned, forged, unknown, expired or signed-out. The signature
 *   is checked first and offline, so a forged token never costs a database read.
 * - `blocked` — a real session whose account is no longer ACTIVE.
 * - `ok` — the full user, as `req.user` has always carried it.
 *
 * Better Auth's `getSession` owns expiry and the sliding window (a session in
 * use is pushed out again once a day; see better-auth.ts).
 */
async function resolveBearer(
  bearerToken: string,
): Promise<{ kind: 'invalid' } | { kind: 'blocked' } | { kind: 'ok'; user: SessionUser }> {
  if (!verifySessionToken(bearerToken)) return { kind: 'invalid' };

  let userId: string | undefined;
  try {
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${bearerToken}` }),
    });
    userId = session?.user.id;
  } catch (err) {
    logger.warn(`[Auth] Session lookup failed: ${(err as Error).message}`);
  }
  if (!userId) return { kind: 'invalid' };

  const user = await AuthRepo.findUserById(userId);
  if (!user || user.accountStatus !== 'ACTIVE') return { kind: 'blocked' };
  return { kind: 'ok', user };
}

/**
 * Every rejection here is a 401, deliberately.
 *
 * Clients key their "sign the user out and route to login" behaviour off this status:
 * the web `fetcher` and the Flutter `AuthInterceptor` both act on 401 and neither acts
 * on 403 or 404. A deactivated account used to answer 404, which no client recognised
 * as an auth failure — the web app compensates by sniffing the message text for
 * "deactivated", and mobile just showed an error and stayed on a dead session.
 *
 * Routing through `responseError` also keeps these bodies on the `ApiError` contract
 * (`status`/`statusCode`/`message`).
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const route = `${req.method} ${req.originalUrl}`;
  const token = bearerFrom(req.headers.authorization);

  if (!token) {
    logger.warn(`[Auth] Rejected ${route} — no token provided`);
    return responseError(res, 401, 'No token provided');
  }

  try {
    const result = await resolveBearer(token);

    if (result.kind === 'invalid') {
      logger.warn(`[Auth] Rejected ${route} — no live session for this token`);
      return responseError(res, 401, 'Session expired — please sign in again.');
    }
    if (result.kind === 'blocked') {
      logger.warn(`[Auth] Rejected ${route} — account not active`);
      return responseError(res, 401, ACCOUNT_BLOCKED_MESSAGE);
    }

    logger.debug(`[Auth] Authenticated ${route} (user: ${result.user.id})`);
    req.user = result.user;
    next();
  } catch (err) {
    logger.error(`[Auth] Authentication error on ${route}: ${(err as Error).message}`);
    return responseError(res, 401, 'Invalid token');
  }
};

/**
 * Attach `req.user` when the request carries a usable token, but never reject.
 *
 * For endpoints that serve authenticated and anonymous callers alike — analytics
 * ingestion is the first — where knowing *who* is optional but the request must
 * succeed either way. Every rejection path in `authenticate` becomes "continue
 * anonymously" here.
 */
export const optionalAuthenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerFrom(req.headers.authorization);
  if (!token) return next();

  const user = await resolveActiveUser(token);
  if (user) req.user = user;

  return next();
};

/**
 * The user a bearer token belongs to, under exactly the rules `authenticate`
 * applies, or null. For callers outside the HTTP pipeline, such as the socket
 * gateway (F107), that need to know who is asking without a request.
 */
export async function resolveActiveUser(token: string) {
  try {
    const result = await resolveBearer(token);
    return result.kind === 'ok' ? result.user : null;
  } catch {
    return null;
  }
}
