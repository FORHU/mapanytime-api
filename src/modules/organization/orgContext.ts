import { Prisma, ApplicationStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.repository';
import { SYSTEM_ROLES, type SellerOrgRoleName } from '../../constants/roles.constant';
import { ALL_SELLER_FEATURES, type SellerFeature } from './sellerPermissions.constant';

/**
 * The resolved seller-organization context for an authenticated request.
 *
 * - `organizationId` â€” the org the request is scoped to. This is a `Sellers.id`:
 *   the seller registration *is* the organization.
 * - `role` â€” the org-scoped role name the user holds (`SELLER_ADMIN`,
 *   `SELLER_MANAGER` or `SELLER_MEMBER`), or `null` when they have no
 *   membership. A role name rather than an enum member: the membership row
 *   stores the name as a plain string column.
 * - `isAdmin` â€” true for `SELLER_ADMIN` (implicit full access to all org
 *   stores and org-management actions).
 * - `isOwner` â€” true when the caller registered this organization, i.e. their
 *   own `Sellers` row *is* it. Not the same as `isAdmin`: a `SELLER_ADMIN` the
 *   owner hired holds every admin power but owns nothing, and the difference is
 *   what separates "finish setting up your store" from "you are staff here".
 *   Testing `isAdmin` for this sent admin staff into merchant onboarding, which
 *   they can never complete â€” `POST /stores` needs a `Sellers` row they have
 *   no reason to have.
 * - `assignedStoreIds` â€” the stores a non-admin member can access; `null` when
 *   the user is an admin (sees all stores) or has no per-store restriction.
 * - `permissions` - the feature codes the member holds. Admins hold every code
 *   implicitly; for everyone else this is the membership row's stored list
 *   verbatim, because role defaults are resolved at write time (see
 *   `normalizePermissions`). An empty list therefore means "no features", not
 *   "fall back to the role default".
 * - `sellerStatus` — the caller's own seller application status, or `null` when
 *   they hold no `Sellers` row. `null` is not a failure state: org staff never
 *   apply to be sellers, and their authority comes from the store assignment.
 *   Anything reading this must distinguish the two, or every hired member of an
 *   approved organization gets treated as unverified. See
 *   `requireApprovedSeller`.
 */
export interface OrgContext {
  organizationId: string | null;
  role: SellerOrgRoleName | null;
  isAdmin: boolean;
  isOwner: boolean;
  assignedStoreIds: string[] | null;
  permissions: SellerFeature[];
  sellerStatus: ApplicationStatus | null;
}

const EMPTY_CONTEXT: OrgContext = {
  organizationId: null,
  role: null,
  isAdmin: false,
  isOwner: false,
  assignedStoreIds: null,
  permissions: [],
  sellerStatus: null,
};

/**
 * Return the primary organization context for a user.
 *
 * Priority:
 *   1. An explicit membership record: the highest of the user's org memberships
 *      (admins take precedence over regular members).
 *   2. Their own `Sellers` registration: a seller who never provisioned staff
 *      has no membership row, and owns their organization outright.
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
    const aAdmin = a.role === SYSTEM_ROLES.SELLER_ADMIN;
    const bAdmin = b.role === SYSTEM_ROLES.SELLER_ADMIN;
    return Number(bAdmin) - Number(aAdmin);
  });

  // Reported alongside the context rather than folded into `permissions`:
  // withholding features here would silently change every `requireSellerFeature`
  // check in the codebase. Approval is enforced in one explicit middleware
  // instead, so this stays a fact about the caller, not a decision about them.
  const sellerStatus = user.seller?.applicationStatus ?? null;

  const membership = sorted[0];
  if (membership) {
    // Ownership is per-organization, not "has a Sellers row": a merchant who
    // also works as staff somewhere else owns the org their own row *is*, and
    // is plain staff in the other one.
    return buildContext(membership, user.seller?.id ?? null, sellerStatus);
  }

  // Fall back to the user's own seller registration. Since `Sellers` *is* the
  // organization, owning a seller row is owning an org — there is no longer a
  // separate "bound to an organization" state to check for.
  const sellerId = user.seller?.id ?? null;
  if (sellerId) {
    return {
      organizationId: sellerId,
      role: SYSTEM_ROLES.SELLER_ADMIN,
      isAdmin: true,
      isOwner: true,
      assignedStoreIds: null,
      permissions: [...ALL_SELLER_FEATURES],
      sellerStatus,
    };
  }

  return EMPTY_CONTEXT;
}

function buildContext(
  membership: {
    sellerId: string;
    role?: string | null;
    assignedStoreIds?: string[];
    permissions?: string[];
  },
  ownedSellerId: string | null,
  sellerStatus: ApplicationStatus | null,
): OrgContext {
  const roleName = membership.role ?? null;
  const role = roleName ? (roleName as SellerOrgRoleName) : null;
  const isAdmin = roleName === SYSTEM_ROLES.SELLER_ADMIN;
  // The org id *is* a Sellers.id, so owning this organization is exactly having
  // that row. Compared rather than merely checked for existence, so a merchant
  // who is also staff elsewhere is not read as owner of the other org.
  const isOwner = ownedSellerId !== null && ownedSellerId === membership.sellerId;
  const assignedStoreIds = isAdmin ? null : (membership.assignedStoreIds ?? []);

  // The stored list is taken as-is for members: normalizePermissions already
  // applied the role default when the row was written, so re-applying it here
  // would make a deliberately emptied list un-revokable.
  const permissions = isAdmin
    ? [...ALL_SELLER_FEATURES]
    : ((membership.permissions ?? []) as SellerFeature[]);

  return {
    organizationId: membership.sellerId,
    role,
    isAdmin,
    isOwner,
    assignedStoreIds,
    permissions,
    sellerStatus,
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
    return { sellerId: context.organizationId };
  }
  return {
    sellerId: context.organizationId,
    id: { in: context.assignedStoreIds.length > 0 ? context.assignedStoreIds : ['__NONE__'] },
  };
}
