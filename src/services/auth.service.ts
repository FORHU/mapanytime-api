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
import logger from '../utils/logger';

export default class AuthSvc {
  static async register(data: {
    email: string;
    password: string;
    name?: string;
    roleName: string;
    countryCode?: string;
  }) {
    logger.info(`[Auth] Registration attempt for ${data.email} (role: ${data.roleName})`);

    const existingUser = await AuthRepo.findUserByEmail(data.email);
    if (existingUser) {
      logger.warn(`[Auth] Registration rejected — email already exists: ${data.email}`);
      throw { status: 400, message: 'User already exists' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(data.password, salt, 1000, 64, 'sha512').toString('hex');

    // CHANGED: Assigned the result to 'user'
    const user = await AuthRepo.createUser({
      email: data.email,
      passwordHash: `${salt}:${hash}`,
      firstName: data.name,
      countryCode: data.countryCode,
      roles: { connect: { roleName: data.roleName } },
    });

    if (data.roleName === 'SELLER') {
      await AuthRepo.createSeller(user.id);
    }

    logger.info(`[Auth] User registered: ${user.id} (${data.email}) as ${data.roleName}`);

    // Registration does not log the user in: no tokens or session are issued
    // and no user data is returned. The client redirects to login afterwards.
    return null;
  }

  static async login(data: { email: string; password: string }) {
    logger.info(`[Auth] Login attempt for ${data.email}`);

    const user = await AuthRepo.findUserByEmail(data.email);
    if (!user || !user.passwordHash) {
      logger.warn(`[Auth] Login failed — unknown or invalid account: ${data.email}`);
      throw { status: 401, message: 'Invalid credentials' };
    }

    const [salt, storedHash] = user.passwordHash.split(':');
    const hash = crypto.pbkdf2Sync(data.password, salt, 1000, 64, 'sha512').toString('hex');

    if (storedHash !== hash) {
      logger.warn(`[Auth] Login failed — wrong password for ${data.email} (user: ${user.id})`);
      throw { status: 401, message: 'Invalid credentials' };
    }

    const updatedUser = await AuthRepo.updateUserLoginStatus(user.id);
    logger.info(`[Auth] Login successful: ${updatedUser.id} (${data.email})`);
    return this.generateAuthResponse(updatedUser as Users, 'local');
  }

  static async refreshToken(refreshToken: string) {
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as { userId: string };
    const session = await AuthRepo.findValidSession(refreshToken);
    if (!session) {
      logger.warn(`[Auth] Refresh rejected — invalid or expired session (user: ${decoded.userId})`);
      throw { status: 401, message: 'Invalid token' };
    }

    const user = await AuthRepo.findUserById(decoded.userId);
    if (!user) throw { status: 404, message: 'User not found' };

    logger.info(`[Auth] Token refreshed for user ${user.id}`);

    // Rotate the refresh token: invalidate the one just used before issuing a
    // new session, so old sessions don't accumulate and a leaked token can't be
    // replayed after a legitimate refresh.
    await AuthRepo.deleteSession(refreshToken);

    return this.generateAuthResponse(user, 'local', false);
  }

  static async logout(userId: string, refreshToken?: string) {
    if (refreshToken) await AuthRepo.deleteSession(refreshToken);
    await CacheUtil.del(`user:${userId}`);
    logger.info(`[Auth] User ${userId} logged out (session revoked: ${Boolean(refreshToken)})`);
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

    // Never leak the password hash to clients.
    const { passwordHash: _passwordHash, ...safeUser } = user as Users & {
      passwordHash?: string;
    };

    return {
      accessToken,
      refreshToken,
      user: safeUser,
      stores,
      location: { country: user.countryCode },
    };
  }
}
