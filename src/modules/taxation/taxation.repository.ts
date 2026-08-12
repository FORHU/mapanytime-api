import { prisma } from '../../utils/prisma';

export default class TaxationRepository {
  /**
   * Find category-specific commission rule or fall back to default active rule.
   */
  static async getCommissionRuleForCategory(categoryId?: string) {
    if (categoryId) {
      const categoryRule = await prisma.commissionRules.findUnique({
        where: { categoryId },
      });
      if (categoryRule && categoryRule.isActive) {
        return categoryRule;
      }
    }

    // Default global rule (where categoryId is null)
    return prisma.commissionRules.findFirst({
      where: {
        categoryId: null,
        isActive: true,
      },
    });
  }

  /**
   * Upsert a commission rule for a category or global default.
   */
  static async upsertCommissionRule(data: {
    categoryId?: string | null;
    commissionRate: number;
    fixedFee?: number;
    isActive?: boolean;
  }) {
    const categoryIdKey = data.categoryId ?? null;
    if (categoryIdKey) {
      return prisma.commissionRules.upsert({
        where: { categoryId: categoryIdKey },
        create: {
          categoryId: categoryIdKey,
          commissionRate: data.commissionRate,
          fixedFee: data.fixedFee ?? 0,
          isActive: data.isActive ?? true,
        },
        update: {
          commissionRate: data.commissionRate,
          fixedFee: data.fixedFee ?? 0,
          isActive: data.isActive ?? true,
        },
      });
    }

    const existingDefault = await prisma.commissionRules.findFirst({
      where: { categoryId: null },
    });

    if (existingDefault) {
      return prisma.commissionRules.update({
        where: { id: existingDefault.id },
        data: {
          commissionRate: data.commissionRate,
          fixedFee: data.fixedFee ?? 0,
          isActive: data.isActive ?? true,
        },
      });
    }

    return prisma.commissionRules.create({
      data: {
        categoryId: null,
        commissionRate: data.commissionRate,
        fixedFee: data.fixedFee ?? 0,
        isActive: data.isActive ?? true,
      },
    });
  }
}
