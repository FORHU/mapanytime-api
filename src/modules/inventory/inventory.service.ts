import InventoryRepository from './inventory.repository';
import ProductRepository from '../products/product.repository';
import { assertStoreInScope } from '../organization/storeAccess';
import type { AuthUser } from '../auth/auth.repository';

/**
 * A merchant acting on their own store must still be an approved seller — the
 * rule the owner-only checks enforced before stock became organization-scoped.
 *
 * It is deliberately not applied to organization staff: a `SELLER_USER` has no
 * `Sellers` row of their own, and their authority comes from the store
 * assignment rather than from a seller application.
 */
async function assertSellerApprovedIfOwner(user: AuthUser) {
  const seller = await ProductRepository.getSellerByUserId(user.id);
  if (seller && seller.applicationStatus !== 'APPROVED') {
    throw { status: 403, message: 'User is not an approved seller profile.' };
  }
}

export default class InventoryService {
  static async restock(user: AuthUser, productId: string, addedQuantity: number) {
    await assertSellerApprovedIfOwner(user);

    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    // Organization-scoped rather than owner-only: stock is the assigned
    // SELLER_USER's daily job, and the old check compared their own Sellers.id
    // against the store's owner, which they can never match.
    await assertStoreInScope(user, product.storeId);

    return InventoryRepository.restock(productId, addedQuantity);
  }

  static async adjust(user: AuthUser, productId: string, targetQuantity: number) {
    await assertSellerApprovedIfOwner(user);

    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    await assertStoreInScope(user, product.storeId);

    // The delta is computed inside a transaction on the server; the client only
    // sends the absolute target so stock can move up or down safely.
    return InventoryRepository.adjust(productId, targetQuantity, user.id);
  }

  static async getInventory(productId: string) {
    const inventory = await InventoryRepository.getInventoryByProductId(productId);
    if (!inventory) {
      throw { status: 404, message: 'Inventory record not found for this product.' };
    }
    return inventory;
  }
}
