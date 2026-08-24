import RedisUtil from '../../utils/redis.util';
import ProductRepository from '../products/product.repository';
import PricingEngineService from '../pricing/pricing-engine.service';
import { computeItemDiscount, applyBogoBonus } from '../orders/pricing.util';
import { prisma } from '../../utils/prisma';

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
  static async getCart(userId: string): Promise<CartPayload> {
    const cartData = await RedisUtil.client.get(`cart:${userId}`);
    return cartData ? JSON.parse(cartData) : { storeId: null, items: [] };
  }

  static async addToCart(userId: string, storeId: string, productId: string, quantity: number) {
    const cart = await this.getCart(userId);

    if (quantity === 0) {
      const existingItemIndex = cart.items.findIndex(
        (item: CartItem) => item.productId === productId,
      );
      if (existingItemIndex >= 0) {
        cart.items.splice(existingItemIndex, 1);
      }
      if (cart.items.length === 0) {
        cart.storeId = null;
      }
      await RedisUtil.client.setEx(`cart:${userId}`, 604800, JSON.stringify(cart));
      return cart;
    }

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

    const product = await ProductRepository.getProductById(productId);
    if (!product) throw { status: 404, message: 'Product not found.' };
    if (product.storeId !== storeId)
      throw { status: 400, message: 'Product does not belong to this store.' };
    if (!product.isActive) throw { status: 400, message: 'Product is not available for purchase.' };

    if (cart.storeId && cart.storeId !== storeId && cart.items.length > 0) {
      throw {
        status: 400,
        message:
          'You can only add items from one store at a time. Clear your cart to switch stores.',
      };
    }

    const inventory = await prisma.inventory.findFirst({
      where: { productId: productId },
    });

    if (!inventory) {
      throw { status: 404, message: 'Inventory record not found for this product.' };
    }

    const availableStock = inventory.quantityOnHand - inventory.quantityReserved;

    if (quantity > availableStock) {
      throw {
        status: 400,
        message: `Insufficient stock for ${product.name}. Only ${availableStock} left.`,
      };
    }

    cart.storeId = storeId;

    // Bumps the stored quantity to include any free BOGO bonus units the
    // buyer's requested (paid) quantity earns — see applyBogoBonus for why
    // this is the only place that needs to know about the bonus.
    const storedQuantity = await applyBogoBonus(prisma, {
      productId,
      storeId,
      quantity,
      availableStock,
    });

    const existingItemIndex = cart.items.findIndex(
      (item: CartItem) => item.productId === productId,
    );
    if (existingItemIndex >= 0) {
      cart.items[existingItemIndex].quantity = storedQuantity;
    } else {
      cart.items.push({ productId, quantity: storedQuantity, unitPrice: Number(product.price) });
    }

    await RedisUtil.client.setEx(`cart:${userId}`, 604800, JSON.stringify(cart));

    return cart;
  }

  static async removeItems(userId: string, productIds: string[]) {
    const cart = await this.getCart(userId);
    if (!cart || cart.items.length === 0) return cart;

    const idSet = new Set(productIds);
    cart.items = cart.items.filter((item: CartItem) => !idSet.has(item.productId));

    if (cart.items.length === 0) {
      cart.storeId = null;
      await RedisUtil.client.del(`cart:${userId}`);
    } else {
      await RedisUtil.client.setEx(`cart:${userId}`, 604800, JSON.stringify(cart));
    }
    return cart;
  }

  static async clearCart(userId: string) {
    await RedisUtil.client.del(`cart:${userId}`);
    return { message: 'Cart cleared successfully' };
  }

  /**
   * Read-only pricing preview for the buyer's cart (or a selected subset of it).
   *
   * Goes through `PricingEngineService` — the same engine
   * `OrderService.createOrder` charges from — so the goods maths cannot drift
   * from checkout. It previously used `TaxationService`, a second engine with
   * its own 5% commission fallback against the engine's 2%. See FLAGS.md F28.
   *
   * The payment fee is deliberately **not** included. It depends on the method
   * the buyer has not chosen yet, and it genuinely differs per method — GCash
   * 2.23%, Maya 1.79%, card 3.125% + ₱13.39. `GET /payments/methods?amount=`
   * returns the fee and final total for each method once there is a total to
   * quote against. So `totalAmount` here is what the goods cost, not the final
   * charge, and the client must present it that way.
   */
  static async previewPricing(userId: string, productIds?: string[]) {
    const cart = await this.getCart(userId);
    if (!cart.storeId || cart.items.length === 0) {
      throw { status: 400, message: 'Your cart is empty.' };
    }

    let items = cart.items;
    if (productIds && productIds.length > 0) {
      const idSet = new Set(productIds);
      items = items.filter((item) => idSet.has(item.productId));
      if (items.length === 0) {
        throw { status: 400, message: 'None of the selected items are currently in your cart.' };
      }
    }

    let subtotalAmount = 0;
    let totalDiscount = 0;
    let primaryCategoryId: string | undefined;
    const itemBreakdowns = [];

    for (const item of items) {
      const product = await ProductRepository.getProductById(item.productId);
      if (!product || !product.isActive) continue;

      if (!primaryCategoryId && product.categoryId) {
        primaryCategoryId = product.categoryId;
      }

      const unitPrice = Number(product.price);
      subtotalAmount += unitPrice * item.quantity;

      const { itemDiscount, appliedAdId, freeUnits } = await computeItemDiscount(prisma, {
        productId: item.productId,
        quantity: item.quantity,
        storeId: cart.storeId,
        unitPrice,
      });
      totalDiscount += itemDiscount;

      itemBreakdowns.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        discountAmount: itemDiscount,
        appliedAdId,
        freeUnits,
      });
    }

    const pricing = await PricingEngineService.calculateOrderPricing({
      subtotalAmount,
      discountAmount: totalDiscount,
      storeId: cart.storeId,
      categoryId: primaryCategoryId,
    });

    return {
      items: itemBreakdowns,
      subtotalAmount: pricing.subtotalAmount,
      discountAmount: pricing.discountAmount,
      /** Cost of the goods. The payment fee is added at method selection. */
      totalAmount: pricing.orderAmount,
      /**
       * Flags to the client that this is not yet the amount that will be
       * charged, so a cart total is never mistaken for a checkout total.
       */
      paymentFeeIncluded: false,
    };
  }
}
