/**
 * Runs only `seedSellerOrganizations`, for re-verifying demo org/member state
 * without a full re-seed. Idempotent, same as the seeder itself.
 *
 * Run: npx ts-node prisma/run-org-seeder.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedSellerOrganizations } from './seeders/organization.seeder';

const prisma = new PrismaClient();

seedSellerOrganizations(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
