import { resolveOrgContext } from '../../src/modules/organization/orgContext';
import type { AuthUser } from '../../src/modules/auth/auth.repository';
import { SYSTEM_ROLES } from '../../src/constants/roles.constant';
import { PERMISSIONS } from '../../src/constants/permissions.constant';

/**
 * Ownership of a seller organization, as distinct from admin rights in it.
 *
 * `Sellers.id` *is* the organization id, so the owner is whoever holds that row.
 * A `SELLER_ADMIN` the owner hired has every admin power and owns nothing —
 * conflating the two sent that account into merchant onboarding after password
 * setup, a flow it can never finish because `POST /stores` needs a `Sellers` row
 * it has no reason to have.
 */

function makeUser(input: {
  ownedSellerId?: string | null;
  memberships?: Array<{
    sellerId: string;
    role: string;
    assignedStoreIds?: string[];
    permissions?: string[];
  }>;
}): AuthUser {
  return {
    id: 'user-1',
    seller: input.ownedSellerId ? { id: input.ownedSellerId } : null,
    orgMemberships: (input.memberships ?? []).map((m) => ({
      sellerId: m.sellerId,
      role: m.role,
      assignedStoreIds: m.assignedStoreIds ?? [],
      permissions: m.permissions ?? [],
    })),
  } as unknown as AuthUser;
}

describe('resolveOrgContext ownership', () => {
  it('marks the owner as owner on their own membership row', () => {
    const ctx = resolveOrgContext(
      makeUser({
        ownedSellerId: 'org-1',
        memberships: [{ sellerId: 'org-1', role: SYSTEM_ROLES.SELLER_ADMIN }],
      }),
    );

    expect(ctx).toMatchObject({ organizationId: 'org-1', isAdmin: true, isOwner: true });
  });

  it('marks a hired SELLER_ADMIN as an admin who is not the owner', () => {
    // The account in the bug report: full admin rights, no Sellers row.
    const ctx = resolveOrgContext(
      makeUser({
        ownedSellerId: null,
        memberships: [{ sellerId: 'org-1', role: SYSTEM_ROLES.SELLER_ADMIN }],
      }),
    );

    expect(ctx).toMatchObject({ isAdmin: true, isOwner: false });
  });

  it('marks a scoped member as neither admin nor owner', () => {
    const ctx = resolveOrgContext(
      makeUser({
        ownedSellerId: null,
        memberships: [
          {
            sellerId: 'org-1',
            role: SYSTEM_ROLES.SELLER_MEMBER,
            assignedStoreIds: ['store-1'],
            permissions: [PERMISSIONS.ORDERS_PROCESS],
          },
        ],
      }),
    );

    expect(ctx).toMatchObject({ isAdmin: false, isOwner: false });
  });

  it('owns only the organization its own Sellers row is', () => {
    // A merchant who also works as staff elsewhere. Ownership is a comparison
    // against the resolved org, not "holds a Sellers row at all" — otherwise
    // this user would read as owner of someone else's organization.
    const ctx = resolveOrgContext(
      makeUser({
        ownedSellerId: 'org-mine',
        memberships: [
          {
            sellerId: 'org-theirs',
            role: SYSTEM_ROLES.SELLER_MEMBER,
            assignedStoreIds: ['store-9'],
          },
        ],
      }),
    );

    expect(ctx).toMatchObject({ organizationId: 'org-theirs', isOwner: false });
  });

  it('treats a seller with no membership row as the owner of their own org', () => {
    // The pre-organization fallback: owning a Sellers row is owning the org.
    const ctx = resolveOrgContext(makeUser({ ownedSellerId: 'org-1', memberships: [] }));

    expect(ctx).toMatchObject({ organizationId: 'org-1', isAdmin: true, isOwner: true });
  });

  it('reports no ownership for a user with neither a seller row nor a membership', () => {
    const ctx = resolveOrgContext(makeUser({ ownedSellerId: null, memberships: [] }));

    expect(ctx).toMatchObject({ organizationId: null, isAdmin: false, isOwner: false });
  });

  it('keeps ownership attached to the admin membership it prefers', () => {
    // An admin membership outranks a staff one; the owner flag must follow the
    // membership actually chosen, not the first in the array.
    const ctx = resolveOrgContext(
      makeUser({
        ownedSellerId: 'org-mine',
        memberships: [
          { sellerId: 'org-theirs', role: SYSTEM_ROLES.SELLER_MEMBER },
          { sellerId: 'org-mine', role: SYSTEM_ROLES.SELLER_ADMIN },
        ],
      }),
    );

    expect(ctx).toMatchObject({ organizationId: 'org-mine', isOwner: true });
  });
});
