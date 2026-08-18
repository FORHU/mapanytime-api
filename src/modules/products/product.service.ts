import ProductRepository from './product.repository';
import CategoryService from '../categories/category.service';
import { prisma } from '../../utils/prisma';
import { buildPage } from '../../helpers/pagination.helper';

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
      imageIds?: string[];
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

    const { tags, initialStock = 0, imageIds, categoryId, ...productFields } = payload;

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

    if (imageIds && imageIds.length > 0) {
      await prisma.productImages.createMany({
        data: imageIds.map((fileId, index) => ({
          productId: newProduct.id,
          fileId,
          isPrimary: index === 0,
          displayOrder: index,
        })),
      });
    }

    return newProduct;
  }

  static async getMyProducts(
    userId: string,
    storeId: string | undefined,
    opts: {
      page: number;
      limit: number;
      skip: number;
      search?: string;
      categoryId?: string;
      sortBy?: 'price' | 'name' | 'createdAt';
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller) {
      throw { status: 403, message: 'Only sellers can view store products.' };
    }

    if (storeId) {
      const store = await ProductRepository.getStoreById(storeId);
      if (!store) {
        throw { status: 404, message: 'Store not found.' };
      }

      if (store.sellerId !== seller.id) {
        throw { status: 403, message: 'You do not own this store.' };
      }
    }

    const { items, total } = await ProductRepository.getMyProducts(storeId, seller.id, {
      skip: opts.skip,
      take: opts.limit,
      search: opts.search,
      categoryId: opts.categoryId,
      sortBy: opts.sortBy,
      sortOrder: opts.sortOrder,
    });

    return buildPage(items, total, { page: opts.page, limit: opts.limit });
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

    return buildPage(items, total, { page: filters.page, limit: filters.limit });
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
