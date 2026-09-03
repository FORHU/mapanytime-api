import { prisma } from '../../utils/prisma';
import { resolveOrgContext, storeScopeWhere } from './orgContext';
import type { AuthUser } from '../auth/auth.repository';

/**
 * Which stores a user may operate on.
 *
 * Two ownership models coexist. Organization membership is the current one — a
 * `SELLER_ADMIN` reaches every store the org owns, a `SELLER_USER` only the
 * stores explicitly assigned to them. Direct ownership through the caller's own
 * `Sellers` row is the pre-organization one.
 *
 * The union of both is deliberate. Reading org membership alone would break any
 * seller whose organization backfill never ran; reading direct ownership alone
 * was the bug this module exists to fix — the owner checks compared the
 * caller's own `Sellers.id` against `store.sellerId`, which is an IDENTITY
 * test, so organization staff failed it for stores they had been explicitly
 * assigned. Having a `Sellers` row did not help them; only being the owner did.
 */
export async function resolveAccessibleStoreIds(user: AuthUser): Promise<{
  storeIds: string[];
  hasOrg: boolean;
  hasSellerRow: boolean;
}> {
  const context = resolveOrgContext(user);

  const orgStoreIds = context.organizationId
    ? (
        await prisma.stores.findMany({
          where: storeScopeWhere(context),
          select: { id: true },
        })
      ).map((s) => s.id)
    : [];

  const seller = await prisma.sellers.findUnique({
    where: { userId: user.id },
    include: { stores: { select: { id: true } } },
  });

  const storeIds = [...new Set([...orgStoreIds, ...(seller?.stores.map((s) => s.id) ?? [])])];

  return { storeIds, hasOrg: Boolean(context.organizationId), hasSellerRow: Boolean(seller) };
}

/**
 * Throw unless the caller may operate on `storeId`.
 *
 * 404 rather than 403 for an out-of-scope store, matching the convention used
 * throughout the seller-organization code: a store outside your scope is
 * indistinguishable from one that does not exist, so ids cannot be probed.
 *
 * The message deliberately avoids the word "unauthorized". The web fetcher used
 * to treat any response containing it as a dead session, refresh the token, and
 * retry — forever, since refreshing cannot fix an authorization failure.
 */
export async function assertStoreInScope(user: AuthUser, storeId: string): Promise<void> {
  const { storeIds, hasOrg, hasSellerRow } = await resolveAccessibleStoreIds(user);

  if (!hasOrg && !hasSellerRow) {
    throw { status: 403, message: 'Only registered sellers can manage a store.' };
  }

  if (!storeIds.includes(storeId)) {
    throw { status: 404, message: 'Store not found.' };
  }
}
