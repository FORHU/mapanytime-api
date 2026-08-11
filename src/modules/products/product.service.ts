import ProductRepository from './product.repository';
import CategoryService from '../../services/category.service';
import { prisma } from '../../utils/prisma';

export default class ProductService {
  static async createProduct(
    userId: string,
    storeId: string,
    payload: {
      name: string;
      price: number;
      brand?: string;
      description?: string;
      categoryId: string;
      tags?: string[];
      isActive?: boolean;
      initialStock?: number;
    },
  ) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller) {
      throw { status: 403, message: 'Only approved sellers can create products.' };
    }

    const store = await ProductRepository.getStoreById(storeId);
    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    if (store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not own this store.' };
    }

    if (store.approvalStatus !== 'ACTIVE') {
      throw { status: 403, message: 'Store must be approved before adding products.' };
    }

    const { tags, initialStock = 0, categoryId, ...productFields } = payload;

    const newProduct = await ProductRepository.createProduct({
      ...productFields,
      store: { connect: { id: storeId } },
      category: { connect: { id: categoryId } },
      tags:
        tags && tags.length > 0
          ? {
              create: tags.map((name) => ({
                tag: {
                  connectOrCreate: {
                    where: { name },
                    create: { name },
                  },
                },
              })),
            }
          : undefined,
    });

    await prisma.inventory.create({
      data: {
        productId: newProduct.id,
        storeId: storeId,
        quantityOnHand: initialStock,
        quantityReserved: 0,
      },
    });

    return newProduct;
  }

  static async getMyProducts(userId: string, storeId: string) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller) {
      throw { status: 403, message: 'Only sellers can view store products.' };
    }

    const store = await ProductRepository.getStoreById(storeId);
    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    if (store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not own this store.' };
    }

    return ProductRepository.getProductsByStoreId(storeId);
  }

  static async getAllProducts(filters: {
    storeId?: string;
    categoryId?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    page: number;
    limit: number;
    skip: number;
  }) {
    let categoryIds: string[] | undefined;
    if (filters.categoryId) {
      categoryIds = await CategoryService.getCategoryDescendantIds(filters.categoryId);
    }

    const { items, total } = await ProductRepository.getAllProducts({
      storeId: filters.storeId,
      categoryIds,
      search: filters.search,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      skip: filters.skip,
      take: filters.limit,
    });

    return {
      items,
      meta: {
        total,
        page: filters.page,
        limit: filters.limit,
        totalPages: Math.ceil(total / filters.limit) || 1,
      },
    };
  }

  static async updateProduct(
    userId: string,
    productId: string,
    payload: {
      name?: string;
      price?: number;
      brand?: string;
      description?: string;
      categoryId?: string;
      isActive?: boolean;
    },
  ) {
    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    const store = await ProductRepository.getStoreById(product.storeId);
    const seller = await ProductRepository.getSellerByUserId(userId);

    if (!seller || !store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'Unauthorized to update this product.' };
    }

    return ProductRepository.updateProduct(productId, payload);
  }

  static async deleteProduct(userId: string, productId: string) {
    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    const store = await ProductRepository.getStoreById(product.storeId);
    const seller = await ProductRepository.getSellerByUserId(userId);

    if (!seller || !store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'Unauthorized to delete this product.' };
    }

    return ProductRepository.deleteProduct(productId);
  }
}
