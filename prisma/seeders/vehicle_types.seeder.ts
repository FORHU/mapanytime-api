import { PrismaClient } from '@prisma/client';

/**
 * Starter Philippine transport modes. More are added as VehicleTypes rows via
 * the admin API — the app renders whatever the API returns, so no release.
 */
export async function seedVehicleTypes(prisma: PrismaClient) {
  console.log('🌱 Seeding vehicle types...');

  const types = [
    { code: 'JEEPNEY', name: 'Jeepney' },
    { code: 'TRICYCLE', name: 'Tricycle' },
    { code: 'TAXI', name: 'Taxi' },
  ];

  for (const [sortOrder, type] of types.entries()) {
    await prisma.vehicleTypes.upsert({
      where: { code: type.code },
      update: {},
      create: { ...type, sortOrder },
    });
  }

  console.log(`✅ Seeded ${types.length} vehicle types`);
}
