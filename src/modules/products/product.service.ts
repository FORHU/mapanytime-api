import { Prisma } from '@prisma/client';
import ProductRepository from './product.repository';
import InventoryRepository from '../inventory/inventory.repository';
import CategoryService from '../categories/category.service';
import { prisma } from '../../utils/prisma';
import { buildPage } from '../../helpers/pagination.helper';
import { AllowedProductTag } from '../../helpers/product-tags';
import {
  normalizeProductOptions,
  toOptionsCreateInput,
  type RawProductOption,
} from './product-options.helper';

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
      tags?: AllowedProductTag[];
      isActive?: boolean;
      initialStock?: number;
      imageIds?: string[];
      options?: RawProductOption[];
    },
  ) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
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

    // `options` MUST be destructured out: left in `...productFields` it reaches
    // Prisma as a raw array where a nested write is expected.
    const { tags, initialStock = 0, imageIds, categoryId, options, ...productFields } = payload;

    const tagsInput =
      tags && tags.length > 0
        ? {
            // Only connect to existing tags — they must be seeded beforehand.
            // The controller validates `tags` against ALLOWED_PRODUCT_TAGS.
            create: tags.map((name) => ({
              tag: { connect: { name } },
            })),
          }
        : undefined;

    const normalizedOptions = normalizeProductOptions(options);
    const optionsInput =
      normalizedOptions.length > 0
        ? { create: toOptionsCreateInput(normalizedOptions) }
        : undefined;

    // One user intent, one commit. These were three unguarded writes: a failed
    // inventory.create left a product with NO inventory row, which then made
    // every later stock edit throw "Inventory record not found" forever.
    // Authorisation reads stay outside so they don't hold the transaction open.
    return prisma.$transaction(async (tx) => {
      const newProduct = await ProductRepository.createProduct(
        {
          ...productFields,
          store: { connect: { id: storeId } },
          category: { connect: { id: categoryId } },
          tags: tagsInput,
          options: optionsInput,
        },
        tx,
      );

      await tx.inventory.create({
        data: {
          productId: newProduct.id,
          storeId: storeId,
          quantityOnHand: initialStock,
          quantityReserved: 0,
        },
      });

      if (imageIds && imageIds.length > 0) {
        await tx.productImages.createMany({
          data: imageIds.map((fileId, index) => ({
            productId: newProduct.id,
            fileId,
            isPrimary: index === 0,
            displayOrder: index,
          })),
        });
      }

      return newProduct;
    });
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
      brand?: string | null;
      description?: string | null;
      categoryId?: string;
      isActive?: boolean;
      tags?: AllowedProductTag[];
      stock?: number;
      options?: RawProductOption[];
    },
  ) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    const store = await ProductRepository.getStoreById(product.storeId);
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'Unauthorized to update this product.' };
    }

    // `options`, like `tags`, MUST be destructured out — left in `...fields` it
    // reaches Prisma as a raw array where a nested write is expected.
    const { tags, categoryId, brand, description, stock, options, ...fields } = payload;

    // `brand` and `description` are nullable columns, so an empty string from a
    // form means "cleared" and is stored as NULL rather than ''.
    const blankToNull = (v: string | null | undefined) =>
      v === null || v?.trim() === '' ? null : v;

    const data: Prisma.ProductsUpdateInput = {
      ...fields,
      ...(brand !== undefined ? { brand: blankToNull(brand) } : {}),
      ...(description !== undefined ? { description: blankToNull(description) } : {}),
      // Relation form rather than the raw `categoryId` scalar: that scalar only
      // exists on ProductsUncheckedUpdateInput, and mixing it with the nested
      // `tags` write below makes Prisma resolve the whole payload as unchecked,
      // where `tag: { connect }` is not a valid nested create.
      ...(categoryId !== undefined ? { category: { connect: { id: categoryId } } } : {}),
      // Replace-all semantics: a provided array swaps out every join row in the
      // same update; omitting `tags` leaves existing tags untouched.
      ...(tags !== undefined
        ? {
            tags: {
              deleteMany: {},
              create: tags.map((name) => ({
                tag: { connect: { name } },
              })),
            },
          }
        : {}),

      ...(options !== undefined
        ? {
            options: {
              deleteMany: {},
              create: toOptionsCreateInput(normalizeProductOptions(options)),
            },
          }
        : {}),
    };

    // Fields and stock are one user intent, so they commit together. Sending
    // them as two sequential requests meant a failed stock adjustment left the
    // field changes already saved, with no rollback and no way to tell.
    return prisma.$transaction(async (tx) => {
      if (stock !== undefined) {
        await InventoryRepository.adjustWithin(tx, productId, stock, userId);
      }

      // Updated after the adjustment so the returned `inventory` is current.
      return ProductRepository.updateProduct(productId, data, tx);
    });
  }

  static async deleteProduct(userId: string, productId: string) {
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    const store = await ProductRepository.getStoreById(product.storeId);
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'Unauthorized to delete this product.' };
    }

    return ProductRepository.deleteProduct(productId);
  }
}
