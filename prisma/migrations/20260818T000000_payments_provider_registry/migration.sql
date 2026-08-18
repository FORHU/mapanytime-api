-- Payments provider registry
--
-- HAND-WRITTEN. `prisma migrate dev` would generate the DROPs at the bottom
-- without steps 3-5, silently discarding the payment method of every existing
-- row. See docs/payments-rework-review.md §3.
--
-- FOR A DATABASE THAT HAS NEVER HAD THE PAYMENTS REWORK APPLIED.
--
-- The local dev database already has all of this from a `prisma db push` run
-- while the rework was being written: the three tables exist, PAYMENTMETHOD is
-- already dropped, and Payments already carries providerId/paymentMethodId. On
-- such a database this file WILL FAIL on the first CREATE TYPE. Baseline it
-- instead of running it:
--
--   npx prisma migrate resolve --applied 20260818T000000_payments_provider_registry
--
-- Run it for real only on a database still holding the old Payments shape.
-- Confirm DATABASE_URL first — it has resolved to staging from a local shell.

-- ---------------------------------------------------------------------------
-- 1. New enum + tables
-- ---------------------------------------------------------------------------

CREATE TYPE "PAYMENTMETHODTYPE" AS ENUM ('CARD', 'E_WALLET', 'BANK', 'QR', 'CASH', 'OTHER');

CREATE TABLE "PaymentProviders" (
    "id"          TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT false,
    "priority"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentProviders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentProviders_code_key" ON "PaymentProviders"("code");
CREATE INDEX "PaymentProviders_isActive_idx" ON "PaymentProviders"("isActive");
CREATE INDEX "PaymentProviders_priority_idx" ON "PaymentProviders"("priority");

CREATE TABLE "PaymentMethods" (
    "id"          TEXT NOT NULL,
    "providerId"  TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "type"        "PAYMENTMETHODTYPE" NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT false,
    "priority"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentMethods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentMethods_providerId_code_key" ON "PaymentMethods"("providerId", "code");
CREATE INDEX "PaymentMethods_providerId_idx" ON "PaymentMethods"("providerId");
CREATE INDEX "PaymentMethods_isActive_idx" ON "PaymentMethods"("isActive");
CREATE INDEX "PaymentMethods_type_idx" ON "PaymentMethods"("type");

ALTER TABLE "PaymentMethods"
    ADD CONSTRAINT "PaymentMethods_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "PaymentProviders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PaymentWebhookEvents" (
    "id"          TEXT NOT NULL,
    "providerId"  TEXT NOT NULL,
    "eventId"     TEXT NOT NULL,
    "eventType"   TEXT NOT NULL,
    "payload"     JSONB NOT NULL,
    "processed"   BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentWebhookEvents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentWebhookEvents_providerId_eventId_key" ON "PaymentWebhookEvents"("providerId", "eventId");
CREATE INDEX "PaymentWebhookEvents_eventType_idx" ON "PaymentWebhookEvents"("eventType");
CREATE INDEX "PaymentWebhookEvents_processed_idx" ON "PaymentWebhookEvents"("processed");

ALTER TABLE "PaymentWebhookEvents"
    ADD CONSTRAINT "PaymentWebhookEvents_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "PaymentProviders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Seed the providers/methods the backfill points at
--
-- Inlined rather than left to payments.seeder.ts because step 4 depends on
-- these rows existing, and a migration must not assume a seeder ran first.
-- Ids are deterministic so re-running against a partly-migrated database is
-- idempotent. Kept in sync with prisma/seeders/payments.seeder.ts.
-- ---------------------------------------------------------------------------

INSERT INTO "PaymentProviders" ("id", "code", "name", "description", "isActive", "priority", "updatedAt") VALUES
    ('prov_seed_paymongo', 'PAYMONGO', 'PayMongo', 'Philippines Leading Payment Gateway (GCash, Maya, Cards, QR Ph)', true, 1,  CURRENT_TIMESTAMP),
    ('prov_seed_cash',     'CASH',     'Cash',     'Physical cash on pickup/delivery',                                 true, 10, CURRENT_TIMESTAMP),
    ('prov_seed_mock',     'MOCK',     'Mock Payment Gateway', 'Simulated Sandbox Gateway for Development & Testing',  true, 99, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "PaymentMethods" ("id", "providerId", "code", "name", "type", "isActive", "priority", "updatedAt") VALUES
    ('meth_seed_gcash',    'prov_seed_paymongo', 'GCASH',        'GCash',                     'E_WALLET', true, 1, CURRENT_TIMESTAMP),
    ('meth_seed_maya',     'prov_seed_paymongo', 'MAYA',         'Maya',                      'E_WALLET', true, 2, CURRENT_TIMESTAMP),
    ('meth_seed_qrph',     'prov_seed_paymongo', 'QRPH',         'QR Ph',                     'QR',       true, 3, CURRENT_TIMESTAMP),
    ('meth_seed_card',     'prov_seed_paymongo', 'CARD',         'Credit / Debit Card',       'CARD',     true, 4, CURRENT_TIMESTAMP),
    ('meth_seed_grabpay',  'prov_seed_paymongo', 'GRAB_PAY',     'GrabPay',                   'E_WALLET', true, 5, CURRENT_TIMESTAMP),
    ('meth_seed_cod',      'prov_seed_cash',     'COD',          'Cash on Delivery / Pickup', 'CASH',     true, 1, CURRENT_TIMESTAMP),
    ('meth_seed_mock',     'prov_seed_mock',     'MOCK_SANDBOX', 'Sandbox Simulator',         'OTHER',    true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("providerId", "code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. New Payments columns, nullable so existing rows survive the add
-- ---------------------------------------------------------------------------

ALTER TABLE "Payments"
    ADD COLUMN "providerId"        TEXT,
    ADD COLUMN "paymentMethodId"   TEXT,
    ADD COLUMN "providerReference" TEXT,
    ADD COLUMN "checkoutSessionId" TEXT,
    ADD COLUMN "paymentIntentId"   TEXT;

-- ---------------------------------------------------------------------------
-- 4. Backfill — must run BEFORE the drops in step 6
--
-- The old PAYMENTMETHOD enum was (BANK, E_WALLET, CASH_ON_DELIVERY). E_WALLET
-- and BANK named a type rather than a channel, so there is no exact mapping;
-- E_WALLET goes to GCash as the overwhelmingly common case in this market, and
-- BANK to QR Ph, which is what PayMongo exposes for bank transfers. Neither is
-- reversible — check the row counts this reports before committing.
-- ---------------------------------------------------------------------------

UPDATE "Payments" SET
    "paymentMethodId" = CASE "paymentMethod"
        WHEN 'CASH_ON_DELIVERY' THEN 'meth_seed_cod'
        WHEN 'E_WALLET'         THEN 'meth_seed_gcash'
        WHEN 'BANK'             THEN 'meth_seed_qrph'
    END,
    "providerId" = CASE "paymentMethod"
        WHEN 'CASH_ON_DELIVERY' THEN 'prov_seed_cash'
        ELSE 'prov_seed_paymongo'
    END,
    -- gatewayReference held whatever the old provider returned; providerReference
    -- is its direct successor. `gateway` was a free-text label ('PAYMONGO' /
    -- 'MOCK' / 'GCASH_MOCK') now carried by the provider relation, so it is
    -- dropped rather than migrated.
    "providerReference" = "gatewayReference"
WHERE "paymentMethod" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Constraints and indexes, added only once the data is consistent
-- ---------------------------------------------------------------------------

ALTER TABLE "Payments"
    ADD CONSTRAINT "Payments_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "PaymentProviders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payments"
    ADD CONSTRAINT "Payments_paymentMethodId_fkey"
    FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Payments_providerId_idx"        ON "Payments"("providerId");
CREATE INDEX "Payments_paymentMethodId_idx"   ON "Payments"("paymentMethodId");
CREATE INDEX "Payments_status_idx"            ON "Payments"("status");
CREATE INDEX "Payments_providerReference_idx" ON "Payments"("providerReference");
CREATE INDEX "Payments_checkoutSessionId_idx" ON "Payments"("checkoutSessionId");

-- ---------------------------------------------------------------------------
-- 6. Drop the superseded columns and enum
-- ---------------------------------------------------------------------------

ALTER TABLE "Payments"
    DROP COLUMN "paymentMethod",
    DROP COLUMN "gateway",
    DROP COLUMN "gatewayReference";

DROP TYPE "PAYMENTMETHOD";
