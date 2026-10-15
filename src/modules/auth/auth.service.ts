import AuthRepo from './auth.repository';
import crypto from 'crypto';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import { APIError } from 'better-auth/api';
import { Users } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { BUYERIDTYPE, DOCUMENTTYPES, SEX } from '@prisma/client';
import S3Util from '../../utils/s3.util';
import AddressService from '../addresses/address.service';
import { FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, GOOGLE_CLIENT_ID } from '../../config';
import { ACCOUNT_BLOCKED_MESSAGE, auth } from './better-auth';
import { hashPassword } from './password-hash';
import { signSessionToken } from './session-token';
import CacheUtil from '../../utils/cache.util';
import { resolveOrgContext } from '../organization/orgContext';
import OrganizationRepository from '../organization/organization.repository';
import type { AuthUser } from './auth.repository';
import logger from '../../utils/logger';
import { displayName as userDisplayName } from '../../utils/display-name.util';
import { publish } from '../../infrastructure/event-bus/publisher';
import { ROUTING_KEYS } from '../../events/routing-keys';

/** File extension for each accepted ID photo type (see AuthController). */
const ID_PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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

/** Whether a Better Auth error is the blocked-account refusal from the session hook. */
const isBlockedAccount = (err: unknown) =>
  err instanceof APIError && err.message === ACCOUNT_BLOCKED_MESSAGE;

/**
 * Starts a Better Auth session for a user whose identity is already proven (a
 * verified Google/Facebook token). The session hooks in better-auth.ts still
 * run: a blocked account is refused, and the user's other sessions end.
 */
async function startSession(userId: string): Promise<string> {
  const ctx = await auth.$context;
  try {
    const session = await ctx.internalAdapter.createSession(userId);
    return session.token;
  } catch (err) {
    if (isBlockedAccount(err)) throw { status: 401, message: ACCOUNT_BLOCKED_MESSAGE };
    throw err;
  }
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
    dateOfBirth?: Date;
    sex?: SEX;
    /** The valid ID photo from a buyer sign-up, stored privately for review. */
    validId?: {
      idType: BUYERIDTYPE;
      idNumber: string;
      /** The holder's address as confirmed against the ID. */
      address: string;
      photo: { buffer: Buffer; mimeType: string; size: number; originalName: string };
    };
  }) {
    logger.info(`[Auth] Registration attempt for ${data.email} (role: ${data.roleName})`);

    const existingUser = await AuthRepo.findUserByEmail(data.email);
    if (existingUser) {
      logger.warn(`[Auth] Registration rejected — email already exists: ${data.email}`);
      throw { status: 400, message: 'Email already exists' };
    }

    // Hashed before the transaction: scrypt is deliberately slow, and the
    // transaction should hold its connection only for the writes.
    const passwordHash = await hashPassword(data.password);

    // The ID photo goes to S3 before the transaction (S3 can't join it); if the
    // transaction then fails, the object is deleted again below.
    const validId = data.roleName === 'BUYER' ? data.validId : undefined;
    let idPhotoKey: string | undefined;
    if (validId) {
      const ext = ID_PHOTO_EXTENSIONS[validId.photo.mimeType] ?? 'jpg';
      idPhotoKey = `buyer-ids/${crypto.randomBytes(16).toString('hex')}.${ext}`;
      await S3Util.putObject(idPhotoKey, validId.photo.buffer, validId.photo.mimeType);
    }

    try {
      // Use Prisma transaction to ensure all identity records succeed or fail together
      await prisma.$transaction(async (tx) => {
        const rolesToConnect =
          data.roleName === 'SELLER'
            ? [{ roleName: 'SELLER' }, { roleName: 'BUYER' }]
            : [{ roleName: data.roleName }];

        const user = await tx.users.create({
          data: {
            email: data.email,
            name: userDisplayName(data),
            firstName: data.firstName,
            lastName: data.lastName,
            middleName: data.middleName,
            phoneNumber: data.phoneNumber,
            countryCode: data.countryCode,
            dateOfBirth: data.dateOfBirth,
            sex: data.sex,
            isEmailVerified: true,
            accountStatus: 'ACTIVE',
            roles: { connect: rolesToConnect },
          },
        });

        // Better Auth signs in against this row, not Users (#122).
        await tx.authAccount.create({
          data: {
            userId: user.id,
            accountId: user.id,
            providerId: 'credential',
            password: passwordHash,
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

          // Every seller belongs to exactly one seller organization. Create it
          // (plus system roles and the owner's admin membership) in the same
          // transaction so a never-onboarded seller is always scoped.
          await OrganizationRepository.ensureSellerOrganization(tx, {
            sellerId: seller.id,
            userId: user.id,
            orgName: `${displayName}'s Organization`,
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
          const buyer = await tx.buyers.create({
            data: { userId: user.id, displayName },
          });

          if (validId && idPhotoKey) {
            const file = await tx.files.create({
              data: {
                uploadedById: user.id,
                filename: idPhotoKey.split('/').pop()!,
                originalName: validId.photo.originalName,
                mimeType: validId.photo.mimeType,
                size: validId.photo.size,
                path: idPhotoKey,
              },
            });
            await tx.buyerIdVerifications.create({
              data: {
                buyerId: buyer.id,
                idType: validId.idType,
                idNumber: validId.idNumber,
                address: validId.address,
                fileId: file.id,
              },
            });
            logger.info(`[Auth] Buyer ID uploaded for review: ${user.id} (${validId.idType})`);

            // The address entered at sign-up becomes the buyer's default
            // address, under the same rules as POST /addresses.
            if (data.phoneNumber) {
              await AddressService.addForBuyer(tx, buyer.id, {
                addressType: 'HOME',
                recipientName: displayName,
                phoneNumber: data.phoneNumber,
                addressLine1: validId.address,
                isDefault: true,
              });
            }
          }
        }
        // --- END BYPASS LOGIC ---
      });
    } catch (err) {
      if (idPhotoKey) {
        await S3Util.deleteObject(idPhotoKey).catch((e) =>
          logger.error(`[Auth] Could not delete orphaned ID photo ${idPhotoKey}: ${e}`),
        );
      }
      throw err;
    }

    return null;
  }

  /**
   * Email/password sign-in through Better Auth (#122). Better Auth verifies the
   * password against the credential account — and hashes even for an unknown
   * address, so "no such user" cannot be timed apart from "wrong password". The
   * session hooks refuse a blocked account and end the user's other sessions.
   */
  static async login(data: { email: string; password: string; roleName?: string }) {
    logger.info(`[Auth] Login attempt for ${data.email} as ${data.roleName || 'any'}`);

    let signedIn: { token: string; user: { id: string } };
    try {
      signedIn = await auth.api.signInEmail({
        body: { email: data.email, password: data.password },
      });
    } catch (err) {
      if (isBlockedAccount(err)) {
        logger.warn(`[Auth] Login refused — account blocked: ${data.email}`);
        throw { status: 401, message: ACCOUNT_BLOCKED_MESSAGE };
      }
      // One answer for every other failure — unknown account, social-only
      // account, wrong password. Splitting them reopens the enumeration oracle.
      logger.warn(`[Auth] Login failed for ${data.email}`);
      throw { status: 401, message: INVALID_CREDENTIALS };
    }

    const updatedUser = await AuthRepo.updateUserLoginStatus(signedIn.user.id);
    logger.info(`[Auth] Login successful: ${updatedUser.id} (${data.email})`);
    return this.buildAuthResponse(updatedUser as Users, signedIn.token);
  }

  /**
   * Verifies a Facebook access token server-side and returns the identity Meta vouches
   * for. The client hands over only the token — never email/name/id directly — so the
   * caller cannot assert an identity the way the old googleLogin let them.
   *
   * `appsecret_proof` is sent on every call regardless of whether "Require App Secret"
   * is toggled on in the Meta app, so this stays safe if that setting ever changes.
   */
  private static async verifyFacebookAccessToken(accessToken: string) {
    const appsecretProof = crypto
      .createHmac('sha256', FACEBOOK_APP_SECRET)
      .update(accessToken)
      .digest('hex');

    const debug = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: accessToken,
        access_token: `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`,
      },
    });

    const tokenData = debug.data?.data;
    const isExpired =
      typeof tokenData?.expires_at === 'number' &&
      tokenData.expires_at > 0 &&
      tokenData.expires_at * 1000 <= Date.now();

    if (!tokenData?.is_valid || tokenData.app_id !== FACEBOOK_APP_ID || isExpired) {
      throw { status: 401, message: 'That Facebook session is invalid or has expired.' };
    }

    const profile = await axios.get('https://graph.facebook.com/me', {
      params: {
        fields: 'id,email,first_name,last_name,picture.type(large)',
        access_token: accessToken,
        appsecret_proof: appsecretProof,
      },
    });

    return profile.data as {
      id: string;
      email?: string;
      first_name?: string;
      last_name?: string;
      picture?: { data?: { url?: string } };
    };
  }

  /**
   * Shared by every social login: finds the account for a verified email, or creates one.
   *
   * A new account is always BUYER — never a role the caller could pick, whatever the
   * provider. The caller must have already verified `email` really belongs to whoever
   * presented the token; matching an existing account by it is then safe transparent
   * account linking, not an enumeration or takeover risk, because every provider here
   * only ever reports an address it has itself confirmed.
   */
  private static async findOrCreateSocialBuyer(profile: {
    email: string;
    firstName?: string;
    lastName?: string;
  }) {
    let user = await AuthRepo.findUserByEmail(profile.email);
    if (user) return user;

    const displayName =
      [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'New User';

    // No credential account is created: a social-only user has no password, so
    // email/password sign-in finds nothing to verify and fails like any wrong
    // password — until they set one through forgot-password.
    await prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: {
          email: profile.email,
          name: userDisplayName(profile),
          firstName: profile.firstName,
          lastName: profile.lastName,
          isEmailVerified: true,
          accountStatus: 'ACTIVE',
          roles: { connect: [{ roleName: 'BUYER' }] },
        },
      });
      await tx.buyers.create({
        data: { userId: created.id, displayName },
      });
    });

    user = await AuthRepo.findUserByEmail(profile.email);
    if (!user) throw { status: 500, message: 'Could not create account' };
    return user;
  }

  /**
   * Records which provider identity signed this user in, as a Better Auth
   * account row (`providerId` + the provider's own user id). Replaces the
   * provider columns on the retired JWT `Session` table.
   */
  private static async linkProviderAccount(
    userId: string,
    providerId: 'google' | 'facebook',
    providerUserId: string,
  ) {
    await prisma.authAccount.upsert({
      where: { providerId_accountId: { providerId, accountId: providerUserId } },
      create: { userId, providerId, accountId: providerUserId },
      update: {},
    });
  }

  /** Shared tail of every social sign-in: link the identity, start a session, respond. */
  private static async completeSocialLogin(
    user: { id: string },
    providerId: 'google' | 'facebook',
    providerUserId: string,
    email: string,
  ) {
    await this.linkProviderAccount(user.id, providerId, providerUserId);
    const sessionToken = await startSession(user.id);
    const updatedUser = await AuthRepo.updateUserLoginStatus(user.id);
    logger.info(`[Auth] ${providerId} login successful: ${updatedUser.id} (${email})`);
    return this.buildAuthResponse(updatedUser as Users, sessionToken);
  }

  /**
   * Facebook Login. Verifies the token against the Graph API before trusting anything
   * about it, then finds or creates an account by the verified email.
   */
  static async facebookLogin(data: { accessToken: string }) {
    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
      logger.error('[Auth] Blocked call to facebookLogin — FACEBOOK_APP_ID/SECRET not configured');
      throw { status: 501, message: 'Facebook sign-in is not configured' };
    }

    const profile = await this.verifyFacebookAccessToken(data.accessToken);

    if (!profile.email) {
      logger.warn(`[Auth] Facebook login for ${profile.id} carried no email`);
      throw {
        status: 400,
        message:
          'Facebook did not share a verified email address. Please allow the email permission, or sign in with email and password instead.',
      };
    }

    const user = await this.findOrCreateSocialBuyer({
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
    });

    return this.completeSocialLogin(user, 'facebook', profile.id, profile.email);
  }

  /**
   * Google Sign-In.
   *
   * Verifies the ID token's signature, audience, and issuer against Google's own public
   * keys before trusting anything in it — this is the fix for the account-takeover bug
   * the old implementation had, which took `email` straight from the request body. See
   * the removed SECURITY note this replaces for the incident.
   */
  static async googleLogin(data: { idToken: string }) {
    if (!GOOGLE_CLIENT_ID) {
      logger.error('[Auth] Blocked call to googleLogin — GOOGLE_CLIENT_ID not configured');
      throw { status: 501, message: 'Google sign-in is not configured' };
    }

    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: data.idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      logger.warn(`[Auth] Google ID token failed verification: ${(err as Error).message}`);
      throw { status: 401, message: 'That Google session is invalid or has expired.' };
    }

    // `verifyIdToken` already checked signature/audience/issuer/expiry; `email_verified`
    // is the one claim it does not enforce, and an unverified address is exactly the gap
    // the old email-from-request-body bug exploited, just moved one layer down.
    if (!payload?.email || !payload.email_verified) {
      logger.warn(`[Auth] Google login for ${payload?.sub} carried no verified email`);
      throw {
        status: 400,
        message:
          'Google did not share a verified email address. Please sign in with email and password instead.',
      };
    }

    const user = await this.findOrCreateSocialBuyer({
      email: payload.email,
      firstName: payload.given_name,
      lastName: payload.family_name,
    });

    return this.completeSocialLogin(user, 'google', payload.sub, payload.email);
  }

  /**
   * Retired with JWT (#122). Better Auth sessions slide forward on use and need
   * no refresh round-trip, so there is nothing to exchange. Always 401: an older
   * client that still calls this treats 401 as "signed out" and goes to login,
   * which is exactly the one re-login the cutover costs.
   */
  static async refreshToken(): Promise<never> {
    throw { status: 401, message: 'Session expired — please sign in again.' };
  }
  /**
   * Start a password reset: mint a one-time code, store its hash, email it.
   *
   * Always resolves the same way whether or not the address exists. Telling an
   * unauthenticated caller "no such account" turns this into an email
   * enumeration oracle, which is a worse leak than the inconvenience it saves.
   * See FLAGS.md ID-6.
   */
  /**
   * Store a reset code for a user and retire any still outstanding.
   *
   * Shared by the self-service forgot-password flow and by staff-account
   * creation, so there is exactly one place that decides how a code is hashed
   * and expired. `resetPassword` verifies whatever lands here, so the code
   * itself does not have to be four digits — staff setup uses a long random
   * one, because an admin relays it by hand and it lives for days rather than
   * minutes.
   */
  static async storeResetCode(userId: string, code: string, ttlMinutes: number) {
    // Any code already outstanding is retired, so a user who asks twice cannot
    // be confused about which of two live codes to type.
    await prisma.passwordResetTokens.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await prisma.passwordResetTokens.create({
      data: {
        userId,
        codeHash: this.hashResetCode(code),
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      },
    });
  }

  static async requestPasswordReset(email: string) {
    const genericResponse = {
      message: 'If an account exists for that address, a reset code has been sent.',
    };

    const user = await AuthRepo.findUserByEmail(email);
    if (!user) {
      logger.info(`[Auth] Password reset requested for unknown address: ${email}`);
      return genericResponse;
    }

    // 4 digits, to match the client's OTP field. Short codes are only safe
    // because they expire fast and the attempt counter closes them — see
    // MAX_RESET_ATTEMPTS in resetPassword.
    const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');

    await this.storeResetCode(user.id, code, PASSWORD_RESET_TTL_MINUTES);

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

    const passwordHash = await hashPassword(data.newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetTokens.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });

      // The credential account is what Better Auth signs in against (#122).
      // Upserted, not updated: a Google/Facebook-only user has none until they
      // set a password here.
      await tx.authAccount.upsert({
        where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
        create: {
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: passwordHash,
        },
        update: { password: passwordHash },
      });

      await tx.users.update({
        where: { id: user.id },
        data: { isPasswordSet: true },
      });

      // Every device is signed out. Whoever forced the reset does not keep a
      // session they opened before it.
      await tx.authSession.deleteMany({ where: { userId: user.id } });
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
   * Ends the caller's sessions. Idempotent and never an error for an already
   * dead session — see the contract note on AuthController.logout for why that
   * has to hold. Under the single-active-device rule a user has at most one
   * session, so ending all of them is ending "this" one; it is also the same
   * reach the old `activeSessionId` reset had.
   */
  static async logout(userId: string) {
    const { count } = await prisma.authSession.deleteMany({ where: { userId } });
    await CacheUtil.del(`user:${userId}`);
    logger.info(`[Auth] User ${userId} logged out (${count} session(s) ended)`);
    return { message: 'Logged out successfully' };
  }

  /**
   * The sign-in response every login path returns: the signed bearer token plus
   * the user, seller and org context the dashboards need. `accessToken` keeps its
   * name so existing clients read it unchanged; it is now a Better Auth session
   * token, and there is no `refreshToken` — sessions slide forward on use.
   */
  private static async buildAuthResponse(user: Users, sessionToken: string) {
    const accessToken = signSessionToken(sessionToken);

    await CacheUtil.set(`user:${user.id}`, user);
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

    // The seller-organization context for the current user's active org — used
    // by the web/mobile dashboards for the "Selected Store" dropdown and to
    // decide whether the seller is an admin (all stores) or a scoped member.
    const orgCtx = resolveOrgContext(user as AuthUser);
    const orgContext = orgCtx.organizationId
      ? {
          organizationId: orgCtx.organizationId,
          role: orgCtx.role,
          isAdmin: orgCtx.isAdmin,
          // Decides the post-login destination: staff never belong in merchant
          // onboarding, whatever their org role.
          isOwner: orgCtx.isOwner,
          assignedStoreIds: orgCtx.isAdmin ? null : (orgCtx.assignedStoreIds ?? []),
        }
      : null;

    return {
      accessToken,
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
      orgContext,
      location: { country: user.countryCode },
    };
  }
}
