-- ---------------------------------------------------------------------------
-- Fold the seller-organization role indirection onto the member row.
--
-- Two things go away here:
--
--   1. `SellerOrganizationMembers."roleId"` — an FK into `Roles`. Every write
--      already validated the role name against the SELLER_ORG_ROLES constant
--      before resolving it to an id, and every read joined it straight back to
--      a bare `roleName`, so the FK bought a lookup per write and an include on
--      every authenticated request in exchange for no guarantee the request
--      validation did not already provide. It becomes a `role TEXT` column.
--
--   2. `SellerRolePermissions` — the role->permission grant table. Nothing read
--      it: not a service, repository, middleware, controller or test. The
--      defaults that actually run come from NON_ADMIN_ROLE_PERMISSIONS in
--      src/constants/permissions.constant.ts, which `normalizePermissions`
--      materialises onto `SellerOrganizationMembers."permissions"` at write
--      time. Keeping the table meant keeping a second source of truth that
--      could only ever drift from the enforced one.
--
-- The SELLER_ADMIN / SELLER_MANAGER / SELLER_MEMBER rows in `Roles` are left
-- alone. They stay part of the platform role catalogue the seeder maintains;
-- they simply stop being pointed at from here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Backfill the role name onto the member row.
--
--    A straight copy: `Roles."roleName"` already holds exactly the three
--    SELLER_* names the application compares against, so there is no mapping
--    table and no chance of a rename slipping through.
-- ---------------------------------------------------------------------------

ALTER TABLE "SellerOrganizationMembers" ADD COLUMN "role" TEXT;

UPDATE "SellerOrganizationMembers" m
   SET "role" = r."roleName"
  FROM "Roles" r
 WHERE r."id" = m."roleId";

-- A membership whose roleId pointed at a row that is not there would silently
-- become a NULL role, and a NULL role fails every gate open-endedly:
-- `resolveOrgContext` would read it as "not an admin, no features". That is a
-- data fault worth failing the deploy over, not one to discover in production.
DO $$
DECLARE
  orphaned INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned
    FROM "SellerOrganizationMembers"
   WHERE "role" IS NULL;

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'Cannot merge seller roles: % membership row(s) have a roleId with no matching Roles row. Run the roles seeder and re-check before migrating.',
      orphaned;
  END IF;
END $$;

ALTER TABLE "SellerOrganizationMembers" ALTER COLUMN "role" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Drop the FK, its index, and the column.
--
--    No index replaces `SellerOrganizationMembers_roleId_idx`: `role` has three
--    distinct values across the table and nothing filters or orders by it — the
--    only reader is a groupBy in the check-org-state script.
-- ---------------------------------------------------------------------------

ALTER TABLE "SellerOrganizationMembers"
  DROP CONSTRAINT "SellerOrganizationMembers_roleId_fkey";

DROP INDEX "SellerOrganizationMembers_roleId_idx";

ALTER TABLE "SellerOrganizationMembers" DROP COLUMN "roleId";

-- ---------------------------------------------------------------------------
-- 3. Drop the grant table.
--
--    Nothing is preserved from it. Every grant it recorded is already present
--    on the member rows that were seeded from it, and the constant remains the
--    source those defaults are read from.
-- ---------------------------------------------------------------------------

DROP TABLE "SellerRolePermissions";
