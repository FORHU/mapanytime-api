import OrderRepository from '../repositories/order.repository';
import ProductRepository from '../repositories/product.repository';

export default class OrderService {
  static async createOrder(payload: {
    buyerId: string;
    storeId: string;
    type: 'DELIVERY' | 'PICKUP';
    paymentMethod: 'BANK' | 'GCASH' | 'CASH_ON_DELIVERY';
    items: { productId: string; quantity: number }[];
  }) {
    // Add additional business logic here if needed
    return OrderRepository.createOrder(payload);
  }

  static async completeOrder(userId: string, orderId: string, storeId: string) {
    // Confirm user is an authorized seller
    const seller = await ProductRepository.getStoreByUserId(userId);
    if (!seller || seller.applicationStatus !== 'APPROVED') {
      throw { status: 403, message: 'User is not an approved seller profile.' };
    }

    // Confirm seller owns the store executing the modification
    const ownsStore = seller.stores.some((s) => s.id === storeId);
    if (!ownsStore) {
      throw { status: 403, message: 'You do not have administrative access to this branch.' };
    }

    return OrderRepository.completeOrder(orderId, storeId);
  }
}
