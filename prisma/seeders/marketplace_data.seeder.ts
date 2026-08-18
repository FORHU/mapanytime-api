import {
  PrismaClient,
  FULLFILLMENTTYPE,
  ORDERSTATUS,
  PAYMENTSTATUS,
  SETTLEMENTSTATUS,
  PAYOUTSTATUS,
  SHIPMENTSTATUS,
  RETURNSTATUS,
  RESERVATIONSTATUS,
  INVENTORYMOVEMENTTYPE,
  INVENTORYREFERENCETYPE,
  ADDRESSTYPE,
  INVITESTATUS,
} from '@prisma/client';

export async function seedMarketplaceData(prisma: PrismaClient) {
  console.log('🌱 Seeding extended operational marketplace data for all models...');

  // 1. Fetch baseline users, buyers, sellers, stores, and products
  const buyerUser = await prisma.users.findUnique({ where: { email: 'buyer@example.com' } });
  const dualUser = await prisma.users.findUnique({ where: { email: 'dual@example.com' } });
  const adminUser = await prisma.users.findUnique({ where: { email: 'admin@example.com' } });

  const buyer = await prisma.buyers.findUnique({ where: { userId: buyerUser?.id } });
  const dualBuyer = await prisma.buyers.findUnique({ where: { userId: dualUser?.id } });

  const stores = await prisma.stores.findMany({
    include: {
      seller: true,
      products: {
        include: {
          inventory: true,
        },
      },
    },
  });

  if (!buyer || stores.length === 0) {
    console.log('⚠️ Missing baseline buyers or stores. Skipping extended marketplace seeding.');
    return;
  }

  const primaryStore = stores[0]; // Baguio Fresh Market
  const secondaryStore = stores[1] || stores[0]; // Session Brews Cafe

  // ── 2. Commission Rules ──────────────────────────────────────────────────
  console.log('  → Seeding CommissionRules...');
  const categories = await prisma.categories.findMany();
  for (const cat of categories) {
    await prisma.commissionRules.upsert({
      where: { categoryId: cat.id },
      update: {},
      create: {
        categoryId: cat.id,
        commissionRate: cat.name.includes('Tech')
          ? 0.05
          : cat.name.includes('Fashion')
            ? 0.1
            : 0.08,
        fixedFee: 10.0,
        isActive: true,
      },
    });
  }

  // ── 3. Buyer Addresses ───────────────────────────────────────────────────
  console.log('  → Seeding BuyerAddresses...');
  await prisma.buyerAddresses.deleteMany({ where: { buyerId: buyer.id } });
  await prisma.buyerAddresses.create({
    data: {
      buyerId: buyer.id,
      addressType: ADDRESSTYPE.SHIPPING,
      recipientName: 'Sara Smith',
      phoneNumber: '+639171234567',
      addressLine1: 'Unit 4B, Burnham Heights Condo',
      addressLine2: 'Kisad Road',
      barangay: 'Burnham-Legarda',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
      isDefault: true,
    },
  });

  if (dualBuyer) {
    await prisma.buyerAddresses.deleteMany({ where: { buyerId: dualBuyer.id } });
    await prisma.buyerAddresses.create({
      data: {
        buyerId: dualBuyer.id,
        addressType: ADDRESSTYPE.SHIPPING,
        recipientName: 'Alex Mercer',
        phoneNumber: '+639189876543',
        addressLine1: '12 Session Road',
        barangay: 'Session-Governor Pack',
        city: 'Baguio City',
        province: 'Benguet',
        zipCode: '2600',
        country: 'Philippines',
        isDefault: true,
      },
    });
  }

  // ── 4. Product Options, Option Values & Product Variants ─────────────────
  console.log('  → Seeding ProductOptions & ProductVariants...');
  const sampleProduct = primaryStore.products[0];
  if (sampleProduct) {
    await prisma.productVariants.deleteMany({ where: { productId: sampleProduct.id } });
    await prisma.productOptions.deleteMany({ where: { productId: sampleProduct.id } });

    const optionSize = await prisma.productOptions.create({
      data: {
        productId: sampleProduct.id,
        name: 'Size / Weight',
        position: 1,
        values: {
          create: [{ value: '250g' }, { value: '500g' }, { value: '1kg' }],
        },
      },
      include: { values: true },
    });

    await prisma.productVariants.create({
      data: {
        productId: sampleProduct.id,
        sku: `SKU-${sampleProduct.id.slice(-5)}-250G`,
        variantName: '250g Pack',
        price: Number(sampleProduct.price),
        costPrice: Number(sampleProduct.price) * 0.6,
        isActive: true,
        optionValues: {
          create: {
            optionValueId: optionSize.values[0].id,
          },
        },
      },
    });

    await prisma.productVariants.create({
      data: {
        productId: sampleProduct.id,
        sku: `SKU-${sampleProduct.id.slice(-5)}-500G`,
        variantName: '500g Pack',
        price: Number(sampleProduct.price) * 1.8,
        costPrice: Number(sampleProduct.price) * 1.1,
        isActive: true,
        optionValues: {
          create: {
            optionValueId: optionSize.values[1].id,
          },
        },
      },
    });
  }

  // ── 5. Supplier Products ─────────────────────────────────────────────────
  console.log('  → Seeding SupplierProducts...');
  for (const product of primaryStore.products.slice(0, 3)) {
    await prisma.supplierProducts.upsert({
      where: { supplierSku: `SUP-SKU-${product.id.slice(-5)}` },
      update: {},
      create: {
        sellerId: primaryStore.sellerId,
        productId: product.id,
        supplierSku: `SUP-SKU-${product.id.slice(-5)}`,
        costPrice: Number(product.price) * 0.65,
        minimumOrderQty: 5,
        supplyLeadDays: 2,
        isAvailable: true,
      },
    });
  }

  // ── 6. Orders & OrderItems ───────────────────────────────────────────────
  console.log('  → Seeding Orders & OrderItems...');
  const orderProduct1 = primaryStore.products[0];
  const orderProduct2 = primaryStore.products[1] || primaryStore.products[0];

  const subtotal1 = Number(orderProduct1.price) * 2;
  const tax1 = Math.round(subtotal1 * 0.12 * 100) / 100;
  const fee1 = Math.round(subtotal1 * 0.08 * 100) / 100;
  const net1 = subtotal1 - fee1;

  const completedOrder = await prisma.orders.create({
    data: {
      buyerId: buyer.id,
      storeId: primaryStore.id,
      storeName: primaryStore.storeName,
      sellerName: 'Grace Piatos',
      storeAddressSnapshot: 'Baguio City Public Market, Magsaysay Ave, Baguio',
      sellerPhoneSnapshot: '+639171112222',
      totalAmount: subtotal1 + tax1,
      subtotalAmount: subtotal1,
      taxAmount: tax1,
      marketplaceFeeAmount: fee1,
      sellerNetAmount: net1,
      type: FULLFILLMENTTYPE.PICKUP,
      status: ORDERSTATUS.COMPLETED,
      pickupAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
      orderitems: {
        create: [
          {
            productId: orderProduct1.id,
            productName: orderProduct1.name,
            quantity: 2,
            unitPrice: Number(orderProduct1.price),
          },
        ],
      },
    },
  });

  const processingOrder = await prisma.orders.create({
    data: {
      buyerId: buyer.id,
      storeId: secondaryStore.id,
      storeName: secondaryStore.storeName,
      sellerName: 'Alex Mercer',
      storeAddressSnapshot: 'Session Road, Baguio City',
      totalAmount: Number(orderProduct2.price),
      subtotalAmount: Number(orderProduct2.price),
      taxAmount: Math.round(Number(orderProduct2.price) * 0.12 * 100) / 100,
      marketplaceFeeAmount: Math.round(Number(orderProduct2.price) * 0.08 * 100) / 100,
      sellerNetAmount: Number(orderProduct2.price) * 0.92,
      type: FULLFILLMENTTYPE.PICKUP,
      status: ORDERSTATUS.PROCESSING,
      pickupAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      orderitems: {
        create: [
          {
            productId: orderProduct2.id,
            productName: orderProduct2.name,
            quantity: 1,
            unitPrice: Number(orderProduct2.price),
          },
        ],
      },
    },
  });

  // ── 7. Payments ──────────────────────────────────────────────────────────
  console.log('  → Seeding Payments...');
  const cashMethod = await prisma.paymentMethods.findFirst({ where: { code: 'COD' } });
  const gcashMethod = await prisma.paymentMethods.findFirst({ where: { code: 'GCASH' } });

  await prisma.payments.create({
    data: {
      orderId: completedOrder.id,
      amount: completedOrder.totalAmount,
      providerId: cashMethod?.providerId,
      paymentMethodId: cashMethod?.id,
      status: PAYMENTSTATUS.COMPLETED,
      referenceNumber: `PAY-COD-${completedOrder.id.slice(-8).toUpperCase()}`,
      paidAt: completedOrder.completedAt,
    },
  });

  await prisma.payments.create({
    data: {
      orderId: processingOrder.id,
      amount: processingOrder.totalAmount,
      providerId: gcashMethod?.providerId,
      paymentMethodId: gcashMethod?.id,
      status: PAYMENTSTATUS.COMPLETED,
      referenceNumber: `PAY-GCASH-${processingOrder.id.slice(-8).toUpperCase()}`,
      providerReference: `REF-GCASH-${Date.now()}`,
      paidAt: new Date(),
    },
  });

  // ── 8. Shipments & ReturnRequests ────────────────────────────────────────
  console.log('  → Seeding Shipments & ReturnRequests...');
  await prisma.shipments.create({
    data: {
      orderId: completedOrder.id,
      courier: 'LBC Express (Local Pickup)',
      trackingNumber: `LBC-${completedOrder.id.slice(-8).toUpperCase()}`,
      status: SHIPMENTSTATUS.DELIVERED,
      shippedAt: new Date(Date.now() - 18 * 60 * 60 * 1000),
      deliveredAt: completedOrder.completedAt,
    },
  });

  await prisma.returnRequests.create({
    data: {
      orderId: completedOrder.id,
      buyerId: buyer.id,
      sellerId: primaryStore.sellerId,
      reason: 'Package seal was slightly opened upon pickup inspection.',
      status: RETURNSTATUS.APPROVED,
      refundAmount: Number(completedOrder.totalAmount),
      approvedAt: new Date(),
    },
  });

  // ── 9. InventoryReservations & InventoryMovements ────────────────────────
  console.log('  → Seeding InventoryReservations & InventoryMovements...');
  const invRow = await prisma.inventory.findFirst({
    where: { productId: orderProduct1.id },
  });
  if (invRow) {
    await prisma.inventoryReservations.create({
      data: {
        inventoryId: invRow.id,
        buyerId: buyer.id,
        orderId: processingOrder.id,
        quantity: 1,
        status: RESERVATIONSTATUS.CONSUMED,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    await prisma.inventoryMovements.create({
      data: {
        inventoryId: invRow.id,
        productId: orderProduct1.id,
        storeId: primaryStore.id,
        movementType: INVENTORYMOVEMENTTYPE.SALE,
        quantityDelta: -2,
        previousOnHand: invRow.quantityOnHand + 2,
        newOnHand: invRow.quantityOnHand,
        referenceId: completedOrder.id,
        referenceType: INVENTORYREFERENCETYPE.ORDER,
        note: `Order checkout completed #${completedOrder.id.slice(-6)}`,
      },
    });
  }

  // ── 10. Settlements & SellerPayouts ──────────────────────────────────────
  console.log('  → Seeding Settlements & SellerPayouts...');
  const settlement = await prisma.settlements.create({
    data: {
      orderId: completedOrder.id,
      sellerId: primaryStore.sellerId,
      subtotalAmount: completedOrder.subtotalAmount,
      commissionAmount: completedOrder.marketplaceFeeAmount,
      paymentFeeAmount: 0,
      sellerNetAmount: completedOrder.sellerNetAmount,
      status: SETTLEMENTSTATUS.RELEASED,
      releaseEligibleAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      settledAt: new Date(),
    },
  });

  const payout = await prisma.sellerPayouts.create({
    data: {
      sellerId: primaryStore.sellerId,
      payoutNumber: `PO-BAGUIO-${Date.now().toString().slice(-6)}`,
      totalAmount: settlement.sellerNetAmount,
      status: PAYOUTSTATUS.COMPLETED,
      payoutMethod: 'BANK_TRANSFER',
      referenceNo: `TRF-BDO-${Math.floor(100000 + Math.random() * 900000)}`,
      processedAt: new Date(),
    },
  });

  await prisma.sellerPayoutItems.create({
    data: {
      payoutId: payout.id,
      settlementId: settlement.id,
      amount: settlement.sellerNetAmount,
    },
  });

  // ── 11. StoreReviews & ProductReviews ────────────────────────────────────
  console.log('  → Seeding Reviews...');
  await prisma.storeReviews.upsert({
    where: {
      storeId_buyerId: { storeId: primaryStore.id, buyerId: buyer.id },
    },
    update: {},
    create: {
      storeId: primaryStore.id,
      buyerId: buyer.id,
      rating: 5,
      comment: 'Fresh quality highland produce! Fast store pickup response.',
    },
  });

  await prisma.productReviews.upsert({
    where: {
      productId_buyerId_orderId: {
        productId: orderProduct1.id,
        buyerId: buyer.id,
        orderId: completedOrder.id,
      },
    },
    update: {},
    create: {
      productId: orderProduct1.id,
      buyerId: buyer.id,
      orderId: completedOrder.id,
      rating: 5,
      comment: 'Extremely fresh and well packaged.',
    },
  });

  // ── 12. Carts & Wishlists ────────────────────────────────────────────────
  console.log('  → Seeding Carts & Wishlists...');
  const cart = await prisma.carts.upsert({
    where: { buyerId: buyer.id },
    update: {},
    create: { buyerId: buyer.id },
  });

  await prisma.cartItems.deleteMany({ where: { cartId: cart.id } });
  await prisma.cartItems.create({
    data: {
      cartId: cart.id,
      productId: orderProduct2.id,
      quantity: 1,
      priceSnapshot: Number(orderProduct2.price),
    },
  });

  const wishlist = await prisma.wishlists.upsert({
    where: { buyerId: buyer.id },
    update: {},
    create: { buyerId: buyer.id },
  });

  await prisma.wishlistItems.deleteMany({ where: { wishlistId: wishlist.id } });
  await prisma.wishlistItems.create({
    data: {
      wishlistId: wishlist.id,
      productId: orderProduct1.id,
    },
  });

  // ── 13. AdminInvites, Notifications & AuditLogs ──────────────────────────
  console.log('  → Seeding AdminInvites, Notifications & AuditLogs...');
  if (adminUser) {
    await prisma.adminInvites.upsert({
      where: { email: 'invitee.admin@mapanytime.test' },
      update: {},
      create: {
        email: 'invitee.admin@mapanytime.test',
        token: `INV-TOKEN-${Date.now()}`,
        status: INVITESTATUS.PENDING,
        inviterId: adminUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.notifications.create({
      data: {
        userId: buyerUser!.id,
        title: 'Order Completed',
        body: `Your pickup order #${completedOrder.id.slice(-6)} has been marked completed. Thank you for shopping local!`,
      },
    });

    await prisma.auditLogs.create({
      data: {
        performedById: adminUser.id,
        action: 'MARKETPLACE_FULL_SEED_INITIALIZED',
        entityType: 'SYSTEM',
        entityId: 'GLOBAL',
        metadata: { seederVersion: '2.0.0', storesSeeded: stores.length },
      },
    });
  }

  console.log('✅ Extended marketplace data seeded for all Prisma models!');
}
