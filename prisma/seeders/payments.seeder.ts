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

  // 2. Xendit Provider — coexists with PayMongo (not a replacement); both
  // active so GCash/Maya can be checked out via either gateway. Only the
  // two channels confirmed against Xendit's Payment Sessions docs are
  // seeded (Cards/QRPH/GrabPay channel codes weren't confirmed — see the
  // Xendit provider plan). Names are suffixed "(Xendit)" so the checkout
  // picker never shows two identically-named, unexplained "GCash" rows —
  // the web picker already shows provider name as a subtitle, but the
  // Flutter picker doesn't, so the name itself has to carry it.
  const xendit = await prisma.paymentProviders.upsert({
    where: { code: 'XENDIT' },
    update: { isActive: true, priority: 2 },
    create: {
      code: 'XENDIT',
      name: 'Xendit',
      description: 'Southeast Asia Payment Gateway (GCash, Maya, and more)',
      isActive: true,
      priority: 2,
    },
  });

  const xenditMethods = [
    { code: 'GCASH', name: 'GCash (Xendit)', type: PAYMENTMETHODTYPE.E_WALLET, priority: 1 },
    { code: 'MAYA', name: 'Maya (Xendit)', type: PAYMENTMETHODTYPE.E_WALLET, priority: 2 },
  ];

  for (const m of xenditMethods) {
    await prisma.paymentMethods.upsert({
      where: {
        providerId_code: {
          providerId: xendit.id,
          code: m.code,
        },
      },
      update: { name: m.name, type: m.type, isActive: true, priority: m.priority },
      create: {
        providerId: xendit.id,
        code: m.code,
        name: m.name,
        type: m.type,
        isActive: true,
        priority: m.priority,
      },
    });
  }

  // 3. Mock Provider (for dev / test)
  //
  // Seeded INACTIVE in production. The mock provider accepts any webhook
  // signature and marks any order paid; the webhook is gated at the processor,
  // but seeding the provider and its method ACTIVE unconditionally still put
  // "Sandbox Simulator" in the production checkout picker. Two layers now: this,
  // and the filter in PaymentService.getActivePaymentMethods. See FLAGS.md F33.
  const mockIsActive = process.env.NODE_ENV !== 'production';

  const mockProvider = await prisma.paymentProviders.upsert({
    where: { code: 'MOCK' },
    update: { isActive: mockIsActive, priority: 99 },
    create: {
      code: 'MOCK',
      name: 'Mock Payment Gateway',
      description: 'Simulated Sandbox Gateway for Development & Testing',
      isActive: mockIsActive,
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
    update: { isActive: mockIsActive },
    create: {
      providerId: mockProvider.id,
      code: 'MOCK_SANDBOX',
      name: 'Sandbox Simulator',
      type: PAYMENTMETHODTYPE.OTHER,
      isActive: mockIsActive,
      priority: 1,
    },
  });

  // 4. Cash on Pickup Provider — the platform is pickup-only, no delivery.
  const cashProvider = await prisma.paymentProviders.upsert({
    where: { code: 'CASH' },
    update: { isActive: true, priority: 10, description: 'Physical cash paid on pickup' },
    create: {
      code: 'CASH',
      name: 'Cash',
      description: 'Physical cash paid on pickup',
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
    update: { isActive: true, name: 'Pay on Pickup' },
    create: {
      providerId: cashProvider.id,
      code: 'COD',
      name: 'Pay on Pickup',
      type: PAYMENTMETHODTYPE.CASH,
      isActive: true,
      priority: 1,
    },
  });

  console.log('Payment Providers and Methods seeded successfully.');
}
