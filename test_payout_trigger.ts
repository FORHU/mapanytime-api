import { PrismaClient } from '@prisma/client';
import SettlementService from './src/modules/settlements/settlement.service';
import PayoutService from './src/modules/payouts/payout.service';

const prisma = new PrismaClient();

async function main() {
  console.log('--- P0-5: Payout Trigger Workflow Test ---');

  // 1. Find or create a COMPLETED order
  let order = await prisma.orders.findFirst({
    where: { status: 'COMPLETED' },
    include: { store: true },
  });

  if (!order) {
    console.log('No COMPLETED order found. Finding a PENDING order to complete...');
    order = await prisma.orders.findFirst({
      where: { status: 'PENDING' },
      include: { store: true },
    });

    if (!order) {
      console.error('No orders found at all! Please run seeders first.');
      return;
    }
  }

  console.log(`Using Order: ${order.id} (Seller: ${order.store.sellerId})`);

  // Ensure it's COMPLETED and has no returns
  await prisma.orders.update({
    where: { id: order.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  await prisma.returnRequests.deleteMany({
    where: { orderId: order.id },
  });

  console.log(`Clearing existing payouts for seller to ensure clean test...`);
  await prisma.sellerPayoutItems.deleteMany({
    where: { settlement: { sellerId: order.store.sellerId } },
  });
  await prisma.sellerPayouts.deleteMany({
    where: { sellerId: order.store.sellerId },
  });

  // 2. Book the Settlement
  console.log('1. Booking initial PENDING settlement...');
  let settlement;
  try {
    settlement = await SettlementService.createForCompletedOrder(prisma, order.id);
    console.log(`   Settlement ${settlement.id} booked successfully.`);
  } catch (err: any) {
    console.log('   Settlement already exists or error:', err.message);
    settlement = await prisma.settlements.findUnique({ where: { orderId: order.id } });
  }

  // 3. Backdate the releaseEligibleAt so it matures immediately
  console.log('2. Artificially backdating releaseEligibleAt by 8 days to simulate hold expiry...');
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 8);

  await prisma.settlements.update({
    where: { id: settlement!.id },
    data: {
      releaseEligibleAt: pastDate,
      status: 'PENDING', // Reset to PENDING just in case it was released before
    },
  });

  // 4. Run the release cron function
  console.log('3. Manually triggering releaseMaturedSettlements()...');
  const releasedCount = await SettlementService.releaseMaturedSettlements();
  console.log(`   Cron released ${releasedCount} matured settlement(s).`);

  console.log(`   Verifying settlement directly before payout...`);
  const s = await prisma.settlements.findUnique({
    where: { id: settlement!.id },
    include: { payoutItem: true },
  });
  console.log(`   - Status: ${s?.status}`);
  console.log(`   - SellerId: ${s?.sellerId} (Passed to Payout: ${order.store.sellerId})`);
  console.log(`   - PayoutItem:`, s?.payoutItem);

  console.log('4. Triggering PayoutService to sweep the released funds...');
  try {
    const payout = await PayoutService.createPayout({
      sellerId: order.store.sellerId,
      payoutMethod: 'BANK_TRANSFER', // Assuming a generic mock method
      referenceNo: 'TEST-SWEEP-123',
    });

    console.log(`   SUCCESS: Created Payout ${payout.payoutNumber}`);
    console.log(`   Total Amount Sent: ₱${payout.totalAmount}`);
    console.log(`   Number of settlements swept: ${payout.items.length}`);
  } catch (err: any) {
    console.error('   FAILED to create payout:', err.message);
  }

  console.log('--- Test Complete ---');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
