-- CreateEnum
CREATE TYPE "SellerOrgRole" AS ENUM ('SELLER_ADMIN', 'SELLER_USER');

-- AlterTable
ALTER TABLE "SellerOrganizationMembers" ADD COLUMN     "role" "SellerOrgRole";
ALTER TABLE "SellerOrganizationInvites" ADD COLUMN     "role" "SellerOrgRole";

-- Backfill by joining the role table before it is dropped. `seller_admin`
-- resolves to SELLER_ADMIN; anything else (including accident test roles)
-- maps to the least-privileged SELLER_USER so an unexpected row fails closed.
UPDATE "SellerOrganizationMembers" m SET "role" =
  CASE WHEN r."roleName" = 'seller_admin'
       THEN 'SELLER_ADMIN'::"SellerOrgRole" ELSE 'SELLER_USER'::"SellerOrgRole" END
FROM "SellerOrganizationRoles" r WHERE r."id" = m."roleId";

UPDATE "SellerOrganizationInvites" i SET "role" =
  CASE WHEN r."roleName" = 'seller_admin'
       THEN 'SELLER_ADMIN'::"SellerOrgRole" ELSE 'SELLER_USER'::"SellerOrgRole" END
FROM "SellerOrganizationRoles" r WHERE r."id" = i."roleId";

-- Safety net: anything the join missed becomes the least-privileged role.
UPDATE "SellerOrganizationMembers" SET "role" = 'SELLER_USER' WHERE "role" IS NULL;
UPDATE "SellerOrganizationInvites"  SET "role" = 'SELLER_USER' WHERE "role" IS NULL;

-- AlterTable
ALTER TABLE "SellerOrganizationMembers" ALTER COLUMN "role" SET NOT NULL;
ALTER TABLE "SellerOrganizationInvites"  ALTER COLUMN "role" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "SellerOrganizationMembers" DROP CONSTRAINT "SellerOrganizationMembers_roleId_fkey";
ALTER TABLE "SellerOrganizationInvites"  DROP CONSTRAINT "SellerOrganizationInvites_roleId_fkey";

-- DropForeignKey
ALTER TABLE "SellerOrganizationRolePermissions" DROP CONSTRAINT "SellerOrganizationRolePermissions_roleId_fkey";
ALTER TABLE "SellerOrganizationRolePermissions" DROP CONSTRAINT "SellerOrganizationRolePermissions_permissionId_fkey";

-- AlterTable
ALTER TABLE "SellerOrganizationMembers" DROP COLUMN "roleId";
ALTER TABLE "SellerOrganizationInvites"  DROP COLUMN "roleId";

-- DropTable
DROP TABLE "SellerOrganizationRolePermissions";
DROP TABLE "SellerOrganizationRoles";

-- The six org permission codes now have no reader.
DELETE FROM "RolePermissions" WHERE "permissionId" IN
  (SELECT "id" FROM "Permissions" WHERE "code" LIKE 'seller.org.%');
DELETE FROM "Permissions" WHERE "code" LIKE 'seller.org.%';
