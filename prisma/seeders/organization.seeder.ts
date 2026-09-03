import { PrismaClient, SellerOrgRole } from '@prisma/client';
import OrganizationRepository from '../../src/modules/organization/organization.repository';

const DEMO_ORGANIZATIONS = [
  {
    name: 'Piatos Family Trading',
    ownerEmail: 'seller@example.com',
    members: [
      {
        email: 'sellerManager@example.com',
        role: SellerOrgRole.SELLER_USER,
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

    await prisma.sellerOrganizations.updateMany({
      where: { id: orgId, name: { not: spec.name } },
      data: { name: spec.name },
    });

    const { count } = await prisma.stores.updateMany({
      where: { sellerId: seller.id, sellerOrganizationId: null },
      data: { sellerOrganizationId: orgId },
    });

    const bound = await prisma.stores.count({ where: { sellerOrganizationId: orgId } });

    console.log(`✅ Organization '${spec.name}' ready (${bound} store(s) bound, ${count} newly).`);
  }
}

async function seedDemoMembers(prisma: PrismaClient) {
  for (const spec of DEMO_ORGANIZATIONS) {
    if (spec.members.length === 0) continue;

    const org = await prisma.sellerOrganizations.findFirst({
      where: { owner: { email: { equals: spec.ownerEmail, mode: 'insensitive' } } },
      select: { id: true, name: true },
    });
    if (!org) {
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

      const member = await prisma.sellerOrganizationMembers.upsert({
        where: {
          sellerOrganizationId_userId: { sellerOrganizationId: org.id, userId: user.id },
        },
        update: { role: memberSpec.role },
        create: { sellerOrganizationId: org.id, userId: user.id, role: memberSpec.role },
        select: { id: true },
      });

      const stores = await prisma.stores.findMany({
        where: { slug: { in: memberSpec.storeSlugs }, sellerOrganizationId: org.id },
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

      // Reconcile rather than append: the spec is the source of truth, so a
      // store dropped from `storeSlugs` should lose its assignment on re-seed.
      await prisma.sellerOrganizationMemberStores.deleteMany({
        where: { memberId: member.id, storeId: { notIn: storeIds } },
      });
      await prisma.sellerOrganizationMemberStores.createMany({
        data: storeIds.map((storeId) => ({ memberId: member.id, storeId })),
        skipDuplicates: true,
      });

      console.log(
        `✅ ${memberSpec.email} → ${memberSpec.role} in '${spec.name}' ` +
          `(${storeIds.length} assigned store(s)).`,
      );
    }
  }
}
