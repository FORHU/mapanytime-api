import { Prisma } from '@prisma/client';
import UserRepository from '../repositories/user.repository';
import { rabbitmq } from '../infrastructure/rabbitmq';
import { ROUTING_KEYS } from '../events/routing-keys';

export default class UserService {
  /**
   * Get user by ID
   */
  static async getUser(id: string) {
    const user = await UserRepository.findById(id);
    if (!user) {
      throw { status: 404, message: 'User not found' };
    }
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * List users hehe
   */
  static async listUsers(page?: number, limit?: number) {
    return UserRepository.findAll(page, limit);
  }

  /**
   * Create user and publish event
   */
  static async createUser(data: Prisma.UserCreateInput) {
    // 1. Business Logic / Database Action
    const user = await UserRepository.create(data);

    // 2. Publish Domain Event
    await rabbitmq.publish(ROUTING_KEYS.USER_CREATED, {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    // We can also trigger an email asynchronously
    await rabbitmq.publish(ROUTING_KEYS.EMAIL_SEND_REQUESTED, {
      userId: user.id,
      email: user.email,
      subject: 'Welcome to our platform!',
      body: 'Thanks for signing up.',
    });

    // 3. Return DTO to controller
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}
