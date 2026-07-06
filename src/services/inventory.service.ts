import InventoryRepository from '../repositories/inventory.repository';
import ProductRepository from '../repositories/product.repository';

export default class InventoryService {
  static async restock(userId: string, productId: string, addedQuantity: number) {
    // 1. Verify the seller profile exists and is approved
    const seller = await ProductRepository.getStoreByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    // 2. Verify the product exists
    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    // 3. Verify the seller owns the store that this product belongs to
    const ownsStore = seller.stores.some((s) => s.id === product.storeId);
    if (!ownsStore) {
      throw { status: 403, message: 'You do not have administrative access to this product.' };
    }

    // 4. Execute the restock
    return InventoryRepository.restock(productId, addedQuantity);
  }
}
