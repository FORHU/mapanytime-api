import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req.user as { id: string })?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });

    const isAdmin = user?.roles.some((role) => role.roleName === 'ADMIN');
    if (!isAdmin) {
      return res.status(403).json({ message: 'Forbidden: Administrator privileges required.' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error during authorization' });
  }
};
