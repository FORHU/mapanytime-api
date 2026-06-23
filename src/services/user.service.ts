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
    
    // Destructure using the PascalCase property
    const { PasswordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * List users
   */
  static async listUsers(page?: number, limit?: number) {
    return UserRepository.findAll(page, limit);
  }

  /**
   * Create user and publish event
   */
  // Updated type to match the 'Users' model
  static async createUser(data: Prisma.UsersUncheckedCreateInput) {
    // 1. Business Logic / Database Action
    const user = await UserRepository.create(data);

    // 2. Publish Domain Event - using PascalCase Id and Email
    await rabbitmq.publish(ROUTING_KEYS.USER_CREATED, {
      userId: user.Id,
      email: user.Email,
      timestamp: new Date().toISOString(),
    });

    // Trigger email asynchronously
    await rabbitmq.publish(ROUTING_KEYS.EMAIL_SEND_REQUESTED, {
      userId: user.Id,
      email: user.Email,
      subject: 'Welcome to our platform!',
      body: 'Thanks for signing up.',
    });

    // 3. Return DTO to controller
    const { PasswordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}