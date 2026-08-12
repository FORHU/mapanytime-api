-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "USERACCOUNTSTATUS" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'BANNED', 'NEED_REVISSION');

-- CreateEnum
CREATE TYPE "DOCUMENTTYPES" AS ENUM ('TIN_ID', 'GOV_ID', 'DTI_CERTIFICATE', 'MAYORS_PERMIT', 'BIR_CERTIFICATE', 'SEC_CERTIFICATE');

-- CreateEnum
CREATE TYPE "INVITESTATUS" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MERCHANTADKIND" AS ENUM ('PROMO', 'JOB', 'EVENT');

-- CreateEnum
CREATE TYPE "PRODUCTSTATUS" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FULLFILLMENTTYPE" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "ORDERSTATUS" AS ENUM ('PENDING', 'PROCESSING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RESERVATIONSTATUS" AS ENUM ('RESERVED', 'CONSUMED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PAYMENTMETHOD" AS ENUM ('BANK', 'E_WALLET', 'CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "PAYMENTSTATUS" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'VOIDED', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING');

-- CreateEnum
CREATE TYPE "SETTLEMENTSTATUS" AS ENUM ('PENDING', 'HELD', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PAYOUTSTATUS" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ADDRESSTYPE" AS ENUM ('SHIPPING', 'BILLING', 'HOME', 'OFFICE');

-- CreateEnum
CREATE TYPE "INVENTORYMOVEMENTTYPE" AS ENUM ('RESTOCK', 'SALE', 'RETURN', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "INVENTORYREFERENCETYPE" AS ENUM ('ORDER', 'RETURN', 'TRANSFER', 'RESTOCK', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SHIPMENTSTATUS" AS ENUM ('PENDING', 'LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "RETURNSTATUS" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ITEM_RECEIVED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RELEASESTATUS" AS ENUM ('ACTIVE', 'DEPRECATED', 'FAILED');

-- CreateTable
CREATE TABLE "Users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "activeSessionId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phoneNumber" TEXT,
    "avatarFileId" TEXT,
    "userReferralId" TEXT,
    "accountStatus" "USERACCOUNTSTATUS" NOT NULL DEFAULT 'ACTIVE',
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isOnBoarding" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "Permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "refreshToken" TEXT,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT,
    "avatarUrl" TEXT,
    "providerUserId" TEXT,
    "scopes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Files" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'S3',
    "bucket" TEXT,
    "path" TEXT NOT NULL,
    "checksum" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sellers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "applicationStatus" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "sellerPlan" TEXT,
    "agentNotes" TEXT,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
    "onboardedAt" TIMESTAMP(3),

    CONSTRAINT "Sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "displayName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVerifications" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "storeId" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentVerifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documents" (
    "id" TEXT NOT NULL,
    "documentVerificationsId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "documentType" "DOCUMENTTYPES" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminInvites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "INVITESTATUS" NOT NULL DEFAULT 'PENDING',
    "inviterId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminInvites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stores" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "description" TEXT,
    "logoId" TEXT,
    "bannerId" TEXT,
    "slug" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "returnPolicy" TEXT,
    "shippingPolicy" TEXT,
    "socialLinks" JSONB,
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "vacationMode" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "primaryCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreHours" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openMinutes" INTEGER NOT NULL,
    "closeMinutes" INTEGER NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreLocations" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "currentAddress" TEXT NOT NULL,
    "homeAddress" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreLocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreReviews" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreReviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAds" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "MERCHANTADKIND" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "badgeLabel" TEXT,
    "ctaLabel" TEXT,
    "salaryLabel" TEXT,
    "buyQuantity" INTEGER,
    "freeQuantity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantAds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAdProducts" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,

    CONSTRAINT "MerchantAdProducts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Products" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "status" "PRODUCTSTATUS" NOT NULL DEFAULT 'APPROVED',
    "totalSold" INTEGER NOT NULL DEFAULT 0,
    "listedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "variantName" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductVariants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptionValues" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOptionValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantToOptionValue" (
    "variantId" TEXT NOT NULL,
    "optionValueId" TEXT NOT NULL,

    CONSTRAINT "ProductVariantToOptionValue_pkey" PRIMARY KEY ("variantId","optionValueId")
);

-- CreateTable
CREATE TABLE "SupplierProducts" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierSku" TEXT,
    "costPrice" DECIMAL(12,2),
    "minimumOrderQty" INTEGER NOT NULL DEFAULT 1,
    "supplyLeadDays" INTEGER NOT NULL DEFAULT 1,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProducts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categories" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CategoryStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTags" (
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ProductTags_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateTable
CREATE TABLE "Orders" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT,
    "sellerName" TEXT,
    "storeAddressSnapshot" TEXT,
    "sellerPhoneSnapshot" TEXT,
    "storeEmailSnapshot" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "subtotalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "marketplaceFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellerNetAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "version" INTEGER NOT NULL DEFAULT 0,
    "type" "FULLFILLMENTTYPE" NOT NULL DEFAULT 'PICKUP',
    "status" "ORDERSTATUS" NOT NULL DEFAULT 'PENDING',
    "pickupAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItems" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT,
    "variantName" TEXT,
    "productSku" TEXT,
    "productBrand" TEXT,
    "productImage" TEXT,
    "categoryName" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "appliedAdId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImages" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "fileId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "storeId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservations" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "cartId" TEXT,
    "orderId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "RESERVATIONSTATUS" NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "PAYMENTMETHOD" NOT NULL,
    "status" "PAYMENTSTATUS" NOT NULL DEFAULT 'PENDING',
    "referenceNumber" TEXT,
    "gateway" TEXT,
    "gatewayReference" TEXT,
    "gatewayFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "rawResponse" JSONB,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRules" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "fixedFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlements" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "subtotalAmount" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "paymentFeeAmount" DECIMAL(12,2) NOT NULL,
    "sellerNetAmount" DECIMAL(12,2) NOT NULL,
    "status" "SETTLEMENTSTATUS" NOT NULL DEFAULT 'PENDING',
    "releaseEligibleAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerPayouts" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "payoutNumber" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "status" "PAYOUTSTATUS" NOT NULL DEFAULT 'PENDING',
    "payoutMethod" TEXT NOT NULL,
    "referenceNo" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerPayouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerPayoutItems" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerPayoutItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerAddresses" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "addressType" "ADDRESSTYPE" NOT NULL DEFAULT 'SHIPPING',
    "recipientName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "barangay" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerAddresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "orderId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carts" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItems" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "priceSnapshot" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wishlists" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wishlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItems" (
    "id" TEXT NOT NULL,
    "wishlistId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovements" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "storeId" TEXT NOT NULL,
    "movementType" "INVENTORYMOVEMENTTYPE" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "previousOnHand" INTEGER NOT NULL,
    "newOnHand" INTEGER NOT NULL,
    "referenceId" TEXT,
    "referenceType" "INVENTORYREFERENCETYPE",
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "shippingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labelUrl" TEXT,
    "status" "SHIPMENTSTATUS" NOT NULL DEFAULT 'PENDING',
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequests" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RETURNSTATUS" NOT NULL DEFAULT 'PENDING',
    "refundAmount" DECIMAL(12,2) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogs" (
    "id" TEXT NOT NULL,
    "performedById" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "buildNumber" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "apkUrl" TEXT NOT NULL,
    "fileSize" TEXT NOT NULL,
    "minAndroidVersion" TEXT NOT NULL,
    "architecture" TEXT NOT NULL,
    "sha256" TEXT,
    "whatsNew" JSONB NOT NULL,
    "status" "RELEASESTATUS" NOT NULL DEFAULT 'ACTIVE',
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "forceUpdate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserRoles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CategoriesToStores" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoriesToStores_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Users_avatarFileId_key" ON "Users"("avatarFileId");

-- CreateIndex
CREATE INDEX "Users_userReferralId_idx" ON "Users"("userReferralId");

-- CreateIndex
CREATE INDEX "Users_email_idx" ON "Users"("email");

-- CreateIndex
CREATE INDEX "Users_accountStatus_idx" ON "Users"("accountStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Users_userReferralId_id_key" ON "Users"("userReferralId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Roles_roleName_key" ON "Roles"("roleName");

-- CreateIndex
CREATE UNIQUE INDEX "Permissions_code_key" ON "Permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshToken_key" ON "Session"("refreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "Session_provider_providerUserId_key" ON "Session"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Sellers_userId_key" ON "Sellers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Buyers_userId_key" ON "Buyers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvites_email_key" ON "AdminInvites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvites_token_key" ON "AdminInvites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Stores_slug_key" ON "Stores"("slug");

-- CreateIndex
CREATE INDEX "Stores_sellerId_idx" ON "Stores"("sellerId");

-- CreateIndex
CREATE INDEX "Stores_isActive_idx" ON "Stores"("isActive");

-- CreateIndex
CREATE INDEX "Stores_primaryCategoryId_idx" ON "Stores"("primaryCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreHours_storeId_dayOfWeek_key" ON "StoreHours"("storeId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "StoreLocations_storeId_key" ON "StoreLocations"("storeId");

-- CreateIndex
CREATE INDEX "StoreLocations_latitude_longitude_idx" ON "StoreLocations"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "StoreReviews_storeId_idx" ON "StoreReviews"("storeId");

-- CreateIndex
CREATE INDEX "StoreReviews_buyerId_idx" ON "StoreReviews"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreReviews_storeId_buyerId_key" ON "StoreReviews"("storeId", "buyerId");

-- CreateIndex
CREATE INDEX "MerchantAds_storeId_isActive_idx" ON "MerchantAds"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "MerchantAdProducts_productId_idx" ON "MerchantAdProducts"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAdProducts_adId_productId_variantId_key" ON "MerchantAdProducts"("adId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "Products_storeId_idx" ON "Products"("storeId");

-- CreateIndex
CREATE INDEX "Products_categoryId_idx" ON "Products"("categoryId");

-- CreateIndex
CREATE INDEX "Products_isActive_idx" ON "Products"("isActive");

-- CreateIndex
CREATE INDEX "Products_status_idx" ON "Products"("status");

-- CreateIndex
CREATE INDEX "Products_storeId_status_isActive_idx" ON "Products"("storeId", "status", "isActive");

-- CreateIndex
CREATE INDEX "Products_categoryId_status_isActive_idx" ON "Products"("categoryId", "status", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariants_sku_key" ON "ProductVariants"("sku");

-- CreateIndex
CREATE INDEX "ProductVariants_productId_idx" ON "ProductVariants"("productId");

-- CreateIndex
CREATE INDEX "ProductVariants_sku_idx" ON "ProductVariants"("sku");

-- CreateIndex
CREATE INDEX "ProductOptions_productId_idx" ON "ProductOptions"("productId");

-- CreateIndex
CREATE INDEX "ProductOptionValues_optionId_idx" ON "ProductOptionValues"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProducts_supplierSku_key" ON "SupplierProducts"("supplierSku");

-- CreateIndex
CREATE INDEX "SupplierProducts_sellerId_idx" ON "SupplierProducts"("sellerId");

-- CreateIndex
CREATE INDEX "SupplierProducts_productId_idx" ON "SupplierProducts"("productId");

-- CreateIndex
CREATE INDEX "Categories_parentId_idx" ON "Categories"("parentId");

-- CreateIndex
CREATE INDEX "Categories_status_idx" ON "Categories"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Categories_parentId_name_key" ON "Categories"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tags_name_key" ON "Tags"("name");

-- CreateIndex
CREATE INDEX "ProductTags_tagId_idx" ON "ProductTags"("tagId");

-- CreateIndex
CREATE INDEX "Orders_buyerId_idx" ON "Orders"("buyerId");

-- CreateIndex
CREATE INDEX "Orders_storeId_idx" ON "Orders"("storeId");

-- CreateIndex
CREATE INDEX "Orders_status_idx" ON "Orders"("status");

-- CreateIndex
CREATE INDEX "Orders_createdAt_idx" ON "Orders"("createdAt");

-- CreateIndex
CREATE INDEX "Orders_buyerId_status_idx" ON "Orders"("buyerId", "status");

-- CreateIndex
CREATE INDEX "Orders_storeId_status_idx" ON "Orders"("storeId", "status");

-- CreateIndex
CREATE INDEX "OrderItems_orderId_idx" ON "OrderItems"("orderId");

-- CreateIndex
CREATE INDEX "OrderItems_productId_idx" ON "OrderItems"("productId");

-- CreateIndex
CREATE INDEX "OrderItems_variantId_idx" ON "OrderItems"("variantId");

-- CreateIndex
CREATE INDEX "OrderItems_appliedAdId_idx" ON "OrderItems"("appliedAdId");

-- CreateIndex
CREATE INDEX "ProductImages_productId_idx" ON "ProductImages"("productId");

-- CreateIndex
CREATE INDEX "ProductImages_variantId_idx" ON "ProductImages"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImages_productId_variantId_isPrimary_key" ON "ProductImages"("productId", "variantId", "isPrimary");

-- CreateIndex
CREATE INDEX "Inventory_productId_idx" ON "Inventory"("productId");

-- CreateIndex
CREATE INDEX "Inventory_storeId_idx" ON "Inventory"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_storeId_productId_variantId_key" ON "Inventory"("storeId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryReservations_inventoryId_status_idx" ON "InventoryReservations"("inventoryId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservations_expiresAt_status_idx" ON "InventoryReservations"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "InventoryReservations_buyerId_status_idx" ON "InventoryReservations"("buyerId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservations_orderId_idx" ON "InventoryReservations"("orderId");

-- CreateIndex
CREATE INDEX "InventoryReservations_cartId_idx" ON "InventoryReservations"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "Payments_referenceNumber_key" ON "Payments"("referenceNumber");

-- CreateIndex
CREATE INDEX "Payments_orderId_idx" ON "Payments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRules_categoryId_key" ON "CommissionRules"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlements_orderId_key" ON "Settlements"("orderId");

-- CreateIndex
CREATE INDEX "Settlements_sellerId_idx" ON "Settlements"("sellerId");

-- CreateIndex
CREATE INDEX "Settlements_status_idx" ON "Settlements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SellerPayouts_payoutNumber_key" ON "SellerPayouts"("payoutNumber");

-- CreateIndex
CREATE INDEX "SellerPayouts_sellerId_idx" ON "SellerPayouts"("sellerId");

-- CreateIndex
CREATE INDEX "SellerPayouts_status_idx" ON "SellerPayouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SellerPayoutItems_settlementId_key" ON "SellerPayoutItems"("settlementId");

-- CreateIndex
CREATE INDEX "SellerPayoutItems_payoutId_idx" ON "SellerPayoutItems"("payoutId");

-- CreateIndex
CREATE INDEX "BuyerAddresses_buyerId_idx" ON "BuyerAddresses"("buyerId");

-- CreateIndex
CREATE INDEX "ProductReviews_productId_idx" ON "ProductReviews"("productId");

-- CreateIndex
CREATE INDEX "ProductReviews_buyerId_idx" ON "ProductReviews"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReviews_productId_buyerId_orderId_key" ON "ProductReviews"("productId", "buyerId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Carts_buyerId_key" ON "Carts"("buyerId");

-- CreateIndex
CREATE INDEX "CartItems_cartId_idx" ON "CartItems"("cartId");

-- CreateIndex
CREATE INDEX "CartItems_productId_idx" ON "CartItems"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItems_cartId_productId_variantId_key" ON "CartItems"("cartId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Wishlists_buyerId_key" ON "Wishlists"("buyerId");

-- CreateIndex
CREATE INDEX "WishlistItems_wishlistId_idx" ON "WishlistItems"("wishlistId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItems_wishlistId_productId_variantId_key" ON "WishlistItems"("wishlistId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryMovements_inventoryId_idx" ON "InventoryMovements"("inventoryId");

-- CreateIndex
CREATE INDEX "InventoryMovements_productId_idx" ON "InventoryMovements"("productId");

-- CreateIndex
CREATE INDEX "InventoryMovements_storeId_idx" ON "InventoryMovements"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipments_orderId_key" ON "Shipments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipments_trackingNumber_key" ON "Shipments"("trackingNumber");

-- CreateIndex
CREATE INDEX "Shipments_status_idx" ON "Shipments"("status");

-- CreateIndex
CREATE INDEX "ReturnRequests_orderId_idx" ON "ReturnRequests"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequests_buyerId_idx" ON "ReturnRequests"("buyerId");

-- CreateIndex
CREATE INDEX "ReturnRequests_sellerId_idx" ON "ReturnRequests"("sellerId");

-- CreateIndex
CREATE INDEX "AuditLogs_performedById_idx" ON "AuditLogs"("performedById");

-- CreateIndex
CREATE INDEX "AuditLogs_entityType_entityId_idx" ON "AuditLogs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLogs_requestId_idx" ON "AuditLogs"("requestId");

-- CreateIndex
CREATE INDEX "Notifications_userId_idx" ON "Notifications"("userId");

-- CreateIndex
CREATE INDEX "Notifications_readAt_idx" ON "Notifications"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppRelease_version_key" ON "AppRelease"("version");

-- CreateIndex
CREATE UNIQUE INDEX "AppRelease_buildNumber_key" ON "AppRelease"("buildNumber");

-- CreateIndex
CREATE INDEX "AppRelease_status_idx" ON "AppRelease"("status");

-- CreateIndex
CREATE INDEX "AppRelease_isLatest_idx" ON "AppRelease"("isLatest");

-- CreateIndex
CREATE INDEX "_UserRoles_B_index" ON "_UserRoles"("B");

-- CreateIndex
CREATE INDEX "_CategoriesToStores_B_index" ON "_CategoriesToStores"("B");

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_avatarFileId_fkey" FOREIGN KEY ("avatarFileId") REFERENCES "Files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_userReferralId_fkey" FOREIGN KEY ("userReferralId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermissions" ADD CONSTRAINT "RolePermissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermissions" ADD CONSTRAINT "RolePermissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sellers" ADD CONSTRAINT "Sellers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buyers" ADD CONSTRAINT "Buyers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerifications" ADD CONSTRAINT "DocumentVerifications_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerifications" ADD CONSTRAINT "DocumentVerifications_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerifications" ADD CONSTRAINT "DocumentVerifications_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_documentVerificationsId_fkey" FOREIGN KEY ("documentVerificationsId") REFERENCES "DocumentVerifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "Files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminInvites" ADD CONSTRAINT "AdminInvites_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stores" ADD CONSTRAINT "Stores_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stores" ADD CONSTRAINT "Stores_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stores" ADD CONSTRAINT "Stores_primaryCategoryId_fkey" FOREIGN KEY ("primaryCategoryId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stores" ADD CONSTRAINT "Stores_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreHours" ADD CONSTRAINT "StoreHours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLocations" ADD CONSTRAINT "StoreLocations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReviews" ADD CONSTRAINT "StoreReviews_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReviews" ADD CONSTRAINT "StoreReviews_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAds" ADD CONSTRAINT "MerchantAds_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAdProducts" ADD CONSTRAINT "MerchantAdProducts_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MerchantAds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAdProducts" ADD CONSTRAINT "MerchantAdProducts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAdProducts" ADD CONSTRAINT "MerchantAdProducts_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariants" ADD CONSTRAINT "ProductVariants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptions" ADD CONSTRAINT "ProductOptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionValues" ADD CONSTRAINT "ProductOptionValues_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantToOptionValue" ADD CONSTRAINT "ProductVariantToOptionValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantToOptionValue" ADD CONSTRAINT "ProductVariantToOptionValue_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "ProductOptionValues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProducts" ADD CONSTRAINT "SupplierProducts_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProducts" ADD CONSTRAINT "SupplierProducts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Categories" ADD CONSTRAINT "Categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTags" ADD CONSTRAINT "ProductTags_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTags" ADD CONSTRAINT "ProductTags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItems" ADD CONSTRAINT "OrderItems_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItems" ADD CONSTRAINT "OrderItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItems" ADD CONSTRAINT "OrderItems_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItems" ADD CONSTRAINT "OrderItems_appliedAdId_fkey" FOREIGN KEY ("appliedAdId") REFERENCES "MerchantAds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImages" ADD CONSTRAINT "ProductImages_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImages" ADD CONSTRAINT "ProductImages_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImages" ADD CONSTRAINT "ProductImages_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "Files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payments" ADD CONSTRAINT "Payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRules" ADD CONSTRAINT "CommissionRules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlements" ADD CONSTRAINT "Settlements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlements" ADD CONSTRAINT "Settlements_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerPayouts" ADD CONSTRAINT "SellerPayouts_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerPayoutItems" ADD CONSTRAINT "SellerPayoutItems_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "SellerPayouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerPayoutItems" ADD CONSTRAINT "SellerPayoutItems_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAddresses" ADD CONSTRAINT "BuyerAddresses_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviews" ADD CONSTRAINT "ProductReviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviews" ADD CONSTRAINT "ProductReviews_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carts" ADD CONSTRAINT "Carts_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItems" ADD CONSTRAINT "CartItems_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItems" ADD CONSTRAINT "CartItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItems" ADD CONSTRAINT "CartItems_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wishlists" ADD CONSTRAINT "Wishlists_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItems" ADD CONSTRAINT "WishlistItems_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "Wishlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItems" ADD CONSTRAINT "WishlistItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItems" ADD CONSTRAINT "WishlistItems_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovements" ADD CONSTRAINT "InventoryMovements_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovements" ADD CONSTRAINT "InventoryMovements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovements" ADD CONSTRAINT "InventoryMovements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovements" ADD CONSTRAINT "InventoryMovements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipments" ADD CONSTRAINT "Shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequests" ADD CONSTRAINT "ReturnRequests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequests" ADD CONSTRAINT "ReturnRequests_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequests" ADD CONSTRAINT "ReturnRequests_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_A_fkey" FOREIGN KEY ("A") REFERENCES "Roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_B_fkey" FOREIGN KEY ("B") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoriesToStores" ADD CONSTRAINT "_CategoriesToStores_A_fkey" FOREIGN KEY ("A") REFERENCES "Categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoriesToStores" ADD CONSTRAINT "_CategoriesToStores_B_fkey" FOREIGN KEY ("B") REFERENCES "Stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

