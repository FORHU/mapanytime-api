import InventoryRepository from '../repositories/inventory.repository';
import ProductRepository from '../repositories/product.repository';

export default class InventoryService {
  static async restock(userId: string, productId: string, addedQuantity: number) {
    // Verify the seller profile exists and is approved
    const seller = await ProductRepository.getSellerByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    // Verify the product exists
    const product = await ProductRepository.getProductById(productId);
    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    // Verify the seller owns the store that this product belongs to
    const store = await ProductRepository.getStoreById(product.storeId);
    if (!store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not have administrative access to this product.' };
    }

    // Execute the restock
    return InventoryRepository.restock(productId, addedQuantity);
  }
}
