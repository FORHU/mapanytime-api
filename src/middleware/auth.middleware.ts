import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import AuthRepo from '../modules/auth/auth.repository';
import { ACCESS_TOKEN_SECRET } from '../config';
import { responseError } from '../helpers/response.helper';
import logger from '../utils/logger';

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
 * (`status`/`statusCode`/`message`); they were hand-rolled `res.json({ message })`
 * before, in three shapes, none of which matched what clients parse.
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const route = `${req.method} ${req.originalUrl}`;
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    logger.warn(`[Auth] Rejected ${route} — no token provided`);
    return responseError(res, 401, 'No token provided');
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as {
      userId: string;
      sessionId?: string;
    };
    const user = await AuthRepo.findUserById(decoded.userId);

    // Check the raw database field 'accountStatus'
    if (!user || user.accountStatus !== 'ACTIVE') {
      logger.warn(`[Auth] Rejected ${route} — user not found or deactivated (${decoded.userId})`);
      return responseError(res, 401, 'User not found or deactivated');
    }

    // Single Active Device Policy. A token is only good while its sessionId is still the user's
    // active one. Two ways it can stop being active:
    //   - a newer login on another device replaced it, or
    //   - the user logged out, which clears activeSessionId entirely.
    // The null case must reject too: treating "no active session" as "allow" would let every
    // previously-issued token work again for the rest of its 7-day life the moment anyone logs out.
    //
    // A token carrying no sessionId at all is rejected for the same reason. Those predate the
    // policy and used to be waved through, which meant logging out did not actually stop them —
    // the one hole in "logout destroys the session". Closing it signs out anyone still holding
    // such a token; they were already past ACCESS_TOKEN_EXPIRY of being issued one.
    if (decoded.sessionId !== user.activeSessionId) {
      logger.warn(`[Auth] Rejected ${route} — session no longer active (${decoded.userId})`);
      return responseError(res, 401, 'Session expired — please sign in again.');
    }

    logger.debug(`[Auth] Authenticated ${route} (user: ${user.id})`);
    req.user = user;
    next();
  } catch {
    logger.warn(`[Auth] Rejected ${route} — invalid or expired token`);
    return responseError(res, 401, 'Invalid token');
  }
};

/**
 * Attach `req.user` when the request carries a usable token, but never reject.
 *
 * For endpoints that serve authenticated and anonymous callers alike — analytics
 * ingestion is the first — where knowing *who* is optional but the request must
 * succeed either way.
 *
 * Every rejection path in `authenticate` becomes "continue anonymously" here,
 * including the single-active-device check: a superseded token identifies a
 * real person, but not one we are willing to attribute events to, so it is
 * treated as no token at all rather than trusted.
 */
export const optionalAuthenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as {
      userId: string;
      sessionId?: string;
    };
    const user = await AuthRepo.findUserById(decoded.userId);

    if (!user || user.accountStatus !== 'ACTIVE') return next();
    if (decoded.sessionId !== user.activeSessionId) return next();

    req.user = user;
  } catch {
    // Malformed or expired token — fall through as anonymous.
  }

  return next();
};
