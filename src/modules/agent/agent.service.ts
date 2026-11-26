import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import StoreService from '../stores/store.service';
import OrganizationRepository from '../organization/organization.repository';
import logger from '../../utils/logger';
import { displayName } from '../../utils/display-name.util';
import { hashPassword } from '../auth/password-hash';

type SellerRegistrationData = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  storeName: string;
  businessEmail: string;
  businessPhone: string;
  sellerPlan: string;
  agentNotes?: string;
  agentId: string;
};

export default class AgentService {
  static async getRecruits(agentId: string) {
    const sellers = await prisma.sellers.findMany({
      where: {
        deletedAt: null,
        users: { userReferralId: agentId },
      },
      select: {
        id: true,
        createdAt: true,
        applicationStatus: true,
        onboardingStep: true,
        isOnboarded: true,
        users: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sellers.map((seller) => ({
      sellerId: seller.id,
      sellerName: [seller.users.firstName, seller.users.lastName].filter(Boolean).join(' '),
      dateRecruited: seller.createdAt,
      status: seller.isOnboarded
        ? 'Active'
        : seller.onboardingStep > 0
          ? 'Incomplete'
          : 'Pending Onboarding',
    }));
  }

  static async registerSeller(data: SellerRegistrationData) {
    const existingUser = await prisma.users.findFirst({
      where: { email: data.email, accountStatus: 'ACTIVE' },
    });

    if (existingUser) {
      throw { status: 400, message: 'A user with this email already exists' };
    }

    const temporaryPassword = crypto.randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(temporaryPassword);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          email: data.email,
          name: displayName(data),
          firstName: data.firstName,
          lastName: data.lastName,
          phoneNumber: data.phoneNumber || null,
          userReferral: { connect: { id: data.agentId } },
          isEmailVerified: true,
          isOnBoarding: true,
          accountStatus: 'ACTIVE',
          roles: { connect: { roleName: 'SELLER' } },
        },
      });

      // The temporary password signs in through Better Auth's credential account (#122).
      await tx.authAccount.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: passwordHash,
        },
      });

      const seller = await tx.sellers.create({
        data: {
          userId: user.id,
          applicationStatus: 'APPROVED',
          sellerPlan: data.sellerPlan,
          agentNotes: data.agentNotes || null,
          onboardingStep: 0,
          isOnboarded: false,
        },
      });

      await OrganizationRepository.ensureSellerOrganization(tx, {
        sellerId: seller.id,
        userId: user.id,
        orgName: data.storeName || `${data.firstName} ${data.lastName}'s Organization`,
      });

      return { sellerId: seller.id, userId: user.id };
    });

    logger.info(`[Agent] Seller registered: sellerId=${result.sellerId}, agentId=${data.agentId}`);

    return {
      ...result,
      email: data.email,
      storeName: data.storeName,
      businessEmail: data.businessEmail,
      businessPhone: data.businessPhone,
      temporaryPassword,
      requiresOnboarding: true,
    };
  }

  static async onboardSeller(
    sellerId: string,
    data: {
      storeData: {
        storeName: string;
        description?: string;
        categoryIds: string[];
        email?: string;
        phone?: string;
      };
      locationData: {
        currentAddress: string;
        homeAddress: string;
        city: string;
        province: string;
        zipCode: string;
        country: string;
        latitude: number;
        longitude: number;
      };
      hoursData: Array<{
        dayOfWeek: number;
        openMinutes: number;
        closeMinutes: number;
        isClosed?: boolean;
      }>;
      documents?: {
        mayorsPermitFileName?: string;
        mayorsPermitKey?: string;
        dtiCertificateFileName?: string;
        dtiCertificateKey?: string;
        birCertificateFileName?: string;
        birCertificateKey?: string;
        secCertificateFileName?: string;
        secCertificateKey?: string;
      };
    },
  ) {
    const seller = await prisma.sellers.findUnique({ where: { id: sellerId } });
    if (!seller) throw { status: 404, message: 'Seller not found' };

    const store = await StoreService.createStoreWithDocuments(
      sellerId,
      data.storeData,
      data.locationData,
      data.hoursData,
      data.documents,
      { completeOnboarding: true },
    );

    return {
      sellerId,
      storeId: store?.id,
      onboardingStep: 3,
      isOnboarded: true,
      status: 'completed',
    };
  }
}
