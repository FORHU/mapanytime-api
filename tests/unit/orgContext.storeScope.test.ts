import { storeScopeWhere, type OrgContext } from '../../src/modules/organization/orgContext';
import { ALL_SELLER_FEATURES } from '../../src/modules/organization/sellerPermissions.constant';

/**
 * `storeScopeWhere` is the single filter behind both `getMyStores` and
 * `resolveAccessibleStoreIds` — and the latter is what `assertStoreInScope`
 * reads for products, inventory, orders and ads. So `deletedAt: null` belonging
 * to the scope rather than to each caller is what makes one soft delete take a
 * store out of every seller surface at once. These cases exist to keep it there.
 */
describe('storeScopeWhere', () => {
  const admin: OrgContext = {
    organizationId: 'org-1',
    role: 'SELLER_ADMIN',
    isAdmin: true,
    isOwner: true,
    assignedStoreIds: null,
    permissions: [...ALL_SELLER_FEATURES],
    sellerStatus: 'APPROVED',
  };

  it('excludes deleted stores for an organization admin', () => {
    expect(storeScopeWhere(admin)).toEqual({ sellerId: 'org-1', deletedAt: null });
  });

  it('excludes deleted stores for a member scoped to assigned stores', () => {
    const member: OrgContext = {
      ...admin,
      role: 'SELLER_MEMBER',
      isAdmin: false,
      isOwner: false,
      assignedStoreIds: ['store-1', 'store-2'],
    };

    expect(storeScopeWhere(member)).toEqual({
      sellerId: 'org-1',
      deletedAt: null,
      id: { in: ['store-1', 'store-2'] },
    });
  });

  it('still matches nothing without an organization', () => {
    expect(storeScopeWhere({ ...admin, organizationId: null })).toEqual({
      id: { equals: '__NO_SCOPE__' },
    });
  });
});
