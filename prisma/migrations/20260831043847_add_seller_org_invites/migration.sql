-- CreateTable
CREATE TABLE "SellerOrganizationInvites" (
    "id" TEXT NOT NULL,
    "sellerOrganizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "INVITESTATUS" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOrganizationInvites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerOrganizationInvites_email_idx" ON "SellerOrganizationInvites"("email");

-- CreateIndex
CREATE INDEX "SellerOrganizationInvites_tokenHash_idx" ON "SellerOrganizationInvites"("tokenHash");

-- AddForeignKey
ALTER TABLE "SellerOrganizationInvites" ADD CONSTRAINT "SellerOrganizationInvites_sellerOrganizationId_fkey" FOREIGN KEY ("sellerOrganizationId") REFERENCES "SellerOrganizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationInvites" ADD CONSTRAINT "SellerOrganizationInvites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SellerOrganizationRoles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrganizationInvites" ADD CONSTRAINT "SellerOrganizationInvites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
