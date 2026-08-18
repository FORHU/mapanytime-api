import { PrismaClient, PAYMENTMETHODTYPE } from '@prisma/client';

export async function seedPaymentProviders(prisma: PrismaClient) {
  console.log('Seeding Payment Providers and Methods...');

  // 1. PayMongo Provider
  const paymongo = await prisma.paymentProviders.upsert({
    where: { code: 'PAYMONGO' },
    update: { isActive: true, priority: 1 },
    create: {
      code: 'PAYMONGO',
      name: 'PayMongo',
      description: 'Philippines Leading Payment Gateway (GCash, Maya, Cards, QR Ph)',
      isActive: true,
      priority: 1,
    },
  });

  const paymongoMethods = [
    { code: 'GCASH', name: 'GCash', type: PAYMENTMETHODTYPE.E_WALLET, priority: 1 },
    { code: 'MAYA', name: 'Maya', type: PAYMENTMETHODTYPE.E_WALLET, priority: 2 },
    { code: 'QRPH', name: 'QR Ph', type: PAYMENTMETHODTYPE.QR, priority: 3 },
    { code: 'CARD', name: 'Credit / Debit Card', type: PAYMENTMETHODTYPE.CARD, priority: 4 },
    { code: 'GRAB_PAY', name: 'GrabPay', type: PAYMENTMETHODTYPE.E_WALLET, priority: 5 },
  ];

  for (const m of paymongoMethods) {
    await prisma.paymentMethods.upsert({
      where: {
        providerId_code: {
          providerId: paymongo.id,
          code: m.code,
        },
      },
      update: { name: m.name, type: m.type, isActive: true, priority: m.priority },
      create: {
        providerId: paymongo.id,
        code: m.code,
        name: m.name,
        type: m.type,
        isActive: true,
        priority: m.priority,
      },
    });
  }

  // 2. Mock Provider (for dev / test)
  const mockProvider = await prisma.paymentProviders.upsert({
    where: { code: 'MOCK' },
    update: { isActive: true, priority: 99 },
    create: {
      code: 'MOCK',
      name: 'Mock Payment Gateway',
      description: 'Simulated Sandbox Gateway for Development & Testing',
      isActive: true,
      priority: 99,
    },
  });

  await prisma.paymentMethods.upsert({
    where: {
      providerId_code: {
        providerId: mockProvider.id,
        code: 'MOCK_SANDBOX',
      },
    },
    update: { isActive: true },
    create: {
      providerId: mockProvider.id,
      code: 'MOCK_SANDBOX',
      name: 'Sandbox Simulator',
      type: PAYMENTMETHODTYPE.OTHER,
      isActive: true,
      priority: 1,
    },
  });

  // 3. Cash on Delivery Provider
  const cashProvider = await prisma.paymentProviders.upsert({
    where: { code: 'CASH' },
    update: { isActive: true, priority: 10 },
    create: {
      code: 'CASH',
      name: 'Cash',
      description: 'Physical cash on pickup/delivery',
      isActive: true,
      priority: 10,
    },
  });

  await prisma.paymentMethods.upsert({
    where: {
      providerId_code: {
        providerId: cashProvider.id,
        code: 'COD',
      },
    },
    update: { isActive: true },
    create: {
      providerId: cashProvider.id,
      code: 'COD',
      name: 'Cash on Delivery / Pickup',
      type: PAYMENTMETHODTYPE.CASH,
      isActive: true,
      priority: 1,
    },
  });

  console.log('Payment Providers and Methods seeded successfully.');
}
