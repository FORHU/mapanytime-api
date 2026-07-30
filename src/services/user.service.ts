import { Prisma, Roles } from '@prisma/client';
import { prisma } from '../utils/prisma';
import UserRepository from '../repositories/user.repository';
import { rabbitmq } from '../infrastructure/rabbitmq';
import { ROUTING_KEYS } from '../events/routing-keys';

export default class UserService {
  static async getUser(id: string) {
    const user = await UserRepository.findById(id);
    if (!user) throw { status: 404, message: 'User not found' };

    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  static async listUsers(page?: number, limit?: number) {
    const result = await UserRepository.findAll(page, limit);
    // const safeUsers = result.users.map((user) => {
    //   const { passwordHash, ...userWithoutPassword } = user;
    //   return userWithoutPassword;
    // });

    return {
      ...result,
      // users: safeUsers,
    };
  }

  static async createUser(data: Prisma.UsersUncheckedCreateInput) {
    const user = await UserRepository.create(data);

    await rabbitmq.publish(ROUTING_KEYS.USER_CREATED, {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  static async assignRole(userId: string, roleName: string) {
    const [user, targetRole] = await Promise.all([
      prisma.users.findUnique({
        where: { id: userId },
        include: { roles: true },
      }),
      prisma.roles.findUnique({
        where: { roleName: roleName },
      }),
    ]);

    if (!user) throw { status: 404, message: 'User not found' };
    if (!targetRole) throw { status: 400, message: 'Invalid role provided' };

    const alreadyHasRole = user.roles.some((r: Roles) => r.roleName === roleName);
    if (alreadyHasRole) return null;

    return UserRepository.addRoleToUser(userId, roleName);
  }

  static async setUserRoles(userId: string, roleNames: string[]) {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw { status: 404, message: 'User not found' };

    const foundRoles = await prisma.roles.findMany({
      where: { roleName: { in: roleNames } },
    });
    if (foundRoles.length !== roleNames.length) {
      throw { status: 400, message: 'One or more roles are invalid' };
    }

    return UserRepository.setUserRoles(userId, roleNames);
  }
}
