import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import AuthRepo from '../repositories/auth.repository';
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
    };
    const user = await AuthRepo.findUserById(decoded.userId);

    // Check the raw database field 'AccountStatus' instead of the removed 'IsActive'
    if (!user || user.accountStatus !== 'ACTIVE') {
      logger.warn(`[Auth] Rejected ${route} — user not found or deactivated (${decoded.userId})`);
      return res.status(404).json({ message: 'User not found or deactivated' });
    }

    logger.debug(`[Auth] Authenticated ${route} (user: ${user.id})`);
    req.user = user;
    next();
  } catch {
    logger.warn(`[Auth] Rejected ${route} — invalid or expired token`);
    return res.status(401).json({ message: 'Invalid token' });
  }
};
