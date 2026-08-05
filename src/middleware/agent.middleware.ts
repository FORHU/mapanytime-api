import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { SYSTEM_ROLES } from '../constants/roles.constant';

export const requireAgent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req.user as { id?: string })?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    console.log('User roles:', JSON.stringify(user));
    if (!user?.roles.some((role) => role.roleName === SYSTEM_ROLES.SUPPORT_AGENT)) {
      return res.status(403).json({ message: 'Support Agent privileges required.' });
    }

    next();
  } catch {
    return res.status(500).json({ message: 'Internal server error during authorization' });
  }
};
