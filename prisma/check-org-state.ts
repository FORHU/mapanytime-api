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
  const orgs = await prisma.sellerOrganizations.findMany({
    include: {
      owner: { select: { email: true } },
      stores: { select: { id: true, storeName: true, slug: true } },
      members: {
        include: {
          user: { select: { email: true } },
          assignedStores: { include: { store: { select: { slug: true } } } },
        },
      },
    },
  });

  if (orgs.length === 0) {
    console.log('❌ No SellerOrganizations rows at all.');
    return;
  }

  for (const org of orgs) {
    console.log(`\n━━ ORG: ${org.name}  (owner: ${org.owner.email})`);
    console.log(`   stores bound to org: ${org.stores.length}`);
    for (const s of org.stores) console.log(`     · ${s.slug ?? s.id} — ${s.storeName}`);

    console.log(`   members: ${org.members.length}`);
    for (const m of org.members) {
      const slugs = m.assignedStores.map((a) => a.store.slug ?? a.storeId);
      console.log(
        `     · ${m.user.email} → ${m.role} — ` +
          `${m.assignedStores.length} assigned store(s)` +
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
  for (const row of byRole) console.log(`   ${row.role}: ${row._count}`);

  // The two accounts the runbook depends on.
  for (const email of ['seller@example.com', 'sellerManager@example.com']) {
    const user = await prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        seller: {
          select: { id: true, sellerOrganizationId: true, stores: { select: { slug: true } } },
        },
        orgMemberships: {
          include: {
            assignedStores: { include: { store: { select: { slug: true } } } },
          },
        },
      },
    });

    console.log(`\n━━ USER: ${email}`);
    if (!user) {
      console.log('   ❌ user row does not exist');
      continue;
    }
    console.log(
      `   Sellers row: ${user.seller ? `yes (org: ${user.seller.sellerOrganizationId ?? 'UNBOUND'}, ${user.seller.stores.length} store(s))` : 'none'}`,
    );
    console.log(`   org memberships: ${user.orgMemberships.length}`);
    for (const m of user.orgMemberships) {
      console.log(
        `     · role=${m.role} ` +
          `assignedStores=[${m.assignedStores.map((a) => a.store.slug ?? a.storeId).join(', ')}]`,
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
