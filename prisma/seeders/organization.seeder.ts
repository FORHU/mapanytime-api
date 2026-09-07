import { PrismaClient } from '@prisma/client';
import OrganizationRepository from '../../src/modules/organization/organization.repository';
import { SYSTEM_ROLES, type SellerOrgRoleName } from '../../src/constants/roles.constant';
import { defaultPermissionsForRole } from '../../src/modules/organization/sellerPermissions.constant';

const DEMO_ORGANIZATIONS: {
  name: string;
  ownerEmail: string;
  members: { email: string; role: SellerOrgRoleName; storeSlugs: string[] }[];
}[] = [
  {
    name: 'Piatos Family Trading',
    ownerEmail: 'seller@example.com',
    members: [
      {
        email: 'sellerManager@example.com',
        role: SYSTEM_ROLES.SELLER_MANAGER,
        storeSlugs: ['baguio-fresh-harvest', 'pine-view-bakehouse'],
      },
    ],
  },
];

export async function seedSellerOrganizations(prisma: PrismaClient) {
  console.log('🌱 Seeding Seller Organizations...');

  await seedDemoOrganizations(prisma);
  await seedDemoMembers(prisma);
}

async function seedDemoOrganizations(prisma: PrismaClient) {
  for (const spec of DEMO_ORGANIZATIONS) {
    const owner = await prisma.users.findFirst({
      where: { email: { equals: spec.ownerEmail, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!owner) {
      console.warn(`⚠️  No user ${spec.ownerEmail}; skipping organization '${spec.name}'.`);
      continue;
    }

    const seller = await prisma.sellers.findUnique({
      where: { userId: owner.id },
      select: { id: true },
    });
    if (!seller) {
      console.warn(
        `⚠️  ${spec.ownerEmail} has no seller registration; skipping organization '${spec.name}'.`,
      );
      continue;
    }

    const orgId = await prisma.$transaction((tx) =>
      OrganizationRepository.ensureSellerOrganization(tx, {
        sellerId: seller.id,
        userId: owner.id,
        orgName: spec.name,
      }),
    );

    await prisma.sellers.updateMany({
      where: { id: orgId, organizationName: { not: spec.name } },
      data: { organizationName: spec.name },
    });

    const bound = await prisma.stores.count({ where: { sellerId: orgId } });

    console.log(`✅ Organization '${spec.name}' ready (${bound} store(s)).`);
  }
}

async function seedDemoMembers(prisma: PrismaClient) {
  for (const spec of DEMO_ORGANIZATIONS) {
    if (spec.members.length === 0) continue;

    const seller = await prisma.sellers.findFirst({
      where: { users: { email: { equals: spec.ownerEmail, mode: 'insensitive' } } },
      select: { id: true },
    });
    if (!seller) {
      console.warn(
        `⚠️  No organization owned by ${spec.ownerEmail}; skipping '${spec.name}' members.`,
      );
      continue;
    }

    for (const memberSpec of spec.members) {
      const user = await prisma.users.findFirst({
        where: { email: { equals: memberSpec.email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!user) {
        console.warn(`⚠️  No user ${memberSpec.email}; skipping '${spec.name}' membership.`);
        continue;
      }

      const stores = await prisma.stores.findMany({
        where: { slug: { in: memberSpec.storeSlugs }, sellerId: seller.id },
        select: { id: true },
      });

      if (stores.length !== memberSpec.storeSlugs.length) {
        console.warn(
          `⚠️  Only ${stores.length}/${memberSpec.storeSlugs.length} store(s) resolved for ` +
            `${memberSpec.email}; leaving their existing assignments alone.`,
        );
        continue;
      }

      const storeIds = stores.map((store) => store.id);
      const role = memberSpec.role;
      const permissions = defaultPermissionsForRole(role);

      await prisma.sellerOrganizationMembers.upsert({
        where: { sellerId_userId: { sellerId: seller.id, userId: user.id } },
        update: { role, permissions, assignedStoreIds: storeIds },
        create: {
          sellerId: seller.id,
          userId: user.id,
          role,
          permissions,
          assignedStoreIds: storeIds,
        },
      });

      console.log(
        `✅ ${memberSpec.email} → ${memberSpec.role} in '${spec.name}' ` +
          `(${storeIds.length} assigned store(s)).`,
      );
    }
  }
}
