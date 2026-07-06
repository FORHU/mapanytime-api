import ProductRepository from '../repositories/product.repository';
import { Prisma } from '@prisma/client';

export default class ProductService {
  // PRIVATE UTILITY METHODS
  private static async validateSellerAndStoreAccess(userId: string, storeId: string) {
    // Single database trip
    const store = await ProductRepository.getStoreById(storeId);

    if (!store) {
      throw { status: 404, message: 'Store branch not found.' };
    }

    // Verify ownership directly through the joined seller object
    if (store.seller.userId !== userId) {
      throw { status: 403, message: 'You do not own this store branch.' };
    }

    // Verify approval status
    if (store.seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller.' };
    }

    return { store };
  }

  private static async validateProductAccess(userId: string, productId: string) {
    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    // Ensure the seller owns the product's store
    await this.validateSellerAndStoreAccess(userId, product.storeId);

    return product;
  }

  // CORE BUSINESS LOGIC
  static async createProduct(
    userId: string,
    storeId: string,
    productData: {
      name: string;
      price: number;
      brand?: string;
      description?: string;
      categoryId?: string;
      tags?: string[];
      isActive?: boolean;
      initialStock?: number;
    },
  ) {
    const { store } = await this.validateSellerAndStoreAccess(userId, storeId);

    const isVerified = store.documentVerifications.some(
      (doc) => doc.verificationStatus === 'APPROVED',
    );

    if (!isVerified) {
      throw {
        status: 403,
        message: 'This store branch is not yet verified. Please wait for admin approval.',
      };
    }

    const tagsData = productData.tags
      ? { create: productData.tags.map((tag) => ({ name: tag })) }
      : undefined;

    return ProductRepository.createProduct({
      name: productData.name,
      price: productData.price,
      brand: productData.brand,
      description: productData.description,
      isActive: productData.isActive,
      store: { connect: { id: storeId } },
      ...(productData.categoryId && { category: { connect: { id: productData.categoryId } } }),
      ...(tagsData && { tags: tagsData }),
      inventory: {
        create: [
          {
            quantityOnHand: productData.initialStock || 0,
            store: { connect: { id: storeId } },
          },
        ],
      },
    });
  }

  static async getMyProducts(userId: string, storeId: string) {
    await this.validateSellerAndStoreAccess(userId, storeId);
    return ProductRepository.getProductsByStoreId(storeId);
  }

  static async updateProduct(
    userId: string,
    productId: string,
    updateData: Prisma.ProductsUpdateInput,
  ) {
    await this.validateProductAccess(userId, productId);
    return ProductRepository.updateProduct(productId, updateData);
  }

  static async deleteProduct(userId: string, productId: string) {
    await this.validateProductAccess(userId, productId);
    return ProductRepository.deleteProduct(productId);
  }
}
