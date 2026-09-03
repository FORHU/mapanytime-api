import { Prisma, SellerOrgRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.repository';
import { ALL_SELLER_FEATURES, type SellerFeature } from './sellerPermissions.constant';

/**
 * The resolved seller-organization context for an authenticated request.
 *
 * - `organizationId` â€” the org the request is scoped to.
 * - `role` â€” the org-scoped role the user holds (`SELLER_ADMIN` or
 *   `SELLER_USER`), or `null` when they have no membership.
 * - `isAdmin` â€” true for `SELLER_ADMIN` (implicit full access to all org
 *   stores and org-management actions).
 * - `assignedStoreIds` â€” the stores a non-admin member can access; `null` when
 *   the user is an admin (sees all stores) or has no per-store restriction.
 * - `permissions` - the feature codes the member holds. Admins hold every code
 *   implicitly; for everyone else this is the membership row's stored list
 *   verbatim, because role defaults are resolved at write time (see
 *   `normalizePermissions`). An empty list therefore means "no features", not
 *   "fall back to the role default".
 */
export interface OrgContext {
  organizationId: string | null;
  role: SellerOrgRole | null;
  isAdmin: boolean;
  assignedStoreIds: string[] | null;
  permissions: SellerFeature[];
}

const EMPTY_CONTEXT: OrgContext = {
  organizationId: null,
  role: null,
  isAdmin: false,
  assignedStoreIds: null,
  permissions: [],
};

/**
 * Return the primary organization context for a user.
 *
 * Priority:
 *   1. An explicit membership record: the highest of the user's org memberships
 *      (admins take precedence over regular members).
 *   2. A bound `Sellers` registration: if the user owns a seller registration
 *      that is bound to an organization but has no membership row (legacy data
 *      before an admin group existed), fall back to it as soon as it resolves.
 *
 * `isAdmin` means "sees every store in the organization" and carries the
 * org-management permissions implicitly.
 */
export function resolveOrgContext(user: AuthUser | undefined): OrgContext {
  if (!user) return EMPTY_CONTEXT;

  const memberships = user.orgMemberships ?? [];

  // An admin membership outranks staff memberships so an accountant turned
  // manager is not accidentally demoted.
  const sorted = [...memberships].sort((a, b) => {
    const aAdmin = a.role === SellerOrgRole.SELLER_ADMIN;
    const bAdmin = b.role === SellerOrgRole.SELLER_ADMIN;
    return Number(bAdmin) - Number(aAdmin);
  });

  const membership = sorted[0];
  if (membership) {
    return buildContext(membership);
  }

  // Fall back to the seller-bound organization (no explicit membership row).
  const sellerOrgId = user.seller?.sellerOrganizationId ?? null;
  if (sellerOrgId) {
    return {
      organizationId: sellerOrgId,
      role: SellerOrgRole.SELLER_ADMIN,
      isAdmin: true,
      assignedStoreIds: null,
      permissions: [...ALL_SELLER_FEATURES],
    };
  }

  return EMPTY_CONTEXT;
}

function buildContext(membership: {
  sellerOrganizationId: string;
  role?: SellerOrgRole | null;
  assignedStores?: { storeId: string }[];
  permissions?: string[];
}): OrgContext {
  const role = membership.role ?? null;
  const isAdmin = role === SellerOrgRole.SELLER_ADMIN;
  const assignedStoreIds = isAdmin ? null : (membership.assignedStores ?? []).map((m) => m.storeId);

  // The stored list is taken as-is for members: normalizePermissions already
  // applied the role default when the row was written, so re-applying it here
  // would make a deliberately emptied list un-revokable.
  const permissions = isAdmin
    ? [...ALL_SELLER_FEATURES]
    : ((membership.permissions ?? []) as SellerFeature[]);

  return {
    organizationId: membership.sellerOrganizationId,
    role,
    isAdmin,
    assignedStoreIds,
    permissions,
  };
}

/**
 * Build the Prisma `StoreWhereInput` that scopes a query to exactly the stores
 * the requesting user may see:
 *   - admin  â†’ every store in the organization
 *   - member â†’ only the explicitly assigned stores
 *
 * A context with no usable organization yields a tautology-free filter that
 * matches nothing, so a caller can never leak rows across organizations.
 */
export function storeScopeWhere(context: OrgContext): Prisma.StoresWhereInput {
  if (!context.organizationId) {
    // Impossible match â€” "no two ids equal" is only true when the two ids
    // differ, and they never do, so nothing matches.
    return { id: { equals: '__NO_SCOPE__' } };
  }
  if (context.isAdmin || context.assignedStoreIds === null) {
    return { sellerOrganizationId: context.organizationId };
  }
  return {
    sellerOrganizationId: context.organizationId,
    id: { in: context.assignedStoreIds.length > 0 ? context.assignedStoreIds : ['__NONE__'] },
  };
}
