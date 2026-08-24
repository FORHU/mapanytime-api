import {
  PAYMENTFEEPAYER,
  PRICINGCALCULATIONTYPE,
  PRICINGCOMPONENTTYPE,
  PRICINGSTATUS,
  Prisma,
} from '@prisma/client';
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
  priority?: number;
  isActive?: boolean;
}

export interface CreatePricingConfigurationInput {
  name: string;
  description?: string;
  currency?: string;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  status?: PRICINGSTATUS;
  priority?: number;
  paymentFeePayerPolicy?: PAYMENTFEEPAYER;
  components?: CreatePricingComponentInput[];
}

export interface UpdatePricingConfigurationInput {
  name?: string;
  description?: string;
  currency?: string;
  effectiveFrom?: Date;
  effectiveUntil?: Date | null;
  priority?: number;
  paymentFeePayerPolicy?: PAYMENTFEEPAYER;
}

function toComponentData(c: CreatePricingComponentInput) {
  return {
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
    priority: c.priority ?? 0,
    isActive: c.isActive ?? true,
  };
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

  static async getConfigurationById(id: string) {
    return prisma.pricingConfigurations.findUnique({
      where: { id },
      include: {
        components: {
          include: {
            provider: { select: { id: true, code: true, name: true } },
            paymentMethod: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ type: 'asc' }, { priority: 'desc' }],
        },
      },
    });
  }

  static async createConfiguration(data: CreatePricingConfigurationInput) {
    const { components, ...configData } = data;
    return prisma.pricingConfigurations.create({
      data: {
        ...configData,
        components: components ? { create: components.map(toComponentData) } : undefined,
      },
      include: { components: true },
    });
  }

  static async updateConfiguration(id: string, data: UpdatePricingConfigurationInput) {
    return prisma.pricingConfigurations.update({
      where: { id },
      data,
      include: { components: true },
    });
  }

  static async addComponent(pricingId: string, component: CreatePricingComponentInput) {
    return prisma.pricingComponents.create({
      data: { pricingId, ...toComponentData(component) },
    });
  }

  static async updateComponent(id: string, component: Partial<CreatePricingComponentInput>) {
    return prisma.pricingComponents.update({
      where: { id },
      data: component as Prisma.PricingComponentsUpdateInput,
    });
  }

  static async deleteComponent(id: string) {
    return prisma.pricingComponents.delete({ where: { id } });
  }

  /**
   * Make one configuration the live one, in a single transaction.
   *
   * Two ACTIVE rows whose effective windows overlap is not a valid state: the
   * engine resolves whichever wins on priority then recency, so an admin
   * activating a second configuration would silently reprice every order with
   * no indication of which one took effect. Retiring the incumbent and
   * promoting the successor together means there is never a moment with two.
   */
  static async activateConfiguration(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.pricingConfigurations.updateMany({
        where: { status: 'ACTIVE', id: { not: id } },
        data: { status: 'ARCHIVED', effectiveUntil: new Date() },
      });

      return tx.pricingConfigurations.update({
        where: { id },
        data: { status: 'ACTIVE' },
        include: { components: true },
      });
    });
  }

  static async archiveConfiguration(id: string) {
    return prisma.pricingConfigurations.update({
      where: { id },
      data: { status: 'ARCHIVED', effectiveUntil: new Date() },
    });
  }
}
