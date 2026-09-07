/**
 * Every role the platform knows about, seeded as rows in the `Roles` table.
 *
 * The last three are seller-organization roles. They live here rather than in a
 * Prisma enum of their own so there is exactly one role vocabulary:
 * `SellerOrganizationMembers.role` stores one of these names verbatim, and the
 * features each grants are `NON_ADMIN_ROLE_PERMISSIONS` entries drawn from the
 * same `Permissions` catalogue admin RBAC uses.
 */
export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DEVELOPER: 'DEVELOPER',
  ADMIN: 'ADMIN',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  SELLER: 'SELLER',
  BUYER: 'BUYER',
  SELLER_ADMIN: 'SELLER_ADMIN',
  SELLER_MANAGER: 'SELLER_MANAGER',
  SELLER_MEMBER: 'SELLER_MEMBER',
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/**
 * Roles that possess administrative privileges across system management endpoints
 */
export const ADMIN_ROLES: SystemRole[] = [
  SYSTEM_ROLES.SUPER_ADMIN,
  SYSTEM_ROLES.DEVELOPER,
  SYSTEM_ROLES.ADMIN,
];

/**
 * The roles a seller-organization member may hold.
 *
 * Deliberately not part of ADMIN_ROLES: `SELLER_ADMIN` is an admin *of one
 * seller organization*, which is a different thing from a platform
 * administrator. Granting it platform reach would let any seller who invites
 * themselves as an org admin bypass `requireAdmin`.
 */
export const SELLER_ORG_ROLES = [
  SYSTEM_ROLES.SELLER_ADMIN,
  SYSTEM_ROLES.SELLER_MANAGER,
  SYSTEM_ROLES.SELLER_MEMBER,
] as const;

/**
 * Narrower than `SystemRole`: only these three may appear on a
 * `SellerOrganizationMembers` row, so `as const` above is load-bearing — a plain
 * `SystemRole[]` annotation would widen this back to every platform role and let
 * a member be created as `SUPER_ADMIN`.
 */
export type SellerOrgRoleName = (typeof SELLER_ORG_ROLES)[number];

export function isSellerOrgRole(role: string): role is SellerOrgRoleName {
  return (SELLER_ORG_ROLES as readonly string[]).includes(role);
}

/**
 * What `roles.seeder.ts` writes to `Roles.description` for each role. Typed as
 * `Record<SystemRole, string>` so adding a role to SYSTEM_ROLES without adding
 * its description here is a compile error, not a role that silently never gets
 * created (the seeder used to hold its own separate hardcoded role list that
 * could drift from this one).
 */
export const ROLE_DESCRIPTIONS: Record<SystemRole, string> = {
  SUPER_ADMIN:
    'Platform super administrator with unrestricted system control and invite privileges',
  DEVELOPER:
    'Platform software engineer with access to system API logs, webhooks, and developer tools',
  ADMIN: 'Platform administrator with system management permissions',
  SUPPORT_AGENT: 'Customer support agent for reviewing orders and store inquiries',
  SELLER: 'Merchant seller account for managing storefronts and catalog',
  BUYER: 'Buyer account for map discovery and local checkout',
  SELLER_ADMIN: 'Seller organization owner with full control over its stores, staff and settings',
  SELLER_MANAGER:
    'Seller organization manager who can process orders and manage products and promotions',
  SELLER_MEMBER:
    'Seller organization staff member with order processing and read-only catalog access',
};
