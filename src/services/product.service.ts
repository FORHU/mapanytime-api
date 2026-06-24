import ProductRepository from '../repositories/product.repository';
import { Prisma } from '@prisma/client';

export default class ProductService {
  static async createProduct(userId: string, productData: Omit<Prisma.ProductsUncheckedCreateInput, 'StoreId'>) {
    const seller = await ProductRepository.getStoreByUserId(userId);

    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller.' };
    }

    if (!seller.store) {
      throw { status: 404, message: 'Store not found for this seller.' };
    }

    // Automatically inject the StoreId linked to the authenticated user
    return ProductRepository.createProduct({
      ...productData,
      storeId: seller.store.id,
    });
  }

  static async getMyProducts(userId: string) {
    const seller = await ProductRepository.getStoreByUserId(userId);
    if (!seller || !seller.store) throw { status: 404, message: 'Store not found.' };

    return ProductRepository.getProductsByStoreId(seller.store.id);
  }
}