import {
  SELLER_ORG_PERMISSIONS,
  NON_ADMIN_ROLE_PERMISSIONS,
  type SellerOrgPermissionCode,
} from '../../constants/permissions.constant';
import { type SellerOrgRoleName } from '../../constants/roles.constant';

/**
 * Seller-organization member feature codes, sourced from the global platform
 * catalogue and stored as a `String[]` on members for query-free permission checks.
 * Defaults are seeded from `NON_ADMIN_ROLE_PERMISSIONS` to prevent drift.
 */
export const SELLER_FEATURES = SELLER_ORG_PERMISSIONS;

export type SellerFeature = SellerOrgPermissionCode;

export const ALL_SELLER_FEATURES: readonly SellerFeature[] = SELLER_FEATURES;

/**
 * What each role starts with when an admin has not chosen explicitly.
 *
 * `SELLER_ADMIN` maps to an empty list because an admin's stored permissions are
 * never read — `resolveOrgContext` gives them every feature implicitly, so
 * persisting a list for them would go stale the moment a new code is added.
 */
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<SellerOrgRoleName, readonly SellerFeature[]> = {
  SELLER_ADMIN: [],
  SELLER_MANAGER: (NON_ADMIN_ROLE_PERMISSIONS.SELLER_MANAGER ?? []) as SellerFeature[],
  SELLER_MEMBER: (NON_ADMIN_ROLE_PERMISSIONS.SELLER_MEMBER ?? []) as SellerFeature[],
};

export function isSellerFeature(code: string): code is SellerFeature {
  return (SELLER_FEATURES as readonly string[]).includes(code);
}

export function defaultPermissionsForRole(role: SellerOrgRoleName): SellerFeature[] {
  return [...(DEFAULT_PERMISSIONS_BY_ROLE[role] ?? [])];
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
export function normalizePermissions(
  role: SellerOrgRoleName,
  requested?: string[],
): SellerFeature[] {
  // Admins hold everything implicitly; storing a list for them would be a lie
  // that goes stale as soon as a feature is added.
  if (role === 'SELLER_ADMIN') return [];

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
