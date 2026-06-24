import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import AuthRepo from '../repositories/auth.repository';
import { ACCESS_TOKEN_SECRET } from '../config';

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as {
      userId: string;
    };
    const user = await AuthRepo.findUserById(decoded.userId);

    // Check the raw database field 'AccountStatus' instead of the removed 'IsActive'
    if (!user || user.accountStatus !== 'ACTIVE') {
      return res.status(404).json({ message: 'User not found or deactivated' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
