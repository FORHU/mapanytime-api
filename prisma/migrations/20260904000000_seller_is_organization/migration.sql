-- Collapses the seller organization onto the Sellers row.
--
-- "SellerOrganizations" was always 1:1 with "Sellers" (one org per seller
-- registration, created in the same transaction), so it is dropped and every
-- org reference now points at "Sellers"."id" instead. At the same time
-- "SellerOrganizationMemberStores" is folded into the member row as a scalar
-- array, and the "SellerOrgRole" enum is replaced by an FK into the existing
-- "Roles" table so there is one role vocabulary rather than two.
--
-- Order matters throughout: the seller Roles and Permissions rows must exist
-- before the member backfill can resolve "roleId", and the Stores consistency
-- check must run before its column is dropped.

-- ---------------------------------------------------------------------------
-- 1. Carry the organization name onto the seller.
-- ---------------------------------------------------------------------------

ALTER TABLE "Sellers" ADD COLUMN "organizationName" TEXT;

UPDATE "Sellers" s
   SET "organizationName" = o."name"
  FROM "SellerOrganizations" o
 WHERE s."sellerOrganizationId" = o."id";

-- ---------------------------------------------------------------------------
-- 2. Seed the seller roles and permissions the backfill needs as FK targets.
--    Mirrors src/constants/{roles,permissions}.constant.ts; the seeder upserts
--    the same rows, so re-running it after this migration is a no-op.
-- ---------------------------------------------------------------------------

INSERT INTO "Roles" ("id", "roleName", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'SELLER_ADMIN',   'Seller organization owner with full control over its stores, staff and settings', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'SELLER_MANAGER', 'Seller organization manager who can process orders and manage products and promotions', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'SELLER_MEMBER',  'Seller organization staff member with order processing and read-only catalog access', NOW(), NOW())
ON CONFLICT ("roleName") DO NOTHING;

INSERT INTO "Permissions" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'orders.process',  'Process Orders', 'Can process the orders',      NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'products.view',   'View Products',  'Can view the products',       NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'products.edit',   'Edit Products',  'Can edit the products',       NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'promotions.add',  'Add Promotions', 'Can add promotions and ads',  NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. SellerRolePermissions — the role-level grants.
-- ---------------------------------------------------------------------------

CREATE TABLE "SellerRolePermissions" (
  "roleId"       TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SellerRolePermissions_pkey" PRIMARY KEY ("roleId", "permissionId")
);

ALTER TABLE "SellerRolePermissions"
  ADD CONSTRAINT "SellerRolePermissions_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerRolePermissions"
  ADD CONSTRAINT "SellerRolePermissions_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "Permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SellerRolePermissions" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Roles" r
  JOIN "Permissions" p ON TRUE
 WHERE (r."roleName" IN ('SELLER_ADMIN', 'SELLER_MANAGER')
        AND p."code" IN ('orders.process', 'products.view', 'products.edit', 'promotions.add'))
    OR (r."roleName" = 'SELLER_MEMBER'
        AND p."code" IN ('orders.process', 'products.view'))
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Rebuild SellerOrganizationMembers against Sellers, with the store join
--    table and the role enum folded in.
--
--    Old permission slugs expand rather than map 1:1: 'products' granted both
--    reading and writing, so it becomes products.view AND products.edit. A
--    narrower mapping would silently revoke write access from existing staff.
--    'sales_review' and 'customer_review' are dropped — they gated no route and
--    have no counterpart in the platform catalogue.
-- ---------------------------------------------------------------------------

CREATE TABLE "SellerOrganizationMembers_new" (
  "id"               TEXT NOT NULL,
  "sellerId"         TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "roleId"           TEXT NOT NULL,
  "permissions"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "assignedStoreIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No DB default: Prisma's @updatedAt is applied client-side, and adding one
  -- here shows up as schema drift. Every row is inserted with an explicit value
  -- by the backfill below.
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SellerOrganizationMembers_new_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SellerOrganizationMembers_new"
  ("id", "sellerId", "userId", "roleId", "permissions", "assignedStoreIds", "createdAt", "updatedAt")
SELECT
  m."id",
  s."id",
  m."userId",
  r."id",
  COALESCE(
    (
      SELECT ARRAY_AGG(DISTINCT code)
        FROM UNNEST(m."permissions") AS slug
        CROSS JOIN LATERAL (
          SELECT UNNEST(
            CASE slug
              WHEN 'orders'     THEN ARRAY['orders.process']
              WHEN 'products'   THEN ARRAY['products.view', 'products.edit']
              WHEN 'promotions' THEN ARRAY['promotions.add']
              ELSE ARRAY[]::TEXT[]
            END
          ) AS code
        ) AS expanded
    ),
    ARRAY[]::TEXT[]
  ),
  COALESCE(
    (
      SELECT ARRAY_AGG(ms."storeId")
        FROM "SellerOrganizationMemberStores" ms
       WHERE ms."memberId" = m."id"
    ),
    ARRAY[]::TEXT[]
  ),
  m."createdAt",
  m."updatedAt"
FROM "SellerOrganizationMembers" m
-- An org with no Sellers row cannot exist (ensureSellerOrganization always
-- binds one), but INNER JOIN makes that an assertion rather than an assumption:
-- an orphaned membership is dropped instead of failing the NOT NULL later.
JOIN "Sellers" s ON s."sellerOrganizationId" = m."sellerOrganizationId"
JOIN "Roles" r ON r."roleName" = CASE m."role"::TEXT
                                   WHEN 'SELLER_ADMIN' THEN 'SELLER_ADMIN'
                                   WHEN 'MANAGER'      THEN 'SELLER_MANAGER'
                                   WHEN 'SELLER_USER'  THEN 'SELLER_MEMBER'
                                 END;

DROP TABLE "SellerOrganizationMemberStores";
DROP TABLE "SellerOrganizationMembers";

ALTER TABLE "SellerOrganizationMembers_new" RENAME TO "SellerOrganizationMembers";
ALTER TABLE "SellerOrganizationMembers"
  RENAME CONSTRAINT "SellerOrganizationMembers_new_pkey" TO "SellerOrganizationMembers_pkey";

CREATE UNIQUE INDEX "SellerOrganizationMembers_sellerId_userId_key"
  ON "SellerOrganizationMembers"("sellerId", "userId");
CREATE INDEX "SellerOrganizationMembers_userId_idx"
  ON "SellerOrganizationMembers"("userId");
CREATE INDEX "SellerOrganizationMembers_roleId_idx"
  ON "SellerOrganizationMembers"("roleId");

ALTER TABLE "SellerOrganizationMembers"
  ADD CONSTRAINT "SellerOrganizationMembers_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerOrganizationMembers"
  ADD CONSTRAINT "SellerOrganizationMembers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerOrganizationMembers"
  ADD CONSTRAINT "SellerOrganizationMembers_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Drop Stores."sellerOrganizationId" — but only after proving it agrees with
--    the store's seller. Store scoping moves to Stores."sellerId", so if the two
--    ever disagreed, dropping the column silently rescopes those stores.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  mismatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatched
    FROM "Stores" st
    JOIN "Sellers" se ON se."id" = st."sellerId"
   WHERE st."sellerOrganizationId" IS NOT NULL
     AND st."sellerOrganizationId" IS DISTINCT FROM se."sellerOrganizationId";

  IF mismatched > 0 THEN
    RAISE EXCEPTION
      'Cannot drop Stores.sellerOrganizationId: % store(s) belong to a different organization than their seller. Reconcile these rows before migrating.',
      mismatched;
  END IF;
END $$;

ALTER TABLE "Stores" DROP CONSTRAINT IF EXISTS "Stores_sellerOrganizationId_fkey";
ALTER TABLE "Stores" DROP COLUMN "sellerOrganizationId";

-- ---------------------------------------------------------------------------
-- 6. Retire the organization table and the role enum.
-- ---------------------------------------------------------------------------

ALTER TABLE "Sellers" DROP CONSTRAINT IF EXISTS "Sellers_sellerOrganizationId_fkey";
ALTER TABLE "Sellers" DROP COLUMN "sellerOrganizationId";

DROP TABLE "SellerOrganizations";

DROP TYPE "SellerOrgRole";
