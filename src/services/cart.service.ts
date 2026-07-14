import RedisUtil from '../utils/redis.util';
import ProductRepository from '../repositories/product.repository';
import { prisma } from '../utils/prisma';

interface CartItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

interface CartPayload {
  storeId: string | null;
  items: CartItem[];
}

export default class CartService {
  // Retrieves the current cart for a user.
  static async getCart(userId: string): Promise<CartPayload> {
    const cartData = await RedisUtil.client.get(`cart:${userId}`);
    return cartData ? JSON.parse(cartData) : { storeId: null, items: [] };
  }

  // Adds an item to the cart. Enforces single-store checkout rule.
  static async addToCart(userId: string, storeId: string, productId: string, quantity: number) {
    // Validate the store exists and is legally allowed to operate
    const store = await prisma.stores.findUnique({
      where: { id: storeId },
      select: { isActive: true },
    });

    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }
    if (!store.isActive) {
      throw {
        status: 400,
        message: 'This store is currently inactive and cannot accept new orders.',
      };
    }

    // Validate the product exists and belongs to the specified store
    const product = await ProductRepository.getProductById(productId);
    if (!product) throw { status: 404, message: 'Product not found.' };
    if (product.storeId !== storeId)
      throw { status: 400, message: 'Product does not belong to this store.' };
    if (!product.isActive) throw { status: 400, message: 'Product is not available for purchase.' };

    // Fetch the current cart first, so we know how many items are already in it
    const cart = await this.getCart(userId);

    // Restrict carts to a single store per transaction
    if (cart.storeId && cart.storeId !== storeId && cart.items.length > 0) {
      throw {
        status: 400,
        message:
          'You can only add items from one store at a time. Clear your cart to switch stores.',
      };
    }

    // Validate Inventory Stock
    const inventory = await prisma.inventory.findUnique({
      where: { productId: productId },
    });

    if (!inventory) {
      throw { status: 404, message: 'Inventory record not found for this product.' };
    }

    const availableStock = inventory.quantityOnHand - inventory.quantityReserved;

    // Check existing quantity in the cart
    const existingItemIndex = cart.items.findIndex(
      (item: CartItem) => item.productId === productId,
    );
    const existingQuantity = existingItemIndex >= 0 ? cart.items[existingItemIndex].quantity : 0;

    // The total they want to have in their cart vs what is actually on the shelf
    const totalRequestedQuantity = existingQuantity + quantity;

    if (totalRequestedQuantity > availableStock) {
      throw {
        status: 400,
        message: `Insufficient stock for ${product.name}. Only ${availableStock} left.`,
      };
    }

    // Update the Cart
    cart.storeId = storeId;

    if (existingItemIndex >= 0) {
      cart.items[existingItemIndex].quantity += quantity;
    } else {
      cart.items.push({ productId, quantity, unitPrice: product.price });
    }

    // Save back to Redis with a 7-day expiration time (604800 seconds)
    await RedisUtil.client.setEx(`cart:${userId}`, 604800, JSON.stringify(cart));

    return cart;
  }

  // Clears the user's entire cart (used after successful checkout or manual clear).
  static async clearCart(userId: string) {
    await RedisUtil.client.del(`cart:${userId}`);
    return { message: 'Cart cleared successfully' };
  }
}
