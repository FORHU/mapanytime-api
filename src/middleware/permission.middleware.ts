import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';

export const requirePermission = (permissionCode: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized' });
      }

      const user = await prisma.users.findUnique({
        where: { id: userId },
        include: {
          roles: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        return res.status(401).json({ status: 'error', message: 'User profile not found' });
      }

      // Check if user has ADMIN role (implicit full access) or possesses the requested permission code
      const isAdmin = user.roles.some((r) => r.roleName === 'ADMIN');
      const hasPermission =
        isAdmin ||
        user.roles.some((r) =>
          (
            r as unknown as { permissions: Array<{ permission: { code: string } }> }
          ).permissions.some((rp) => rp.permission?.code === permissionCode),
        );

      if (!hasPermission) {
        return res.status(403).json({
          status: 'error',
          message: `Forbidden: Missing required permission [${permissionCode}]`,
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error during permission verification',
      });
    }
  };
};
