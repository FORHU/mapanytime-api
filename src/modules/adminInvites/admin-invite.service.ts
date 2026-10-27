import crypto from 'crypto';
import { INVITESTATUS, Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { ROLE_DESCRIPTIONS, SYSTEM_ROLES, SystemRole } from '../../constants/roles.constant';
import { sendEmail, isMailerConfigured } from '../../utils/mailer';
import logger from '../../utils/logger';
import { hashPassword } from '../auth/password-hash';
import { displayName } from '../../utils/display-name.util';

export const INVITABLE_ADMIN_ROLES: SystemRole[] = [
  SYSTEM_ROLES.SUPER_ADMIN,
  SYSTEM_ROLES.ADMIN,
  SYSTEM_ROLES.SUPPORT_AGENT,
  SYSTEM_ROLES.DEVELOPER,
];

export interface CreateInviteInput {
  email: string;
  role?: string;
  inviterId: string;
  expiresInDays?: number;
}

export interface AcceptInviteInput {
  token: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export class AdminInviteService {
  /**
   * Creates or regenerates an admin invitation for the specified email.
   * Gated for platform administrators.
   */
  static async createInvite(params: CreateInviteInput) {
    const email = params.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw { status: 400, message: 'A valid email address is required.' };
    }

    const role = (params.role || SYSTEM_ROLES.ADMIN) as SystemRole;
    if (!INVITABLE_ADMIN_ROLES.includes(role)) {
      throw {
        status: 400,
        message: `Invalid administrative role: ${params.role}. Allowed roles: ${INVITABLE_ADMIN_ROLES.join(', ')}`,
      };
    }

    // Check if a user with this email already has the specified admin role
    const existingUser = await prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { roles: true },
    });

    if (existingUser && existingUser.roles.some((r) => r.roleName === role)) {
      throw {
        status: 400,
        message: `User ${email} already exists and is assigned the ${role} role.`,
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const days = params.expiresInDays && params.expiresInDays > 0 ? params.expiresInDays : 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const invite = await prisma.adminInvites.upsert({
      where: { email },
      create: {
        email,
        token,
        role,
        status: INVITESTATUS.PENDING,
        inviterId: params.inviterId,
        expiresAt,
      },
      update: {
        token,
        role,
        status: INVITESTATUS.PENDING,
        inviterId: params.inviterId,
        expiresAt,
        acceptedAt: null,
      },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Dispatch invitation email
    const appUrl = process.env.APP_URL || 'https://dev.mapanytime.com';
    const inviteUrl = `${appUrl}/admin/accept-invite?token=${token}`;

    try {
      if (isMailerConfigured()) {
        await sendEmail({
          to: email,
          subject: "You've been invited to MapAnytime Admin",
          text:
            `Hello,\n\n` +
            `You have been invited to join MapAnytime as an administrator (${role}).\n\n` +
            `Please activate your administrative account by visiting:\n` +
            `${inviteUrl}\n\n` +
            `This invitation expires on ${expiresAt.toUTCString()}.\n`,
          html:
            `<p>Hello,</p>` +
            `<p>You have been invited to join MapAnytime as an administrator (<strong>${role}</strong>).</p>` +
            `<p><a href="${inviteUrl}">Click here to accept invitation and activate your account</a></p>` +
            `<p>This invitation will expire on <strong>${expiresAt.toUTCString()}</strong>.</p>`,
        });
        logger.info(`[AdminInvite] Dispatched invite email to ${email} (role: ${role})`);
      } else {
        logger.info(`[AdminInvite] Mailer unconfigured. Invite link for ${email}: ${inviteUrl}`);
      }
    } catch (mailError) {
      logger.warn(
        `[AdminInvite] Failed to dispatch email to ${email}: ${(mailError as Error).message}`,
      );
    }

    return invite;
  }

  /**
   * Retrieves paginated admin invitations with optional status filter.
   */
  static async listInvites(params: { status?: INVITESTATUS; page?: number; limit?: number }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AdminInvitesWhereInput = {};
    if (params.status) {
      where.status = params.status;
    }

    const [invites, total] = await Promise.all([
      prisma.adminInvites.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          inviter: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.adminInvites.count({ where }),
    ]);

    return {
      invites,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Revokes a pending administrative invitation.
   */
  static async revokeInvite(inviteId: string) {
    const invite = await prisma.adminInvites.findUnique({
      where: { id: inviteId },
    });

    if (!invite) {
      throw { status: 404, message: 'Invitation not found.' };
    }

    if (invite.status === INVITESTATUS.ACCEPTED) {
      throw { status: 400, message: 'Cannot revoke an already accepted invitation.' };
    }

    return prisma.adminInvites.update({
      where: { id: inviteId },
      data: { status: INVITESTATUS.REVOKED },
    });
  }

  /**
   * Validates an invitation token for the onboarding page.
   * Publicly accessible by invited users.
   */
  static async validateInvite(token: string) {
    if (!token?.trim()) {
      throw { status: 400, message: 'Invitation token is required.' };
    }

    const invite = await prisma.adminInvites.findUnique({
      where: { token: token.trim() },
    });

    if (!invite) {
      throw { status: 404, message: 'Invalid or unknown invitation token.' };
    }

    if (invite.status !== INVITESTATUS.PENDING) {
      throw {
        status: 400,
        message: `Invitation is no longer pending (current status: ${invite.status}).`,
      };
    }

    if (invite.expiresAt < new Date()) {
      await prisma.adminInvites.update({
        where: { id: invite.id },
        data: { status: INVITESTATUS.EXPIRED },
      });
      throw { status: 400, message: 'Invitation has expired.' };
    }

    return {
      valid: true,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Completes administrator onboarding by setting the user credentials and activating the account.
   * Atomically executes in a Prisma transaction.
   */
  static async acceptInvite(params: AcceptInviteInput) {
    const token = params.token?.trim();
    if (!token) {
      throw { status: 400, message: 'Invitation token is required.' };
    }

    if (!params.password || params.password.length < 8) {
      throw { status: 400, message: 'Password must be at least 8 characters long.' };
    }

    const invite = await prisma.adminInvites.findUnique({
      where: { token },
    });

    if (!invite) {
      throw { status: 404, message: 'Invalid or unknown invitation token.' };
    }

    if (invite.status !== INVITESTATUS.PENDING) {
      throw {
        status: 400,
        message: `Invitation is no longer pending (current status: ${invite.status}).`,
      };
    }

    if (invite.expiresAt < new Date()) {
      await prisma.adminInvites.update({
        where: { id: invite.id },
        data: { status: INVITESTATUS.EXPIRED },
      });
      throw { status: 400, message: 'Invitation has expired.' };
    }

    const passwordHash = await hashPassword(params.password);

    const result = await prisma.$transaction(async (tx) => {
      const roleDesc =
        ROLE_DESCRIPTIONS[invite.role as keyof typeof ROLE_DESCRIPTIONS] || `${invite.role} role`;
      const roleConnection = {
        where: { roleName: invite.role },
        create: { roleName: invite.role, description: roleDesc },
      };

      let user = await tx.users.findFirst({
        where: { email: { equals: invite.email, mode: 'insensitive' } },
      });

      if (user) {
        user = await tx.users.update({
          where: { id: user.id },
          data: {
            roles: { connectOrCreate: roleConnection },
            isEmailVerified: true,
            accountStatus: 'ACTIVE',
            firstName: params.firstName || user.firstName,
            lastName: params.lastName || user.lastName,
          },
        });

        const existingAccount = await tx.authAccount.findFirst({
          where: { userId: user.id, providerId: 'credential' },
        });

        if (existingAccount) {
          await tx.authAccount.update({
            where: { id: existingAccount.id },
            data: { password: passwordHash },
          });
        } else {
          await tx.authAccount.create({
            data: {
              userId: user.id,
              accountId: user.id,
              providerId: 'credential',
              password: passwordHash,
            },
          });
        }
      } else {
        const name = displayName({
          email: invite.email,
          firstName: params.firstName,
          lastName: params.lastName,
        });

        user = await tx.users.create({
          data: {
            email: invite.email,
            name,
            firstName: params.firstName,
            lastName: params.lastName,
            isEmailVerified: true,
            accountStatus: 'ACTIVE',
            roles: { connectOrCreate: roleConnection },
          },
        });

        await tx.authAccount.create({
          data: {
            userId: user.id,
            accountId: user.id,
            providerId: 'credential',
            password: passwordHash,
          },
        });
      }

      const acceptedInvite = await tx.adminInvites.update({
        where: { id: invite.id },
        data: {
          status: INVITESTATUS.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      return { user, invite: acceptedInvite };
    });

    logger.info(
      `[AdminInvite] Invitation accepted for ${result.user.email} (userId: ${result.user.id}, role: ${invite.role})`,
    );

    return {
      userId: result.user.id,
      email: result.user.email,
      role: invite.role,
      status: result.invite.status,
      acceptedAt: result.invite.acceptedAt,
    };
  }
}
export default AdminInviteService;
