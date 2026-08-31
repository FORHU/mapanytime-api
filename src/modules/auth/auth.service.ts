import AuthRepo from './auth.repository';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Users } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { DOCUMENTTYPES } from '@prisma/client';
import {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
} from '../../config';
import CacheUtil from '../../utils/cache.util';
import logger from '../../utils/logger';
import { publish } from '../../infrastructure/rabbitmq/publisher';
import { ROUTING_KEYS } from '../../events/routing-keys';

/** How long a reset code stays usable. Short, because the code is only 4 digits. */
const PASSWORD_RESET_TTL_MINUTES = 15;

/** Wrong guesses allowed against one code before it is burned. */
const MAX_RESET_ATTEMPTS = 5;

/**
 * One message for every credential failure — unknown address and wrong password alike.
 * Distinguishing them turns the login form into an account-existence oracle, so the
 * text must stay identical on both paths.
 */
const INVALID_CREDENTIALS = 'Incorrect email or password.';

/**
 * Fixed salt/hash used to run a real PBKDF2 pass for unknown-email login attempts, so
 * "no such user" costs the same as "wrong password" and can't be timed apart.
 */
const DUMMY_SALT = 'ponytail-dummy-salt';
const DUMMY_HASH_HEX = crypto.pbkdf2Sync('dummy', DUMMY_SALT, 1000, 64, 'sha512').toString('hex');

/**
 * Constant-time comparison of a stored hex digest against a freshly computed one.
 *
 * `a !== b` returns as soon as it finds a differing byte, so how long it takes leaks how
 * much of the digest the attacker guessed correctly — enough, over many samples, to
 * reconstruct it byte by byte. `timingSafeEqual` always reads both buffers fully.
 *
 * It throws on length mismatch rather than returning false, so the lengths are compared
 * first; that check is safe to short-circuit because the length of a digest is not a
 * secret.
 *
 * The stored value is decoded *before* that check: `Buffer.from` stops at the first
 * non-hex character, so a corrupt column can pass a string-length check and still decode
 * short, turning a clean 401 into a 500.
 */
function timingSafeEqualHex(storedHex: string, computed: Buffer): boolean {
  if (typeof storedHex !== 'string') return false;
  const stored = Buffer.from(storedHex, 'hex');
  return stored.length === computed.length && crypto.timingSafeEqual(stored, computed);
}

export default class AuthSvc {
  static async register(data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    middleName?: string;
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
      const rolesToConnect =
        data.roleName === 'SELLER'
          ? [{ roleName: 'SELLER' }, { roleName: 'BUYER' }]
          : [{ roleName: data.roleName }];

      const user = await tx.users.create({
        data: {
          email: data.email,
          passwordHash: `${salt}:${hash}`,
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName,
          phoneNumber: data.phoneNumber,
          countryCode: data.countryCode,
          isEmailVerified: true,
          accountStatus: 'ACTIVE',
          roles: { connect: rolesToConnect },
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
      const displayName =
        [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ') || 'New User';

      if (data.roleName === 'SELLER') {
        const seller = await tx.sellers.create({
          data: { userId: user.id },
        });

        // Also create a buyer profile for the seller
        await tx.buyers.create({
          data: { userId: user.id, displayName },
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
        await tx.buyers.create({
          data: { userId: user.id, displayName },
        });
      }
      // --- END BYPASS LOGIC ---
    });

    return null;
  }

  static async login(data: { email: string; password: string; roleName?: string }) {
    logger.info(`[Auth] Login attempt for ${data.email} as ${data.roleName || 'any'}`);

    const user = await AuthRepo.findUserByEmail(data.email);

    // Always hash + compare, even for an unknown account, using a fixed dummy
    // salt/hash — otherwise "no such user" returns faster than "wrong password"
    // and leaks which emails are registered via response timing. The defaults also
    // cover a stored hash with no ':' separator, which would otherwise leave `salt`
    // undefined and make pbkdf2Sync throw a 500.
    const [salt = DUMMY_SALT, storedHashHex = DUMMY_HASH_HEX] = user?.passwordHash
      ? user.passwordHash.split(':')
      : [DUMMY_SALT, DUMMY_HASH_HEX];

    const computed = crypto.pbkdf2Sync(data.password, salt, 1000, 64, 'sha512');

    // One branch for every failure — unknown account, social-only account, wrong
    // password. Splitting them apart is what reopens the enumeration oracle.
    if (!user || !user.passwordHash || !timingSafeEqualHex(storedHashHex, computed)) {
      logger.warn(`[Auth] Login failed for ${data.email}`);
      throw { status: 401, message: INVALID_CREDENTIALS };
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

  /**
   * Start a password reset: mint a one-time code, store its hash, email it.
   *
   * Always resolves the same way whether or not the address exists. Telling an
   * unauthenticated caller "no such account" turns this into an email
   * enumeration oracle, which is a worse leak than the inconvenience it saves.
   * See FLAGS.md ID-6.
   */
  static async requestPasswordReset(email: string) {
    const genericResponse = {
      message: 'If an account exists for that address, a reset code has been sent.',
    };

    const user = await AuthRepo.findUserByEmail(email);
    if (!user) {
      logger.info(`[Auth] Password reset requested for unknown address: ${email}`);
      return genericResponse;
    }

    // Any code already outstanding is retired, so a user who asks twice cannot
    // be confused about which of two live codes to type.
    await prisma.passwordResetTokens.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // 4 digits, to match the client's OTP field. Short codes are only safe
    // because they expire fast and the attempt counter closes them — see
    // MAX_RESET_ATTEMPTS in resetPassword.
    const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');

    await prisma.passwordResetTokens.create({
      data: {
        userId: user.id,
        codeHash: this.hashResetCode(code),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      },
    });

    await publish(ROUTING_KEYS.EMAIL_SEND_REQUESTED, {
      userId: user.id,
      email: user.email,
      subject: 'Your MapAnytime password reset code',
      templateName: 'password-reset.html',
      data: {
        firstName: user.firstName || 'there',
        code,
        expiryMinutes: PASSWORD_RESET_TTL_MINUTES,
      },
      // Plain-text alternative, for clients that will not render the HTML.
      body:
        `Your password reset code is ${code}.

` +
        `It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes. ` +
        'If you did not ask to reset your password, you can ignore this email.',
    });

    logger.info(`[Auth] Password reset code issued for user ${user.id}`);
    return genericResponse;
  }

  /**
   * Complete a password reset.
   *
   * Consuming the code and revoking every session happen together: a reset that
   * changed the password but left an attacker's existing session alive would
   * not have locked them out of anything.
   */
  static async resetPassword(data: { email: string; code: string; newPassword: string }) {
    const invalid = { status: 400, message: 'That reset code is invalid or has expired.' };

    const user = await AuthRepo.findUserByEmail(data.email);
    if (!user) throw invalid;

    const token = await prisma.passwordResetTokens.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) throw invalid;

    // A 4-digit code is 10,000 possibilities; without a ceiling it is walkable
    // in seconds. Burning the token on the last attempt means an attacker gets
    // a fixed budget, not an unlimited one.
    if (token.attempts >= MAX_RESET_ATTEMPTS) {
      await prisma.passwordResetTokens.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
      logger.warn(`[Auth] Password reset token exhausted for user ${user.id}`);
      throw invalid;
    }

    if (token.codeHash !== this.hashResetCode(data.code)) {
      await prisma.passwordResetTokens.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      logger.warn(`[Auth] Wrong password reset code for user ${user.id}`);
      throw invalid;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(data.newPassword, salt, 1000, 64, 'sha512').toString('hex');

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetTokens.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });

      await tx.users.update({
        where: { id: user.id },
        data: { passwordHash: `${salt}:${hash}`, activeSessionId: null },
      });

      // Every device is signed out. Whoever forced the reset does not keep a
      // session they opened before it.
      await tx.session.deleteMany({ where: { userId: user.id } });
    });

    await CacheUtil.del(`user:${user.id}`);
    logger.info(`[Auth] Password reset completed for user ${user.id}; all sessions revoked.`);

    return { message: 'Your password has been reset. Please sign in with your new password.' };
  }

  /**
   * Reset codes are stored hashed, so a leaked row is not a working code.
   * SHA-256 rather than pbkdf2 because the input is a random server-issued
   * value with a minutes-long life, not a user-chosen secret worth stretching.
   */
  private static hashResetCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim()).digest('hex');
  }

  /**
   * Revokes the caller's session. Safe to call repeatedly and safe to call with a
   * refresh token that is missing, unknown, or already revoked — see the contract note
   * on AuthController.logout for why that has to hold.
   *
   * Clearing `activeSessionId` is the authoritative kill: `authenticate` compares every
   * access token's `sessionId` against it, so nulling it invalidates the access token
   * immediately rather than waiting out its expiry. It therefore runs FIRST — if the
   * refresh-row cleanup below fails, the session is already dead, whereas the old order
   * left a fully live session behind whenever that delete errored.
   */
  static async logout(userId: string, refreshToken?: string) {
    await AuthRepo.updateActiveSession(userId, null);

    // Best-effort tidy-up of the matching refresh row. `deleteMany` matches zero rows
    // without throwing, so an unknown token is a no-op rather than an error.
    if (refreshToken) await AuthRepo.deleteSession(refreshToken);

    await CacheUtil.del(`user:${userId}`);
    logger.info(`[Auth] User ${userId} logged out (refresh row dropped: ${Boolean(refreshToken)})`);
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
      {
        userId: user.id,
        sessionId: newSession.id,
        roles:
          (user as Users & { roles?: { roleName: string }[] }).roles?.map((r) => r.roleName) || [],
      },
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
      roles?: { roleName: string }[];
    };

    const formattedUser = {
      ...safeUser,
      roles: safeUser.roles?.map((r) => r.roleName) || [],
    };

    return {
      accessToken,
      refreshToken,
      user: formattedUser,
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
