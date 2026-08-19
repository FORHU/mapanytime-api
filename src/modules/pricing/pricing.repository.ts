import { PRICINGCALCULATIONTYPE, PRICINGCOMPONENTTYPE, PRICINGSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export interface CreatePricingComponentInput {
  type: PRICINGCOMPONENTTYPE;
  calculationType?: PRICINGCALCULATIONTYPE;
  ratePercentage?: number;
  fixedAmount?: number;
  minFee?: number;
  maxFee?: number;
  providerId?: string;
  paymentMethodId?: string;
  sellerPlan?: string;
  categoryId?: string;
  storeId?: string;
}

export interface CreatePricingConfigurationInput {
  name: string;
  description?: string;
  currency?: string;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  status?: PRICINGSTATUS;
  components?: CreatePricingComponentInput[];
}

export default class PricingRepository {
  static async getActiveConfiguration() {
    const now = new Date();
    return prisma.pricingConfigurations.findFirst({
      where: {
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }],
      },
      include: {
        components: {
          where: { isActive: true },
          include: {
            provider: { select: { id: true, code: true, name: true } },
            paymentMethod: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  static async listConfigurations() {
    return prisma.pricingConfigurations.findMany({
      include: { components: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async createConfiguration(data: CreatePricingConfigurationInput) {
    const { components, ...configData } = data;
    return prisma.pricingConfigurations.create({
      data: {
        ...configData,
        components: components
          ? {
              create: components.map((c) => ({
                type: c.type,
                calculationType: c.calculationType ?? PRICINGCALCULATIONTYPE.PERCENTAGE,
                ratePercentage: c.ratePercentage,
                fixedAmount: c.fixedAmount,
                minFee: c.minFee,
                maxFee: c.maxFee,
                providerId: c.providerId,
                paymentMethodId: c.paymentMethodId,
                sellerPlan: c.sellerPlan,
                categoryId: c.categoryId,
                storeId: c.storeId,
              })),
            }
          : undefined,
      },
    });
  }
}
