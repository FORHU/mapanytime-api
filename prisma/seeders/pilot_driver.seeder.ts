import { PrismaClient } from '@prisma/client';

/**
 * Pilot fleet for God's Eye: buyer@example.com drives jeepney PILOT-001, so the
 * app's driver chip has someone to show for. Mirrors migration
 * 20260929000000_seed_pilot_driver (same fixed ids), which is what puts it on
 * deployed databases — the seed never runs there.
 */
export async function seedPilotDriver(prisma: PrismaClient) {
  console.log('🌱 Seeding pilot driver...');

  const driver = await prisma.users.findUnique({ where: { email: 'buyer@example.com' } });
  if (!driver) {
    console.log('⚠️ buyer@example.com not found — skipping pilot driver');
    return;
  }

  const jeepney = await prisma.vehicleTypes.findUniqueOrThrow({ where: { code: 'JEEPNEY' } });

  const operator = await prisma.transportOperators.upsert({
    where: { id: 'op_mapanytime_pilot' },
    update: {},
    create: { id: 'op_mapanytime_pilot', name: 'MapAnytime Pilot' },
  });

  await prisma.transportOperatorMembers.upsert({
    where: { operatorId_userId: { operatorId: operator.id, userId: driver.id } },
    update: { role: 'DRIVER' },
    create: {
      id: 'opm_pilot_buyer',
      operatorId: operator.id,
      userId: driver.id,
      role: 'DRIVER',
    },
  });

  await prisma.vehicles.upsert({
    where: { plateNumber: 'PILOT-001' },
    update: {},
    create: {
      id: 'veh_pilot_001',
      operatorId: operator.id,
      vehicleTypeId: jeepney.id,
      driverUserId: driver.id,
      plateNumber: 'PILOT-001',
    },
  });

  console.log('✅ Seeded pilot driver (buyer@example.com → PILOT-001)');
}
