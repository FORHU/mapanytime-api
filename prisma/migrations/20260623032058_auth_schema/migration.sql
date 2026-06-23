-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('NotRegistered', 'BUYER', 'SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentTypes" AS ENUM ('MAYORS_PERMIT', 'TIN_ID', 'DTI_CERTIFICATE');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Users" (
    "Id" TEXT NOT NULL,
    "Email" TEXT NOT NULL,
    "PasswordHash" TEXT NOT NULL,
    "FirstName" TEXT,
    "LastName" TEXT,
    "PhoneNumber" TEXT,
    "Role" "UserRole" NOT NULL DEFAULT 'NotRegistered',
    "AvatarId" TEXT,
    "AccountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "IsEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "LastLoginAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "SessionSocialAccount" (
    "Id" TEXT NOT NULL,
    "UserId" TEXT NOT NULL,
    "Provider" TEXT NOT NULL,
    "ProviderUserId" TEXT,
    "AccessToken" TEXT,
    "RefreshToken" TEXT,
    "ExpiresAt" TIMESTAMP(3),
    "Scopes" TEXT,
    "AvatarUrl" TEXT,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionSocialAccount_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "Files" (
    "Id" TEXT NOT NULL,
    "UserId" TEXT NOT NULL,
    "FileName" TEXT NOT NULL,
    "FileUrl" TEXT NOT NULL,
    "MetaData" JSONB,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Files_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "Sellers" (
    "Id" TEXT NOT NULL,
    "UserId" TEXT NOT NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sellers_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "Buyers" (
    "Id" TEXT NOT NULL,
    "UserId" TEXT NOT NULL,
    "DisplayName" TEXT NOT NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyers_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "DocumentVerifications" (
    "Id" TEXT NOT NULL,
    "SellerId" TEXT NOT NULL,
    "VerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "VerifiedById" TEXT,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentVerifications_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "Documents" (
    "Id" TEXT NOT NULL,
    "DocumentVerificationsId" TEXT NOT NULL,
    "FileId" TEXT NOT NULL,
    "DocumentType" "DocumentTypes" NOT NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Documents_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "AdminInvites" (
    "Id" TEXT NOT NULL,
    "Email" TEXT NOT NULL,
    "Token" TEXT NOT NULL,
    "Status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "InviterId" TEXT NOT NULL,
    "ExpiresAt" TIMESTAMP(3) NOT NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminInvites_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "Stores" (
    "Id" TEXT NOT NULL,
    "SellerId" TEXT NOT NULL,
    "StoreName" TEXT NOT NULL,
    "Description" TEXT,
    "IsActive" BOOLEAN NOT NULL DEFAULT false,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stores_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "StoreHours" (
    "Id" TEXT NOT NULL,
    "StoreId" TEXT NOT NULL,
    "DayOfWeek" INTEGER NOT NULL,
    "OpenTime" TEXT NOT NULL,
    "CloseTime" TEXT NOT NULL,
    "IsClosed" BOOLEAN NOT NULL DEFAULT false,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreHours_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "StoreLocations" (
    "Id" TEXT NOT NULL,
    "StoreId" TEXT NOT NULL,
    "CurrentAddress" TEXT NOT NULL,
    "HomeAddress" TEXT NOT NULL,
    "City" TEXT NOT NULL,
    "Province" TEXT NOT NULL,
    "ZipCode" TEXT NOT NULL,
    "Country" TEXT NOT NULL,
    "Latitude" DOUBLE PRECISION NOT NULL,
    "Longitude" DOUBLE PRECISION NOT NULL,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreLocations_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "StoreReviews" (
    "Id" TEXT NOT NULL,
    "StoreId" TEXT NOT NULL,
    "BuyerId" TEXT NOT NULL,
    "Rating" INTEGER NOT NULL,
    "Comment" TEXT,
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreReviews_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "Products" (
    "Id" TEXT NOT NULL,
    "StoreId" TEXT NOT NULL,
    "ProductFileId" TEXT,
    "Name" TEXT NOT NULL,
    "Brand" TEXT,
    "Description" TEXT,
    "Category" TEXT,
    "Price" DOUBLE PRECISION NOT NULL,
    "IsActive" BOOLEAN NOT NULL DEFAULT false,
    "ListedAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Products_pkey" PRIMARY KEY ("Id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_Email_key" ON "Users"("Email");

-- CreateIndex
CREATE UNIQUE INDEX "Users_AvatarId_key" ON "Users"("AvatarId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionSocialAccount_RefreshToken_key" ON "SessionSocialAccount"("RefreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "SessionSocialAccount_Provider_ProviderUserId_key" ON "SessionSocialAccount"("Provider", "ProviderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Sellers_UserId_key" ON "Sellers"("UserId");

-- CreateIndex
CREATE UNIQUE INDEX "Buyers_UserId_key" ON "Buyers"("UserId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvites_Email_key" ON "AdminInvites"("Email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvites_Token_key" ON "AdminInvites"("Token");

-- CreateIndex
CREATE UNIQUE INDEX "Stores_SellerId_key" ON "Stores"("SellerId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreLocations_StoreId_key" ON "StoreLocations"("StoreId");

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_AvatarId_fkey" FOREIGN KEY ("AvatarId") REFERENCES "Files"("Id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSocialAccount" ADD CONSTRAINT "SessionSocialAccount_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "Users"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sellers" ADD CONSTRAINT "Sellers_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "Users"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buyers" ADD CONSTRAINT "Buyers_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "Users"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerifications" ADD CONSTRAINT "DocumentVerifications_SellerId_fkey" FOREIGN KEY ("SellerId") REFERENCES "Sellers"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerifications" ADD CONSTRAINT "DocumentVerifications_VerifiedById_fkey" FOREIGN KEY ("VerifiedById") REFERENCES "Users"("Id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_DocumentVerificationsId_fkey" FOREIGN KEY ("DocumentVerificationsId") REFERENCES "DocumentVerifications"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_FileId_fkey" FOREIGN KEY ("FileId") REFERENCES "Files"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminInvites" ADD CONSTRAINT "AdminInvites_InviterId_fkey" FOREIGN KEY ("InviterId") REFERENCES "Users"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stores" ADD CONSTRAINT "Stores_SellerId_fkey" FOREIGN KEY ("SellerId") REFERENCES "Sellers"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreHours" ADD CONSTRAINT "StoreHours_StoreId_fkey" FOREIGN KEY ("StoreId") REFERENCES "Stores"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLocations" ADD CONSTRAINT "StoreLocations_StoreId_fkey" FOREIGN KEY ("StoreId") REFERENCES "Stores"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReviews" ADD CONSTRAINT "StoreReviews_StoreId_fkey" FOREIGN KEY ("StoreId") REFERENCES "Stores"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_StoreId_fkey" FOREIGN KEY ("StoreId") REFERENCES "Stores"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_ProductFileId_fkey" FOREIGN KEY ("ProductFileId") REFERENCES "Files"("Id") ON DELETE SET NULL ON UPDATE CASCADE;
