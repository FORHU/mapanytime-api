import { SellerOrgRole } from '@prisma/client';

/**
 * Feature codes a seller-organization member can be granted.
 *
 * Deliberately separate from the platform `Permissions` table, which is rows in
 * the database and belongs to admin RBAC (`middleware/permission.middleware.ts`).
 * These are an application constant stored as a scalar `String[]` on
 * `SellerOrganizationMembers` — the granular seller-org permission *tables* were
 * dropped in `20260901000000_simplify_seller_org_roles`, and reintroducing them
 * would rebuild exactly what that migration removed.
 *
 * `returns` and `payouts` are absent on purpose. `/v1/returns/seller/*` and
 * `/v1/settlements/me` both resolve the caller's own `Sellers` row, which
 * organization staff never have, so those endpoints 403 for every member
 * regardless of role. Offering a checkbox for them would promise access the API
 * refuses — they belong here only once those two modules are org-scoped.
 */
export const SELLER_FEATURES = [
  'orders',
  'products',
  'promotions',
  'sales_review',
  'customer_review',
] as const;

export type SellerFeature = (typeof SELLER_FEATURES)[number];

export const ALL_SELLER_FEATURES: readonly SellerFeature[] = SELLER_FEATURES;

/**
 * What each role starts with when an admin has not chosen explicitly.
 *
 * `SELLER_ADMIN` maps to an empty list because an admin's stored permissions are
 * never read — `resolveOrgContext` gives them every feature implicitly, so
 * persisting a list for them would go stale the moment a new code is added.
 */
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<SellerOrgRole, readonly SellerFeature[]> = {
  [SellerOrgRole.SELLER_ADMIN]: [],
  [SellerOrgRole.MANAGER]: SELLER_FEATURES,
  [SellerOrgRole.SELLER_USER]: ['orders', 'products'],
};

export function isSellerFeature(code: string): code is SellerFeature {
  return (SELLER_FEATURES as readonly string[]).includes(code);
}

export function defaultPermissionsForRole(role: SellerOrgRole): SellerFeature[] {
  return [...DEFAULT_PERMISSIONS_BY_ROLE[role]];
}

/**
 * Decide the list to persist for a member.
 *
 * Defaults are resolved here, at write time, rather than when the context is
 * read. Falling back to the role default whenever the stored list is empty would
 * make "no features at all" impossible to express: an admin who unticks every
 * box writes `[]`, and the read path would silently hand the permissions back.
 *
 * `requested` being undefined means the caller did not express an opinion, so
 * the role default applies. An explicit empty array is honoured as empty.
 */
export function normalizePermissions(role: SellerOrgRole, requested?: string[]): SellerFeature[] {
  // Admins hold everything implicitly; storing a list for them would be a lie
  // that goes stale as soon as a feature is added.
  if (role === SellerOrgRole.SELLER_ADMIN) return [];

  if (requested === undefined) return defaultPermissionsForRole(role);

  const unknown = requested.filter((code) => !isSellerFeature(code));
  if (unknown.length > 0) {
    throw {
      status: 400,
      message: `Unknown permission code(s): ${unknown.join(', ')}`,
    };
  }

  return [...new Set(requested)] as SellerFeature[];
}
