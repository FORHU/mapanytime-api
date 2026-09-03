import crypto from 'crypto';
import { SellerOrgRole } from '@prisma/client';
import OrganizationRepository from './organization.repository';
import { storeScopeWhere, type OrgContext } from './orgContext';
import { normalizePermissions } from './sellerPermissions.constant';
import { prisma } from '../../utils/prisma';
import AuthService from '../auth/auth.service';
import { publish } from '../../infrastructure/rabbitmq/publisher';
import { ROUTING_KEYS } from '../../events/routing-keys';
import logger from '../../utils/logger';
import { MAPANYTIME_WEB_APP_URL } from '../../config';

/**
 * How long a staff set-up code stays valid.
 *
 * Far longer than the 15 minutes the self-service reset uses, because an
 * administrator relays this one by hand rather than the recipient requesting it
 * the moment they need it. The code is correspondingly long and random instead
 * of four digits, so the extra lifetime costs nothing in guessability.
 */
const STAFF_SETUP_TTL_MINUTES = 60 * 24 * 3;

export default class OrganizationService {
  /**
   * The org context payload for the "Selected Store" dropdown: the org, the
   * caller's role, whether they are an admin, and the stores they can access.
   */
  static getContext(ctx: OrgContext, orgId: string) {
    return {
      organizationId: orgId,
      role: ctx.role,
      isAdmin: ctx.isAdmin,
      assignedStoreIds: ctx.isAdmin ? null : (ctx.assignedStoreIds ?? []),
      // Resolved, not raw: admins come back holding every feature so the web
      // nav does not have to re-implement the implicit-admin rule.
      permissions: ctx.permissions,
    };
  }

  /**
   * The stores the caller may actually open — all of the organization's for a
   * `seller_admin`, only the assigned ones for a `seller_user`. The route is
   * open to any member, so scoping has to happen here.
   */
  static getStores(ctx: OrgContext) {
    return OrganizationRepository.getOrgStores(storeScopeWhere(ctx));
  }

  // --- Members -------------------------------------------------------------

  static listMembers(orgId: string) {
    return OrganizationRepository.getMembers(orgId);
  }

  /**
   * Reject any store that does not belong to the organization. Without this the
   * `storeIds` array is written straight through, so an admin could point a
   * member's assignments at another organization's stores. Nothing reads those
   * rows without re-asserting `sellerOrganizationId`, so it was never directly
   * exploitable — but it is cross-tenant data one filter away from being so.
   */
  private static async assertStoresInOrg(orgId: string, storeIds: string[]) {
    if (storeIds.length === 0) return;
    const found = await OrganizationRepository.getOrgStores({
      sellerOrganizationId: orgId,
      id: { in: storeIds },
    });
    if (found.length !== new Set(storeIds).size) {
      throw { status: 404, message: 'One or more stores do not belong to this organization' };
    }
  }

  static async createMember(
    orgId: string,
    userId: string,
    role: SellerOrgRole,
    storeIds: string[],
    permissions?: string[],
  ) {
    const existing = await OrganizationRepository.findMembership(orgId, userId);
    if (existing) throw { status: 409, message: 'User is already a member of this organization' };

    // Only non-admin roles take store assignments; admins see all stores.
    const isAdminRole = role === SellerOrgRole.SELLER_ADMIN;
    const normalizedStores = isAdminRole ? [] : storeIds;
    await OrganizationService.assertStoresInOrg(orgId, normalizedStores);

    const member = await OrganizationRepository.createMember({
      sellerOrganizationId: orgId,
      userId,
      role,
      storeIds: normalizedStores,
      permissions: normalizePermissions(role, permissions),
    });
    return member;
  }

  /**
   * Create a brand-new staff account and put it to work in one go: the user,
   * their membership, and their store assignments commit together, so a staff
   * member never exists in the half-made state of "can sign in, has no store".
   *
   * Deliberately no `Sellers` row. Every owner check in the codebase compares
   * the caller's own `Sellers.id` against `store.sellerId`, an identity test
   * staff can never satisfy — so the row would buy them nothing while unlocking
   * merchant onboarding, i.e. letting a staff member set up as an independent
   * competitor. Their authority comes from the store assignment instead.
   *
   * The password is random and discarded. The only way in is the set-up code,
   * which the admin relays and the recipient exchanges for a password of their
   * own choosing — so an administrator never holds a working credential for
   * someone else's account, and staff actions stay attributable.
   */
  static async createStaffAccount(
    orgId: string,
    input: {
      firstName: string;
      lastName: string;
      email: string;
      role: SellerOrgRole;
      storeIds: string[];
      permissions?: string[];
    },
  ) {
    const email = input.email.trim().toLowerCase();

    const existing = await OrganizationRepository.findUserByEmail(email);
    if (existing) {
      throw {
        status: 409,
        message:
          `An account already exists for ${email}. Add them as a member instead ` +
          `of creating a new account.`,
      };
    }

    const isAdminRole = input.role === SellerOrgRole.SELLER_ADMIN;
    const storeIds = isAdminRole ? [] : input.storeIds;
    await OrganizationService.assertStoresInOrg(orgId, storeIds);

    // Resolved before the transaction so an unknown code fails as a 400 without
    // having created a user first.
    const permissions = normalizePermissions(input.role, input.permissions);

    // Nobody ever learns this. It exists only so the column is non-null before
    // the recipient sets their own.
    const unusablePassword = crypto.randomBytes(32).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(unusablePassword, salt, 1000, 64, 'sha512').toString('hex');

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: {
          email,
          passwordHash: `${salt}:${hash}`,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          isEmailVerified: true,
          accountStatus: 'ACTIVE',
          // The seller shell is gated on the platform SELLER role, so staff
          // need it to reach the dashboard at all. BUYER is deliberately left
          // off: it would trigger the dual-role prompt on every sign-in.
          roles: { connect: [{ roleName: 'SELLER' }] },
        },
      });

      await tx.sellerOrganizationMembers.create({
        data: { sellerOrganizationId: orgId, userId: created.id, role: input.role, permissions },
      });

      if (storeIds.length > 0) {
        const member = await tx.sellerOrganizationMembers.findUnique({
          where: {
            sellerOrganizationId_userId: { sellerOrganizationId: orgId, userId: created.id },
          },
          select: { id: true },
        });
        await tx.sellerOrganizationMemberStores.createMany({
          data: storeIds.map((storeId) => ({ memberId: member!.id, storeId })),
        });
      }

      return created;
    });

    // Long and random rather than the four digits the self-service reset uses:
    // this one is relayed by hand and lives for days.
    const setupCode = crypto.randomBytes(12).toString('hex');
    await AuthService.storeResetCode(user.id, setupCode, STAFF_SETUP_TTL_MINUTES);

    // Reuses the existing password-reset template and mail pipeline. The copy
    // says "reset" rather than "welcome" — worth a dedicated template later.
    await publish(ROUTING_KEYS.EMAIL_SEND_REQUESTED, {
      userId: user.id,
      email: user.email,
      subject: 'Set up your MapAnytime staff account',
      templateName: 'password-reset.html',
      data: {
        firstName: user.firstName || 'there',
        code: setupCode,
        expiryMinutes: STAFF_SETUP_TTL_MINUTES,
      },
      body:
        `You have been added to a MapAnytime seller organization.\n\n` +
        `Use this code to set your password: ${setupCode}\n\n` +
        `It expires in ${STAFF_SETUP_TTL_MINUTES / 60} hours.`,
    });

    logger.info(`[Org] Staff account created for ${email} in organization ${orgId}`);

    // The code comes back to the admin too. That is not the enumeration risk
    // `requestPasswordReset` guards against — they just created this account —
    // and it keeps the flow usable when the mail worker is not running.
    return {
      userId: user.id,
      email: user.email,
      role: input.role,
      storeIds,
      permissions,
      setupCode,
      // A ready-to-share link, since the code alone gives the recipient nothing
      // to do with it. Falls back to the local dev origin when unconfigured.
      setupUrl:
        `${(MAPANYTIME_WEB_APP_URL || 'http://localhost:4000').replace(/\/$/, '')}` +
        `/set-password?email=${encodeURIComponent(user.email)}&code=${setupCode}`,
      expiresInMinutes: STAFF_SETUP_TTL_MINUTES,
    };
  }

  static async updateMember(
    orgId: string,
    memberId: string,
    role?: SellerOrgRole,
    storeIds?: string[],
    permissions?: string[],
  ) {
    const member = await OrganizationRepository.getMemberById(memberId);
    if (!member || member.sellerOrganizationId !== orgId) {
      throw { status: 404, message: 'Member not found' };
    }

    let normalizedStores = storeIds;

    // Switching a member to an admin role clears their store assignments.
    if (role === SellerOrgRole.SELLER_ADMIN) {
      normalizedStores = [];
    }

    if (normalizedStores !== undefined) {
      await OrganizationService.assertStoresInOrg(orgId, normalizedStores);
    }

    // Rewrite the permission list when the caller sent one, and also when the
    // role changed without one — a member promoted to MANAGER should pick up
    // the manager default rather than keep the narrower list they had, and one
    // demoted to admin must be reset to the empty implicit-all list.
    const roleChanged = role !== undefined && role !== member.role;
    const effectiveRole = role ?? member.role;
    const normalizedPermissions =
      permissions !== undefined || roleChanged
        ? normalizePermissions(effectiveRole, permissions)
        : undefined;

    return OrganizationRepository.updateMember(memberId, {
      ...(role !== undefined ? { role } : {}),
      ...(normalizedStores !== undefined ? { storeIds: normalizedStores } : {}),
      ...(normalizedPermissions !== undefined ? { permissions: normalizedPermissions } : {}),
    });
  }

  static async deleteMember(orgId: string, memberId: string, requestingUserId: string) {
    const member = await OrganizationRepository.getMemberById(memberId);
    if (!member || member.sellerOrganizationId !== orgId) {
      throw { status: 404, message: 'Member not found' };
    }
    if (member.userId === requestingUserId) {
      throw { status: 400, message: 'You cannot remove yourself from the organization' };
    }
    await OrganizationRepository.deleteMember(memberId);
    return { memberId };
  }
}
