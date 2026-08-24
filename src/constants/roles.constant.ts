export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DEVELOPER: 'DEVELOPER',
  ADMIN: 'ADMIN',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  SELLER: 'SELLER',
  BUYER: 'BUYER',
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
};
