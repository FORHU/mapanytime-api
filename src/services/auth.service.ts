import AuthRepo from '../repositories/auth.repository';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Users } from '@prisma/client';
import {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
} from '../config';
import CacheUtil from '../utils/cache.util';

export default class AuthSvc {
  static async register(data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    roleName: string;
    countryCode?: string;
  }) {
    const existingUser = await AuthRepo.findUserByEmail(data.email);
    if (existingUser) throw { status: 400, message: 'User already exists' };

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(data.password, salt, 1000, 64, 'sha512').toString('hex');

    const user = await AuthRepo.createUser({
      email: data.email,
      passwordHash: `${salt}:${hash}`,
      firstName: data.firstName,
      lastName: data.lastName,
      countryCode: data.countryCode,
      roles: { connect: { roleName: data.roleName } },
    });

    if (data.roleName === 'SELLER') {
      await AuthRepo.createSeller(user.id);
    } else if (data.roleName === 'BUYER') {
      const displayName = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'New Buyer';
      await AuthRepo.createBuyer(user.id, displayName);
    }

    const userWithSeller = await AuthRepo.findUserById(user.id);
    return this.generateAuthResponse(userWithSeller as Users, 'local');
  }

  static async login(data: { email: string; password: string }) {
    const user = await AuthRepo.findUserByEmail(data.email);
    if (!user || !user.passwordHash) throw { status: 401, message: 'Invalid credentials' };

    const [salt, storedHash] = user.passwordHash.split(':');
    const hash = crypto.pbkdf2Sync(data.password, salt, 1000, 64, 'sha512').toString('hex');

    if (storedHash !== hash) throw { status: 401, message: 'Invalid credentials' };

    const updatedUser = await AuthRepo.updateUserLoginStatus(user.id);
    return this.generateAuthResponse(updatedUser as Users, 'local');
  }

  static async refreshToken(refreshToken: string) {
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as { userId: string };
    const session = await AuthRepo.findValidSession(refreshToken);
    if (!session) throw { status: 401, message: 'Invalid token' };

    const user = await AuthRepo.findUserById(decoded.userId);
    if (!user) throw { status: 404, message: 'User not found' };

    return this.generateAuthResponse(user, 'local', false);
  }

  static async logout(userId: string, refreshToken?: string) {
    if (refreshToken) await AuthRepo.deleteSession(refreshToken);
    await CacheUtil.del(`user:${userId}`);
    return { message: 'Logged out successfully' };
  }

  private static async generateAuthResponse(user: Users, provider: string, includeUser = true) {
    const accessToken = jwt.sign({ userId: user.id }, ACCESS_TOKEN_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
    });

    const refreshToken = jwt.sign(
      { userId: user.id, jti: crypto.randomBytes(16).toString('hex') },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'] },
    );

    await AuthRepo.createSession({
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      provider,
    });

    await CacheUtil.set(`user:${user.id}`, user);

    if (!includeUser) {
      return { accessToken, refreshToken };
    }

    const stores = (user as Users & { seller?: { stores: unknown[] } }).seller?.stores || [];

    return {
      accessToken,
      refreshToken,
      stores,
      location: { country: user.countryCode },
    };
  }
}
