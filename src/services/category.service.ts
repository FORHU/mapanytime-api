import CategoryRepository from '../repositories/category.repository';
import ProductRepository from '../repositories/product.repository';
import { prisma } from '../utils/prisma';

export default class CategoryService {
  static async createCategory(
    userId: string,
    storeId: string,
    data: { name: string; description?: string },
  ) {
    const seller = await ProductRepository.getStoreByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller.' };
    }

    const store = await prisma.stores.findUnique({
      where: { id: storeId },
      include: { documentVerifications: true },
    });

    if (!store) throw { status: 404, message: 'Store branch not found.' };

    const isVerified = store.documentVerifications.some(
      (doc) => doc.verificationStatus === 'APPROVED',
    );

    if (!isVerified) {
      throw { status: 403, message: 'This store branch is not verified.' };
    }
    const existingCategory = await prisma.categories.findUnique({
      where: {
        name_storeId: {
          name: data.name,
          storeId: storeId,
        },
      },
    });

    if (existingCategory) {
      throw { status: 409, message: 'A category with this name already exists in your store.' };
    }

    return CategoryRepository.createCategory({
      ...data,
      requestedById: userId,
      storeId: storeId, // Pass the storeId to the repository
    });
  }
  static async listCategories(storeId: string) {
    return CategoryRepository.getCategoriesByStoreId(storeId);
  }
}
