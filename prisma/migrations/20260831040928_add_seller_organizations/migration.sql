-- AlterTable
ALTER TABLE "Sellers" ADD COLUMN     "sellerOrganizationId" TEXT;

-- AlterTable
ALTER TABLE "Stores" ADD COLUMN     "sellerOrganizationId" TEXT;

-- CreateTable
CREATE TABLE "SellerOrganizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOrganizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOrganizationMembers" (
    "id" TEXT NOT NULL,
    "sellerOrganizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOrganizationMembers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOrganizationRoles" (
    "id" TEXT NOT NULL,
    "sellerOrganizationId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOrganizationRoles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOrganizationRolePermissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerOrganizationRolePermissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "SellerOrganizationMemberStores" (
    "memberId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerOrganizationMemberStores_pkey" PRIMARY KEY ("memberId","storeId")
);

-- CreateIndex
CREATE INDEX "SellerOrganizations_ownerId_idx" ON "SellerOrganizations"("ownerId");

-- CreateIndex
CREATE INDEX "SellerOrganizationMembers_userId_idx" ON "SellerOrganizationMembers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOrganizationMembers_sellerOrganizationId_userId_key" ON "SellerOrganizationMembers"("sellerOrganizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOrganizationRoles_sellerOrganizationId_roleName_key" ON "SellerOrganizationRoles"("sellerOrganizationId", "roleName");

-- AddForeignKey
ALTER TABLE "SellerOrganizations" ADD CONSTRAINT "SellerOrganizations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationMembers" ADD CONSTRAINT "SellerOrganizationMembers_sellerOrganizationId_fkey" FOREIGN KEY ("sellerOrganizationId") REFERENCES "SellerOrganizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationMembers" ADD CONSTRAINT "SellerOrganizationMembers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationMembers" ADD CONSTRAINT "SellerOrganizationMembers_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SellerOrganizationRoles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationRoles" ADD CONSTRAINT "SellerOrganizationRoles_sellerOrganizationId_fkey" FOREIGN KEY ("sellerOrganizationId") REFERENCES "SellerOrganizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationRolePermissions" ADD CONSTRAINT "SellerOrganizationRolePermissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SellerOrganizationRoles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationRolePermissions" ADD CONSTRAINT "SellerOrganizationRolePermissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationMemberStores" ADD CONSTRAINT "SellerOrganizationMemberStores_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "SellerOrganizationMembers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationMemberStores" ADD CONSTRAINT "SellerOrganizationMemberStores_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sellers" ADD CONSTRAINT "Sellers_sellerOrganizationId_fkey" FOREIGN KEY ("sellerOrganizationId") REFERENCES "SellerOrganizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stores" ADD CONSTRAINT "Stores_sellerOrganizationId_fkey" FOREIGN KEY ("sellerOrganizationId") REFERENCES "SellerOrganizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- DATA BACKFILL: create one organization per existing seller registration,
-- bind its stores + seller record, create the system org roles, and assign the
-- owner user as seller_admin.
-- =============================================================================

DO $$
DECLARE
    rec RECORD;
    sider_id TEXT;
    owner_id TEXT;
    owner_name TEXT;
    org_id TEXT;
    admin_role_id TEXT;
    user_role_id TEXT;
    cur CURSOR FOR
        SELECT s.id AS seller_id, s."userId"
        FROM "Sellers" s
        WHERE s."sellerOrganizationId" IS NULL
          AND s."deletedAt" IS NULL;
BEGIN
    -- Loop over every seller that is not yet bound to an organization.
    FOR rec IN cur LOOP
        sider_id := rec.seller_id;
        owner_id := rec."userId";

        org_id := gen_random_uuid()::TEXT;

        -- Resolve the owner display name first (into a local variable, not a
        -- record field) so the plain-SQL INSERT below has no PL/pgSQL-record
        -- references that the executor cannot substitute.
        SELECT coalesce(u."firstName" || ' ' || u."lastName", u.email)
        INTO owner_name
        FROM "Users" u WHERE u.id = owner_id;

        IF owner_name IS NULL THEN
            CONTINUE;
        END IF;

        -- 1. Create the organization.
        INSERT INTO "SellerOrganizations" ("id", "name", "ownerId", "createdAt", "updatedAt")
        VALUES (org_id, owner_name, owner_id, now(), now());

        -- 2. System roles for this organization.
        INSERT INTO "SellerOrganizationRoles" ("id", "sellerOrganizationId", "roleName", "description", "isSystem", "createdAt", "updatedAt")
        VALUES
            (gen_random_uuid()::TEXT, org_id, 'seller_admin', 'Manages all stores, members, roles, and permissions for the organization', true, now(), now()),
            (gen_random_uuid()::TEXT, org_id, 'seller_user', 'Can view, select, and manage products within their assigned stores', true, now(), now());

        SELECT "id" INTO admin_role_id FROM "SellerOrganizationRoles" WHERE "sellerOrganizationId" = org_id AND "roleName" = 'seller_admin';
        SELECT "id" INTO user_role_id  FROM "SellerOrganizationRoles" WHERE "sellerOrganizationId" = org_id AND "roleName" = 'seller_user';

        -- 3. Owner membership (seller_admin).
        INSERT INTO "SellerOrganizationMembers" ("id", "sellerOrganizationId", "userId", "roleId", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::TEXT, org_id, owner_id, admin_role_id, now(), now());

        -- 4. Bind the seller registration and all its stores to the org.
        UPDATE "Sellers" SET "sellerOrganizationId" = org_id WHERE "id" = sider_id;
        UPDATE "Stores" SET "sellerOrganizationId" = org_id WHERE "sellerId" = sider_id;
    END LOOP;
END $$;
