import ProductRepository from '../repositories/product.repository';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class ProductService {
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
    },
  ) {
    const seller = await ProductRepository.getStoreByUserId(userId);

    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller.' };
    }

    // Verify the seller actually owns the store they are trying to add a product to
    const ownsStore = seller.stores.some((s) => s.id === storeId);
    if (!ownsStore) {
      throw { status: 403, message: 'You do not own this store branch.' };
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
    });
  }

  static async getMyProducts(userId: string, storeId: string) {
    const seller = await ProductRepository.getStoreByUserId(userId);
    if (!seller) throw { status: 404, message: 'Seller profile not found.' };

    const ownsStore = seller.stores.some((s) => s.id === storeId);
    if (!ownsStore) throw { status: 403, message: 'You do not own this store branch.' };

    return ProductRepository.getProductsByStoreId(storeId);
  }

  static async updateProduct(
    userId: string,
    productId: string,
    updateData: Prisma.ProductsUpdateInput,
  ) {
    const seller = await ProductRepository.getStoreByUserId(userId);
    if (!seller) throw { status: 404, message: 'Seller not found.' };

    const product = await ProductRepository.getProductById(productId);
    if (!product) throw { status: 404, message: 'Product not found.' };

    // Check if the product's storeId exists in the seller's array of stores
    const ownsStore = seller.stores.some((s) => s.id === product.storeId);
    if (!ownsStore) {
      throw { status: 403, message: 'You do not have permission to modify this product.' };
    }

    return ProductRepository.updateProduct(productId, updateData);
  }

  static async deleteProduct(userId: string, productId: string) {
    const seller = await ProductRepository.getStoreByUserId(userId);
    if (!seller) throw { status: 404, message: 'Seller not found.' };

    const product = await ProductRepository.getProductById(productId);
    if (!product) throw { status: 404, message: 'Product not found.' };

    const ownsStore = seller.stores.some((s) => s.id === product.storeId);
    if (!ownsStore) {
      throw { status: 403, message: 'You do not have permission to delete this product.' };
    }

    return ProductRepository.deleteProduct(productId);
  }
}
