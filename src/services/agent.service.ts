import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import StoreService from '../modules/stores/store.service';
import logger from '../utils/logger';

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
  static async registerSeller(data: SellerRegistrationData) {
    const existingUser = await prisma.users.findFirst({
      where: { email: data.email, accountStatus: 'ACTIVE' },
    });

    if (existingUser) {
      throw { status: 400, message: 'A user with this email already exists' };
    }

    const temporaryPassword = crypto.randomBytes(12).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .pbkdf2Sync(temporaryPassword, salt, 1000, 64, 'sha512')
      .toString('hex');

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          email: data.email,
          passwordHash: `${salt}:${hash}`,
          firstName: data.firstName,
          lastName: data.lastName,
          phoneNumber: data.phoneNumber || null,
          isEmailVerified: true,
          isOnBoarding: true,
          accountStatus: 'ACTIVE',
          roles: { connect: { roleName: 'SELLER' } },
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

      return { sellerId: seller.id, userId: user.id };
    });

    logger.info(
      `[Agent] Seller registered: sellerId=${result.sellerId}, agentId=${data.agentId}`,
    );

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
