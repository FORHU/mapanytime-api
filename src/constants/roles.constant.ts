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
