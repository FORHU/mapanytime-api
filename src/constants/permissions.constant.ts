import { SystemRole } from './roles.constant';

/**
 * Granular permission codes.
 *
 * These are the `Permissions.code` values seeded by
 * `prisma/seeders/roles.seeder.ts`, which imports SYSTEM_PERMISSIONS below so
 * the gate codes and the seeded rows cannot drift apart.
 *
 * ---
 *
 * **Before gating a route with one of these, check who already holds it.**
 *
 * `requirePermission` short-circuits on `isAdmin` (see
 * `middleware/permission.middleware.ts`), so swapping `requireAdmin` for
 * `requirePermission(code)` never locks an administrator out — but it *does*
 * open the route to every non-admin role holding that code. These codes are
 * granted to non-admin roles by the seeder:
 *
 * | code                | also held by                           |
 * | ------------------- | -------------------------------------- |
 * | `stores.manage`     | SELLER, SUPPORT_AGENT                  |
 * | `orders.view`       | SELLER, SUPPORT_AGENT                  |
 * | `analytics.view`    | SELLER                                 |
 * | `orders.process`    | SELLER_ADMIN, SELLER_MANAGER, SELLER_MEMBER |
 * | `products.view`     | SELLER_ADMIN, SELLER_MANAGER, SELLER_MEMBER |
 * | `products.edit`     | SELLER_ADMIN, SELLER_MANAGER           |
 * | `promotions.add`    | SELLER_ADMIN, SELLER_MANAGER           |
 *
 * Gating an administrator-only endpoint with one of those is a privilege
 * escalation, not a refactor. The remaining four are administrator-only today,
 * which is why they are the ones wired into admin routers.
 *
 * ---
 *
 * **The last four are seller-organization codes.** They gate seller-facing
 * routes through `requireSellerFeature` (see `middleware/sellerOrg.middleware.ts`),
 * which reads a member's `SellerOrganizationMembers.permissions` — never through
 * `requirePermission`, which answers the platform RBAC question instead. They
 * live in this same catalogue so there is one permission vocabulary rather than
 * two competing ones.
 *
 * Note that `roles.seeder.ts` grants every ADMIN_ROLES role *every* seeded
 * permission, so platform administrators now nominally hold the seller codes
 * too. That changes nothing in practice — they already bypass every seller gate
 * via `isAdmin` — but it is why these codes must not be used to gate an
 * admin-only surface.
 */
export const PERMISSIONS = {
  STORES_APPROVE: 'stores.approve',
  SELLERS_APPROVE: 'sellers.approve',
  STORES_MANAGE: 'stores.manage',
  CATEGORIES_MANAGE: 'categories.manage',
  USERS_MANAGE: 'users.manage',
  USERS_ROLES: 'users.roles',
  ORDERS_VIEW: 'orders.view',
  ANALYTICS_VIEW: 'analytics.view',

  // Seller-organization codes.
  ORDERS_PROCESS: 'orders.process',
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_EDIT: 'products.edit',
  PROMOTIONS_ADD: 'promotions.add',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface SystemPermission {
  code: PermissionCode;
  name: string;
  description: string;
}

/** The full catalogue, seeded verbatim into the `Permissions` table. */
export const SYSTEM_PERMISSIONS: SystemPermission[] = [
  {
    code: PERMISSIONS.STORES_APPROVE,
    name: 'Approve Merchant Stores',
    description: 'Can review and verify pending seller store requests',
  },
  {
    code: PERMISSIONS.SELLERS_APPROVE,
    name: 'Approve Sellers',
    description: 'Can review and approve pending seller profiles',
  },
  {
    code: PERMISSIONS.STORES_MANAGE,
    name: 'Manage Store Listings',
    description: 'Can create, edit, or suspend merchant stores',
  },
  {
    code: PERMISSIONS.CATEGORIES_MANAGE,
    name: 'Manage Categories',
    description: 'Can create, edit, and toggle marketplace categories',
  },
  {
    code: PERMISSIONS.USERS_MANAGE,
    name: 'Manage Users',
    description: 'Can view and modify user profiles and account statuses',
  },
  {
    code: PERMISSIONS.USERS_ROLES,
    name: 'Manage Roles & RBAC',
    description: 'Can assign roles and modify permission matrixes',
  },
  {
    code: PERMISSIONS.ORDERS_VIEW,
    name: 'View System Orders',
    description: 'Can monitor platform-wide buyer orders and pickup schedules',
  },
  {
    code: PERMISSIONS.ANALYTICS_VIEW,
    name: 'View Platform Analytics',
    description: 'Can access gross merchandise volume and revenue charts',
  },
  {
    code: PERMISSIONS.ORDERS_PROCESS,
    name: 'Process Orders',
    description: 'Can process the orders',
  },
  {
    code: PERMISSIONS.PRODUCTS_VIEW,
    name: 'View Products',
    description: 'Can view the products',
  },
  {
    code: PERMISSIONS.PRODUCTS_EDIT,
    name: 'Edit Products',
    description: 'Can edit the products',
  },
  {
    code: PERMISSIONS.PROMOTIONS_ADD,
    name: 'Add Promotions',
    description: 'Can add promotions and ads',
  },
];

export const SELLER_ORG_PERMISSIONS = [
  PERMISSIONS.ORDERS_PROCESS,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.PRODUCTS_EDIT,
  PERMISSIONS.PROMOTIONS_ADD,
] as const;

export type SellerOrgPermissionCode = (typeof SELLER_ORG_PERMISSIONS)[number];

/**
 * Codes granted to at least one non-administrator role by the seeder. Exported
 * so tests can assert no administrator-only router is gated with one of them.
 */
export const NON_ADMIN_HELD_PERMISSIONS: PermissionCode[] = [
  PERMISSIONS.STORES_MANAGE,
  PERMISSIONS.ORDERS_VIEW,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.ORDERS_PROCESS,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.PRODUCTS_EDIT,
  PERMISSIONS.PROMOTIONS_ADD,
];

export const NON_ADMIN_ROLE_PERMISSIONS: Partial<Record<SystemRole, PermissionCode[]>> = {
  SELLER: [PERMISSIONS.STORES_MANAGE, PERMISSIONS.ORDERS_VIEW, PERMISSIONS.ANALYTICS_VIEW],
  SUPPORT_AGENT: [PERMISSIONS.ORDERS_VIEW, PERMISSIONS.STORES_MANAGE],
  SELLER_ADMIN: [...SELLER_ORG_PERMISSIONS],
  SELLER_MANAGER: [...SELLER_ORG_PERMISSIONS],
  SELLER_MEMBER: [PERMISSIONS.ORDERS_PROCESS, PERMISSIONS.PRODUCTS_VIEW],
};
