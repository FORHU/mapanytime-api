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
 * open the route to every non-admin role holding that code. Three codes are
 * granted to non-admin roles by the seeder:
 *
 * | code             | also held by             |
 * | ---------------- | ------------------------ |
 * | `stores.manage`  | SELLER, SUPPORT_AGENT    |
 * | `orders.view`    | SELLER, SUPPORT_AGENT    |
 * | `analytics.view` | SELLER                   |
 *
 * Gating an administrator-only endpoint with one of those three is a privilege
 * escalation, not a refactor. The remaining four are administrator-only today,
 * which is why they are the ones wired into admin routers.
 */
export const PERMISSIONS = {
  STORES_APPROVE: 'stores.approve',
  STORES_MANAGE: 'stores.manage',
  CATEGORIES_MANAGE: 'categories.manage',
  USERS_MANAGE: 'users.manage',
  USERS_ROLES: 'users.roles',
  ORDERS_VIEW: 'orders.view',
  ANALYTICS_VIEW: 'analytics.view',
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
];

/**
 * Codes granted to at least one non-administrator role by the seeder. Exported
 * so tests can assert no administrator-only router is gated with one of them.
 */
export const NON_ADMIN_HELD_PERMISSIONS: PermissionCode[] = [
  PERMISSIONS.STORES_MANAGE,
  PERMISSIONS.ORDERS_VIEW,
  PERMISSIONS.ANALYTICS_VIEW,
];
