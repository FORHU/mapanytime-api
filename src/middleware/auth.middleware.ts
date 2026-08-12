import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import AuthRepo from '../modules/auth/auth.repository';
import { ACCESS_TOKEN_SECRET } from '../config';
import logger from '../utils/logger';

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const route = `${req.method} ${req.originalUrl}`;
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    logger.warn(`[Auth] Rejected ${route} — no token provided`);
    return res.status(401).json({ message: 'No token provided' });
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
      return res.status(404).json({ message: 'User not found or deactivated' });
    }

    // Single Active Device Policy. A token is only good while its sessionId is still the user's
    // active one. Two ways it can stop being active:
    //   - a newer login on another device replaced it, or
    //   - the user logged out, which clears activeSessionId entirely.
    // The null case must reject too: treating "no active session" as "allow" would let every
    // previously-issued token work again for the rest of its 7-day life the moment anyone logs out.
    //
    // NOTE: tokens minted before this policy shipped carry no sessionId and are let through, so
    // they bypass single-device enforcement until they expire (up to ACCESS_TOKEN_EXPIRY = 7d).
    // Drop the `decoded.sessionId &&` guard to close that window at the cost of logging everyone out.
    if (decoded.sessionId && decoded.sessionId !== user.activeSessionId) {
      logger.warn(`[Auth] Rejected ${route} — session no longer active (${decoded.userId})`);
      return res.status(401).json({
        status: 401,
        message: 'Session expired — please sign in again.',
      });
    }

    logger.debug(`[Auth] Authenticated ${route} (user: ${user.id})`);
    req.user = user;
    next();
  } catch {
    logger.warn(`[Auth] Rejected ${route} — invalid or expired token`);
    return res.status(401).json({ message: 'Invalid token' });
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
    if (decoded.sessionId && decoded.sessionId !== user.activeSessionId) return next();

    req.user = user;
  } catch {
    // Malformed or expired token — fall through as anonymous.
  }

  return next();
};
