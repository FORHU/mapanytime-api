-- Invites are replaced by admin-created staff accounts
-- (POST /v1/seller/org/members/create), which create the user, the membership
-- and the store assignments in one transaction.
--
-- Nothing is lost. The invite flow was never completable: no accept page ever
-- shipped in the web app, tokens had no expiry set, the invited address was
-- never checked against the accepting user, and acceptance granted zero stores
-- -- so a redeemed invite produced a member who could see nothing.
--
-- INVITESTATUS is deliberately NOT dropped: AdminInvites still uses it.

-- DropForeignKey
ALTER TABLE "SellerOrganizationInvites" DROP CONSTRAINT IF EXISTS "SellerOrganizationInvites_sellerOrganizationId_fkey";
ALTER TABLE "SellerOrganizationInvites" DROP CONSTRAINT IF EXISTS "SellerOrganizationInvites_invitedById_fkey";

-- DropTable
DROP TABLE IF EXISTS "SellerOrganizationInvites";
