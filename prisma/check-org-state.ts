/**
 * Read-only diagnostic: prints the seller-organization state for the demo
 * accounts so membership/role/store assignment can be confirmed from the
 * database rather than inferred from seed log output.
 *
 * Run: npx ts-node prisma/check-org-state.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Organizations *are* sellers, so this is a Sellers query now.
  const orgs = await prisma.sellers.findMany({
    include: {
      users: { select: { email: true } },
      stores: { select: { id: true, storeName: true, slug: true } },
      organizationMembers: {
        include: {
          user: { select: { email: true } },
        },
      },
    },
  });

  if (orgs.length === 0) {
    console.log('❌ No Sellers rows at all.');
    return;
  }

  // Store slugs resolved once, so a member's assignedStoreIds can be printed as
  // slugs without a query per member.
  const slugById = new Map(
    (await prisma.stores.findMany({ select: { id: true, slug: true } })).map((s) => [
      s.id,
      s.slug ?? s.id,
    ]),
  );

  for (const org of orgs) {
    console.log(`\n━━ ORG: ${org.organizationName ?? '(unnamed)'}  (owner: ${org.users.email})`);
    console.log(`   stores: ${org.stores.length}`);
    for (const s of org.stores) console.log(`     · ${s.slug ?? s.id} — ${s.storeName}`);

    console.log(`   members: ${org.organizationMembers.length}`);
    for (const m of org.organizationMembers) {
      const slugs = m.assignedStoreIds.map((id) => slugById.get(id) ?? id);
      console.log(
        `     · ${m.user.email} → ${m.role} — ` +
          `${m.assignedStoreIds.length} assigned store(s)` +
          (slugs.length ? `: ${slugs.join(', ')}` : ''),
      );
    }
  }

  // Totals the runbook verifies.
  const byRole = await prisma.sellerOrganizationMembers.groupBy({
    by: ['role'],
    _count: true,
  });
  console.log('\n━━ MEMBER ROLE TOTALS');
  for (const row of byRole) {
    console.log(`   ${row.role}: ${row._count}`);
  }

  // The two accounts the runbook depends on.
  for (const email of ['seller@example.com', 'sellerManager@example.com']) {
    const user = await prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        seller: {
          select: { id: true, organizationName: true, stores: { select: { slug: true } } },
        },
        orgMemberships: true,
      },
    });

    console.log(`\n━━ USER: ${email}`);
    if (!user) {
      console.log('   ❌ user row does not exist');
      continue;
    }
    console.log(
      `   Sellers row: ${
        user.seller
          ? `yes (org: ${user.seller.organizationName ?? 'UNNAMED'}, id ${user.seller.id}, ` +
            `${user.seller.stores.length} store(s))`
          : 'none'
      }`,
    );
    console.log(`   org memberships: ${user.orgMemberships.length}`);
    for (const m of user.orgMemberships) {
      console.log(
        `     · role=${m.role} ` +
          `assignedStores=[${m.assignedStoreIds.map((id) => slugById.get(id) ?? id).join(', ')}]`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
