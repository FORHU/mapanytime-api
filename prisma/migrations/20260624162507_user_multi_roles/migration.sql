/*
  Warnings:

  - You are about to drop the column `CreatedAt` on the `Buyers` table. All the data in the column will be lost.
  - You are about to drop the column `DisplayName` on the `Buyers` table. All the data in the column will be lost.
  - You are about to drop the column `UpdatedAt` on the `Buyers` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `Users` table. All the data in the column will be lost.
  - Added the required column `displayName` to the `Buyers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Buyers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Buyers" DROP COLUMN "CreatedAt",
DROP COLUMN "DisplayName",
DROP COLUMN "UpdatedAt",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Users" DROP COLUMN "role";

-- DropEnum
DROP TYPE "UserRole";

-- CreateTable
CREATE TABLE "Roles" (
    "id" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserRoles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Roles_roleName_key" ON "Roles"("roleName");

-- CreateIndex
CREATE INDEX "_UserRoles_B_index" ON "_UserRoles"("B");

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_A_fkey" FOREIGN KEY ("A") REFERENCES "Roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_B_fkey" FOREIGN KEY ("B") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
