import ProductRepository from './product.repository';
import CategoryService from '../categories/category.service';
import { prisma } from '../../utils/prisma';
import { buildPage } from '../../helpers/pagination.helper';

export interface CategoryTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Products filed directly on this category. */
  directCount: number;
  /** `directCount` plus every descendant's — what the filter displays. */
  totalCount: number;
  children: CategoryTreeNode[];
}

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

    const tagsInput = tags && tags.length > 0
      ? {
          // Only connect to existing tags — they must be seeded beforehand.
          // The controller validates `tags` against ALLOWED_PRODUCT_TAGS.
          create: tags.map((name: string) => ({
            tag: { connect: { name: name as unknown as any } },
          })),
        }
      : undefined;

    const newProduct = await ProductRepository.createProduct({
      ...productFields,
      store: { connect: { id: storeId } },
      category: { connect: { id: categoryId } },
      tags: tagsInput,
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

  /**
   * Resolves the seller behind a request and, when the request is scoped to one
   * store, asserts they own it. Omitting `storeId` means "every store I own".
   */
  private static async resolveSellerScope(userId: string, storeId: string | undefined) {
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

    return seller;
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
    const seller = await ProductService.resolveSellerScope(userId, storeId);

    let categoryIds: string[] | undefined;
    if (opts.categoryId) {
      categoryIds = await CategoryService.getCategoryDescendantIds(opts.categoryId);
    }

    const { items, total } = await ProductRepository.getMyProducts(storeId, seller.id, {
      skip: opts.skip,
      take: opts.limit,
      search: opts.search,
      categoryIds,
      sortBy: opts.sortBy,
      sortOrder: opts.sortOrder,
    });

    return buildPage(items, total, { page: opts.page, limit: opts.limit });
  }

  /**
   * The category hierarchy a seller actually sells in, pruned to the branches
   * their products occupy and rolled up with counts. Powers the "My products"
   * category filter, which must work in All-Stores mode (no `storeId`) where
   * there is no single store category tree to read from.
   */
  static async getMyCategories(userId: string, storeId: string | undefined) {
    const seller = await ProductService.resolveSellerScope(userId, storeId);

    const used = await ProductRepository.getUsedCategoryCounts(storeId, seller.id);
    if (used.length === 0) return [];

    const directCounts = new Map<string, number>();
    for (const row of used) {
      // `categoryId: { not: null }` in the query guarantees this is a string.
      directCounts.set(row.categoryId as string, row._count._all);
    }

    const nodes = await CategoryService.getAncestorClosure([...directCounts.keys()]);

    // Link by parentId so depth is unbounded — the tree is whatever the data is,
    // never a fixed number of nesting levels.
    const byId = new Map(
      nodes
        .map((node) => ({
          id: node.id,
          name: node.name,
          parentId: node.parentId,
          directCount: directCounts.get(node.id) ?? 0,
          totalCount: 0,
          children: [] as CategoryTreeNode[],
        }))
        .map((node) => [node.id, node]),
    );

    const roots: CategoryTreeNode[] = [];
    for (const node of byId.values()) {
      // A parent missing from the closure (soft-deleted mid-chain) would orphan
      // the branch, so treat such a node as a root rather than dropping it.
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    const rollUp = (node: CategoryTreeNode): number => {
      node.totalCount =
        node.directCount + node.children.reduce((sum, child) => sum + rollUp(child), 0);
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      return node.totalCount;
    };
    roots.forEach(rollUp);
    roots.sort((a, b) => a.name.localeCompare(b.name));

    return roots;
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
