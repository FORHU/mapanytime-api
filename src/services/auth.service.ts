import AuthRepo from '../repositories/auth.repository';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Users } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { DOCUMENTTYPES } from '@prisma/client';
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
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    roleName: string;
    countryCode?: string;
    sellerDocuments?: {
      tinIdFileName: string;
      tinIdKey: string;
      govIdFileName: string;
      govIdKey: string;
    };
  }) {
    logger.info(`[Auth] Registration attempt for ${data.email} (role: ${data.roleName})`);

    const existingUser = await AuthRepo.findUserByEmail(data.email);
    if (existingUser) {
      logger.warn(`[Auth] Registration rejected — email already exists: ${data.email}`);
      throw { status: 400, message: 'User already exists' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(data.password, salt, 1000, 64, 'sha512').toString('hex');

    // Use Prisma transaction to ensure all identity records succeed or fail together
    await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          email: data.email,
          passwordHash: `${salt}:${hash}`,
          firstName: data.firstName,
          lastName: data.lastName,
          phoneNumber: data.phoneNumber,
          countryCode: data.countryCode,
          isEmailVerified: true,
          accountStatus: 'ACTIVE',
          roles: { connect: { roleName: data.roleName } },
        },
      });

      /* --- ORIGINAL STRICT LOGIC (COMMENTED OUT FOR MVP BYPASS) ---
      if (data.roleName === 'SELLER' && data.sellerDocuments) {
        const seller = await tx.sellers.create({
          data: { userId: user.id },
        });

        // Create the global Identity Folder (storeId is null)
        const docVerification = await tx.documentVerifications.create({
          data: {
            sellerId: seller.id,
            verificationStatus: 'PENDING',
          },
        });

        const attachDoc = async (fileName: string, fileUrl: string, type: DOCUMENTTYPES) => {
          const file = await tx.files.create({
            data: {
              uploadedById: user.id,
              filename: fileName,
              originalName: fileName,
              mimeType: 'application/octet-stream',
              size: 0,
              path: fileUrl,
            },
          });
          await tx.documents.create({
            data: {
              documentVerificationsId: docVerification.id,
              fileId: file.id,
              documentType: type,
            },
          });
        };

        await attachDoc(
          data.sellerDocuments.tinIdFileName,
          data.sellerDocuments.tinIdKey,
          'TIN_ID',
        );
        await attachDoc(
          data.sellerDocuments.govIdFileName,
          data.sellerDocuments.govIdKey,
          'GOV_ID',
        );
      } else if (data.roleName === 'BUYER') {
        const displayName =
          [data.firstName, data.lastName].filter(Boolean).join(' ') || 'New Buyer';
        await tx.buyers.create({
          data: { userId: user.id, displayName },
        });
      }
      --- END ORIGINAL STRICT LOGIC --- */

      // --- START BYPASS LOGIC ---
      if (data.roleName === 'SELLER') {
        const seller = await tx.sellers.create({
          data: { userId: user.id },
        });

        const docVerification = await tx.documentVerifications.create({
          data: {
            sellerId: seller.id,
            verificationStatus: 'PENDING',
          },
        });

        if (data.sellerDocuments) {
          const attachDoc = async (fileName: string, fileUrl: string, type: DOCUMENTTYPES) => {
            const file = await tx.files.create({
              data: {
                uploadedById: user.id,
                filename: fileName,
                originalName: fileName,
                mimeType: 'application/octet-stream',
                size: 0,
                path: fileUrl,
              },
            });
            await tx.documents.create({
              data: {
                documentVerificationsId: docVerification.id,
                fileId: file.id,
                documentType: type,
              },
            });
          };

          await attachDoc(
            data.sellerDocuments.tinIdFileName,
            data.sellerDocuments.tinIdKey,
            'TIN_ID',
          );
          await attachDoc(
            data.sellerDocuments.govIdFileName,
            data.sellerDocuments.govIdKey,
            'GOV_ID',
          );
        }
      } else if (data.roleName === 'BUYER') {
        const displayName =
          [data.firstName, data.lastName].filter(Boolean).join(' ') || 'New Buyer';
        await tx.buyers.create({
          data: { userId: user.id, displayName },
        });
      }
      // --- END BYPASS LOGIC ---
    });

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
    return this.generateAuthResponse(updatedUser as Users, 'local', true, {
      revokeOtherSessions: true,
    });
  }

  /**
   * Google OAuth Sign-In — NOT IMPLEMENTED, fails closed.
   *
   * The previous implementation took `data.email` at face value and minted tokens for it, which
   * is unauthenticated account takeover for any address the caller names. It was held back only
   * by a commented-out route in auth.route.ts, and a comment is not a safety mechanism — so the
   * body is gone and this throws instead. Registering the route now returns 501 rather than
   * handing out sessions.
   *
   * To implement:
   *   1. Take an `idToken` from the client instead of email/firstName/lastName/googleId.
   *   2. Verify it with `new OAuth2Client(GOOGLE_CLIENT_ID).verifyIdToken({ idToken, audience:
   *      GOOGLE_CLIENT_ID })` and reject anything failing signature, audience, issuer or expiry.
   *   3. Read email/name/sub from the verified payload only, and require `email_verified`.
   *   4. Find-or-create the user — mirror register()'s single transaction so an account can't be
   *      created without its buyer profile, and hardcode the BUYER role; never let the caller
   *      pick one, or an attacker self-provisions an admin.
   *   5. Return `generateAuthResponse(user, 'google', true, { revokeOtherSessions: true,
   *      providerUserId, providerAvatarUrl })` — the Session model already carries the Google
   *      identity, since Users has no googleId column and stores avatars as Files rows.
   */
  static async googleLogin(data: { email?: string }) {
    logger.error(`[Auth] Blocked call to unimplemented googleLogin for ${data.email}`);
    throw {
      status: 501,
      message: 'Google sign-in is not available — ID token verification is not implemented',
    };
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

    // Carry the original provider through — otherwise a Google session is relabelled 'local'
    // the first time it refreshes. Retire only this session, not the user's other devices.
    return this.generateAuthResponse(user, session.provider || 'local', false, {
      replacesRefreshToken: refreshToken,
    });
  }

  static async logout(userId: string, refreshToken?: string) {
    if (refreshToken) await AuthRepo.deleteSession(refreshToken);
    await AuthRepo.updateActiveSession(userId, null);
    await CacheUtil.del(`user:${userId}`);
    logger.info(`[Auth] User ${userId} logged out (session revoked: ${Boolean(refreshToken)})`);
    return { message: 'Logged out successfully' };
  }

  /**
   * Mints a fresh session plus its token pair.
   *
   * `revokeOtherSessions` enforces the single-active-device rule and is only correct for a real
   * login. A refresh passes `replacesRefreshToken` so it retires the session it came from and
   * leaves the user's other devices alone.
   */
  private static async generateAuthResponse(
    user: Users,
    provider: string,
    includeUser = true,
    options: {
      revokeOtherSessions?: boolean;
      replacesRefreshToken?: string;
      providerUserId?: string;
      providerAvatarUrl?: string;
    } = {},
  ) {
    const refreshToken = jwt.sign(
      { userId: user.id, jti: crypto.randomBytes(16).toString('hex') },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'] },
    );

    // Purge, create, and point activeSessionId at the new session — all or nothing.
    const newSession = await AuthRepo.rotateSession({
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      provider,
      revokeOtherSessions: options.revokeOtherSessions,
      replacesRefreshToken: options.replacesRefreshToken,
      providerUserId: options.providerUserId,
      providerAvatarUrl: options.providerAvatarUrl,
    });

    user.activeSessionId = newSession.id;

    // The access token carries sessionId so authenticate() can tell a live session from a
    // superseded one without a second lookup.
    const accessToken = jwt.sign(
      { userId: user.id, sessionId: newSession.id },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'] },
    );

    await CacheUtil.set(`user:${user.id}`, user);

    if (!includeUser) {
      return { accessToken, refreshToken };
    }

    const seller = (
      user as Users & {
        seller?: {
          id: string;
          applicationStatus: string;
          isOnboarded: boolean;
          onboardingStep: number;
          stores: Array<{ deletedAt?: Date | null }>;
        };
      }
    ).seller;
    const stores = seller?.stores?.filter((store) => !store.deletedAt) || [];
    const hasStores = stores.length > 0;

    // Older approved seller records may have a store but still have the default
    // isOnboarded=false value. Normalize that legacy state for authentication.
    const isOnboarded = Boolean(seller?.isOnboarded || seller?.applicationStatus === 'APPROVED');

    const { passwordHash: _passwordHash, ...safeUser } = user as Users & {
      passwordHash?: string;
    };

    return {
      accessToken,
      refreshToken,
      user: safeUser,
      stores,
      seller: seller
        ? {
            id: seller.id,
            applicationStatus: seller.applicationStatus,
            isOnboarded,
            onboardingStep: seller.onboardingStep,
            hasStores,
          }
        : null,
      location: { country: user.countryCode },
    };
  }
}
