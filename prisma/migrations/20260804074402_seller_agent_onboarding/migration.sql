-- AlterTable
ALTER TABLE "Sellers" ADD COLUMN     "agentNotes" TEXT,
ADD COLUMN     "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sellerPlan" TEXT;

-- Existing Sellers with a Store have already completed the current onboarding flow.
UPDATE "Sellers" AS seller
SET "isOnboarded" = true,
    "onboardingStep" = 3,
    "onboardedAt" = COALESCE(seller."updatedAt", CURRENT_TIMESTAMP)
WHERE EXISTS (
  SELECT 1
  FROM "Stores" AS store
  WHERE store."sellerId" = seller."id"
    AND store."deletedAt" IS NULL
);

UPDATE "Users" AS user_record
SET "isOnBoarding" = false
WHERE EXISTS (
  SELECT 1
  FROM "Sellers" AS seller
  WHERE seller."userId" = user_record."id"
    AND seller."isOnboarded" = true
);
