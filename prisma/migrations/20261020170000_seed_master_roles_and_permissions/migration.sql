-- ---------------------------------------------------------------------------
-- Seed Master Roles, System Permissions, and Baseline Test Accounts
--
-- Remote environments (staging, production) run `prisma migrate deploy`, which
-- only applies migrations and never runs `prisma/seed.ts`. This migration
-- guarantees that all master system roles, permissions, and test accounts exist
-- in every deployed database.
-- ---------------------------------------------------------------------------

-- 1. Insert Master Roles
INSERT INTO "Roles" ("id", "roleName", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'SUPER_ADMIN',   'Platform super administrator with unrestricted system control and invite privileges', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'DEVELOPER',     'Platform software engineer with access to system API logs, webhooks, and developer tools', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'ADMIN',         'Platform administrator with system management permissions', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'SUPPORT_AGENT', 'Customer support agent for reviewing orders and store inquiries', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'SELLER',        'Merchant seller account for managing storefronts and catalog', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'BUYER',         'Buyer account for map discovery and local checkout', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'SELLER_ADMIN',   'Seller organization owner with full control over its stores, staff and settings', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'SELLER_MANAGER', 'Seller organization manager who can process orders and manage products and promotions', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'SELLER_MEMBER',  'Seller organization staff member with order processing and read-only catalog access', NOW(), NOW())
ON CONFLICT ("roleName") DO UPDATE SET
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();

-- 2. Insert Permissions
INSERT INTO "Permissions" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'stores.approve',     'Approve Merchant Stores', 'Can review and verify pending seller store requests', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'sellers.approve',    'Approve Sellers',         'Can review and approve pending seller profiles', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'stores.manage',     'Manage Store Listings',   'Can create, edit, or suspend merchant stores', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'categories.manage', 'Manage Categories',       'Can create, edit, and toggle marketplace categories', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'users.manage',      'Manage Users',            'Can view and modify user profiles and account statuses', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'users.roles',       'Manage Roles & RBAC',     'Can assign roles and modify permission matrixes', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'orders.view',       'View System Orders',      'Can monitor platform-wide buyer orders and pickup schedules', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'analytics.view',    'View Platform Analytics', 'Can access gross merchandise volume and revenue charts', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'orders.process',    'Process Orders',          'Can process the orders', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'products.view',     'View Products',           'Can view the products', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'products.edit',     'Edit Products',           'Can edit the products', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'promotions.add',    'Add Promotions',          'Can add promotions and ads', NOW(), NOW())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();

-- 3. Link Role Permissions
-- Administrators get all permissions
INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "Roles" r
CROSS JOIN "Permissions" p
WHERE r."roleName" IN ('SUPER_ADMIN', 'DEVELOPER', 'ADMIN')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- SELLER gets stores.manage, orders.view, analytics.view
INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "Roles" r
JOIN "Permissions" p ON p."code" IN ('stores.manage', 'orders.view', 'analytics.view')
WHERE r."roleName" = 'SELLER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- SUPPORT_AGENT gets orders.view, stores.manage
INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "Roles" r
JOIN "Permissions" p ON p."code" IN ('orders.view', 'stores.manage')
WHERE r."roleName" = 'SUPPORT_AGENT'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 4. Seed default buyer account (buyer@example.com / Buyer123)
INSERT INTO "Users" ("id", "email", "name", "firstName", "lastName", "countryCode", "isEmailVerified", "accountStatus", "updatedAt")
VALUES ('user_seed_buyer', 'buyer@example.com', 'Sara Smith', 'Sara', 'Smith', 'PH', true, 'ACTIVE', NOW())
ON CONFLICT ("email") DO NOTHING;

-- Connect BUYER role to buyer@example.com
INSERT INTO "_UserRoles" ("A", "B")
SELECT r."id", u."id"
FROM "Roles" r, "Users" u
WHERE r."roleName" = 'BUYER' AND u."email" = 'buyer@example.com'
ON CONFLICT ("A", "B") DO NOTHING;

-- Ensure Buyers record exists
INSERT INTO "Buyers" ("id", "userId", "displayName", "updatedAt")
SELECT 'buyer_seed_record', u."id", 'Sara Smith', NOW()
FROM "Users" u
WHERE u."email" = 'buyer@example.com'
ON CONFLICT ("userId") DO NOTHING;

-- AuthAccount for credential login (Buyer123)
INSERT INTO "AuthAccount" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT gen_random_uuid()::TEXT, u."id", 'credential', u."id", '$scrypt$f394ff5340e46ac5898926f5d596b688:d3d34062d39e7f824b5a8e1396d23c07289d7daa50041dafc6f719dcfda61dd0e2c4f0fc992b8a060106cfc1d1024baa7d310845be9ebe672114f9df1e7e4580', NOW(), NOW()
FROM "Users" u
WHERE u."email" = 'buyer@example.com'
ON CONFLICT ("providerId", "accountId") DO NOTHING;

-- 5. Seed default seller account (seller@example.com / Seller123)
INSERT INTO "Users" ("id", "email", "name", "firstName", "lastName", "countryCode", "isEmailVerified", "accountStatus", "updatedAt")
VALUES ('user_seed_seller', 'seller@example.com', 'Grace Piatos', 'Grace', 'Piatos', 'PH', true, 'ACTIVE', NOW())
ON CONFLICT ("email") DO NOTHING;

-- Connect SELLER and BUYER roles to seller@example.com
INSERT INTO "_UserRoles" ("A", "B")
SELECT r."id", u."id"
FROM "Roles" r, "Users" u
WHERE r."roleName" IN ('SELLER', 'BUYER') AND u."email" = 'seller@example.com'
ON CONFLICT ("A", "B") DO NOTHING;

-- Ensure Buyers and Sellers record exists for seller
INSERT INTO "Buyers" ("id", "userId", "displayName", "updatedAt")
SELECT 'buyer_seed_seller', u."id", 'Grace Piatos', NOW()
FROM "Users" u
WHERE u."email" = 'seller@example.com'
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "Sellers" ("id", "userId", "applicationStatus", "onboardingStep", "sellerPlan", "updatedAt")
SELECT 'seller_seed_record', u."id", 'APPROVED'::"ApplicationStatus", 4, 'PRO', NOW()
FROM "Users" u
WHERE u."email" = 'seller@example.com'
ON CONFLICT ("userId") DO NOTHING;

-- AuthAccount for credential login (Seller123)
INSERT INTO "AuthAccount" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT gen_random_uuid()::TEXT, u."id", 'credential', u."id", '$scrypt$53570c831cda19ecb26a6db1d86e95bb:49c55cfdcde7527f5ad5b33ce21d8a5ddea082d6e65c7b3a7315097c1b8a2aac1cea18b720d96772890ad44d490f21236bfb1108c1dc56a3862e5491e0241ff1', NOW(), NOW()
FROM "Users" u
WHERE u."email" = 'seller@example.com'
ON CONFLICT ("providerId", "accountId") DO NOTHING;
