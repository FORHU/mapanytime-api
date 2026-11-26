-- Sign-up saves the address as one line (addressLine1); city, province and
-- ZIP code are optional parts.
ALTER TABLE "BuyerAddresses" ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "province" DROP NOT NULL,
ALTER COLUMN "zipCode" DROP NOT NULL;
