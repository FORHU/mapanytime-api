-- Approved sellers that already own a store have completed onboarding.
-- This repairs legacy rows created before isOnboarded was maintained.
UPDATE "Sellers" AS seller
SET
  "isOnboarded" = true,
  "onboardingStep" = GREATEST("onboardingStep", 3),
  "onboardedAt" = COALESCE("onboardedAt", CURRENT_TIMESTAMP)
WHERE seller."applicationStatus" = 'APPROVED'
  AND seller."isOnboarded" = false
  AND EXISTS (
    SELECT 1
    FROM "Stores" AS store
    WHERE store."sellerId" = seller.id
      AND store."deletedAt" IS NULL
  );
