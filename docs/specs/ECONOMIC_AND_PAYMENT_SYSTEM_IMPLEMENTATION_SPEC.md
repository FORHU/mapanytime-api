# MAPANYTIME — ECONOMIC SYSTEM & DYNAMIC PAYMENTS
## MASTER IMPLEMENTATION BLUEPRINT & SPECIFICATION

**Location:** `mapanytime-api/docs/specs/ECONOMIC_AND_PAYMENT_SYSTEM_IMPLEMENTATION_SPEC.md`  
**Status:** READY FOR IMPLEMENTATION  
**Target Systems:**
1. **Buyer Rewards (MapAnytime Rewards)** — Loyalty discount ledger
2. **Seller Incentives (Seller Campaigns)** — Merchant marketing promotions & ROI
3. **Agent Commissions (Recruiter Commission)** — Real PHP commissions & payouts
4. **Dynamic Multi-Gateway Payments** — PayMongo + Xendit provider switching

---

## 1. IMPLEMENTATION ARCHITECTURE OVERVIEW

```
                                  MAPANYTIME PLATFORM
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         │                                 │                                 │
     1. BUYER                          2. SELLER                         3. AGENT
  Loyalty Rewards                  Seller Incentives                    Commissions
(100 pts = ₱10 discount)         (Campaign Budget & ROI)            (Real PHP Earnings)
         │                                 │                                 │
   RewardWallet                     SellerCampaigns                AgentCommissionAccount
   RewardTransactions               SellerCampaignTransactions     AgentCommissionTransactions
   RewardConfigurations             SellerCampaignBudget           AgentCommissionConfigurations
         │                                 │                       AgentPayouts
         └─────────────────────────────────┼─────────────────────────────────┘
                                           │
                           4. DYNAMIC PAYMENT GATEWAYS
                                           │
                             PaymentProviders (PostgreSQL)
                           ┌───────────────┴───────────────┐
                           ▼                               ▼
                   PayMongoProvider                  XenditProvider
               (GCash, Maya, Cards)              (Cards, QRPh, Banks)
```

---

## 2. PHASE 1: DATABASE SCHEMA & MIGRATIONS (`prisma/schema.prisma`)

### A. Buyer Reward Models
```prisma
model RewardWallet {
  id             String               @id @default(cuid())
  buyerId        String               @unique
  balance        Int                  @default(0)
  pendingBalance Int                  @default(0)
  lifetimeEarned Int                  @default(0)
  lifetimeSpent  Int                  @default(0)

  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  buyer          Buyers               @relation(fields: [buyerId], references: [id], onDelete: Cascade)
  transactions   RewardTransactions[]

  @@index([buyerId])
}

model RewardTransactions {
  id           String                @id @default(cuid())
  walletId     String
  type         REWARDTRANSACTIONTYPE

  amount       Int
  balanceAfter Int

  orderId      String?
  referenceKey String?               @unique
  source       String?
  description  String?

  expiresAt    DateTime?
  createdAt    DateTime              @default(now())

  wallet RewardWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([walletId, createdAt])
  @@index([orderId])
  @@index([type])
  @@index([expiresAt])
}

model RewardConfigurations {
  id                    String    @id @default(cuid())
  version               Int       @default(1)
  isActive              Boolean   @default(true)

  earnRatePhpPerPoint   Decimal   @default(100.00) @db.Decimal(10, 2) // ₱100 = 1 pt
  pointValueInPhp       Decimal   @default(0.10)   @db.Decimal(10, 4) // 1 pt = ₱0.10
  maxRedemptionRate     Decimal   @default(0.2000) @db.Decimal(5, 4)  // Max 20.00% cap
  minRedemptionPoints   Int       @default(100)
  expirationMonths      Int       @default(12)
  isEarningActive       Boolean   @default(true)
  isRedemptionActive    Boolean   @default(true)

  signupBonusPoints     Int       @default(100)
  referralBonusPoints   Int       @default(500)
  reviewBonusPoints     Int       @default(20)
  storeVisitBonusPoints Int       @default(10)

  effectiveFrom         DateTime  @default(now())
  effectiveTo           DateTime?
  updatedById           String?
  changeReason          String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([isActive])
}

enum REWARDTRANSACTIONTYPE {
  PURCHASE
  REFERRAL
  REVIEW
  STORE_VISIT
  CAMPAIGN
  BONUS
  REDEMPTION
  REVERSAL
  EXPIRATION
  ADJUSTMENT
}
```

### B. Seller Campaign & Incentive Models
```prisma
model SellerCampaigns {
  id              String                @id @default(cuid())
  sellerId        String
  storeId         String?
  name            String
  type            SELLERCAMPAIGNTYPE    @default(BONUS_POINTS)
  status          CAMPAIGNSTATUS        @default(DRAFT)

  startDate       DateTime
  endDate         DateTime
  budgetAmount    Decimal               @db.Decimal(12, 2)
  spentAmount     Decimal               @default(0) @db.Decimal(12, 2)
  maxRewardPoints Int?
  minOrderAmount  Decimal?              @db.Decimal(12, 2)

  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  seller          Sellers               @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  transactions    SellerCampaignTransactions[]

  @@index([sellerId])
  @@index([status])
}

model SellerCampaignTransactions {
  id            String          @id @default(cuid())
  campaignId    String
  sellerId      String
  buyerId       String
  orderId       String
  pointsGranted Int
  sellerCost    Decimal         @db.Decimal(12, 2)
  referenceKey  String?         @unique
  createdAt     DateTime        @default(now())

  campaign SellerCampaigns @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@index([campaignId])
  @@index([sellerId])
  @@index([orderId])
}

enum SELLERCAMPAIGNTYPE {
  BONUS_POINTS
  DOUBLE_POINTS
  PRODUCT_BOOST
}

enum CAMPAIGNSTATUS {
  DRAFT
  ACTIVE
  PAUSED
  COMPLETED
  EXHAUSTED
}
```

### C. Agent Commission Models
```prisma
model AgentCommissionAccount {
  id               String                        @id @default(cuid())
  agentId          String                        @unique
  availableBalance Decimal                       @default(0) @db.Decimal(12, 2)
  pendingBalance   Decimal                       @default(0) @db.Decimal(12, 2)
  lifetimeEarned   Decimal                       @default(0) @db.Decimal(12, 2)
  lifetimePaid     Decimal                       @default(0) @db.Decimal(12, 2)

  createdAt        DateTime                      @default(now())
  updatedAt        DateTime                      @updatedAt

  user             Users                         @relation(fields: [agentId], references: [id], onDelete: Cascade)
  transactions     AgentCommissionTransactions[]
  payouts          AgentPayouts[]

  @@index([agentId])
}

model AgentCommissionTransactions {
  id               String                    @id @default(cuid())
  accountId        String
  agentId          String
  sellerId         String
  orderId          String
  type             AGENTCOMMISSIONTYPE
  status           COMMISSIONSTATUS          @default(PENDING)

  commissionRate   Decimal                   @db.Decimal(8, 5) // e.g. 0.00050 (0.05%)
  commissionBase   COMMISSIONBASE            @default(GMV)
  baseAmount       Decimal                   @db.Decimal(12, 2)
  commissionAmount Decimal                   @db.Decimal(12, 2)
  balanceAfter     Decimal                   @db.Decimal(12, 2)

  referenceKey     String?                   @unique
  description      String?
  maturesAt        DateTime?
  createdAt        DateTime                  @default(now())

  account AgentCommissionAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, createdAt])
  @@index([agentId])
  @@index([sellerId])
  @@index([orderId])
  @@index([status])
}

model AgentCommissionConfigurations {
  id                  String          @id @default(cuid())
  version             Int             @default(1)
  isActive            Boolean         @default(true)

  commissionRate      Decimal         @default(0.00050) @db.Decimal(8, 5) // 0.05%
  commissionBase      COMMISSIONBASE  @default(GMV)                       // "GMV" | "MARKETPLACE_FEE"
  eligibilityHoldDays Int             @default(7)                         // Matures after 7 days
  payoutMinimum       Decimal         @default(500.00) @db.Decimal(12, 2) // Min ₱500 payout
  isEnabled           Boolean         @default(true)

  effectiveFrom       DateTime        @default(now())
  effectiveTo         DateTime?
  updatedById         String?
  changeReason        String?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  @@index([isActive])
}

model AgentPayouts {
  id            String          @id @default(cuid())
  agentId       String
  accountId     String
  amount        Decimal         @db.Decimal(12, 2)
  status        PAYOUTSTATUS    @default(PENDING)
  paymentMethod String
  reference     String?
  processedAt   DateTime?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  account AgentCommissionAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([agentId])
  @@index([status])
}

enum AGENTCOMMISSIONTYPE {
  SALE_COMMISSION
  RECRUITMENT_BONUS
  COMMISSION_REVERSAL
  ADJUSTMENT
}

enum COMMISSIONSTATUS {
  PENDING
  MATURED
  CANCELLED
  PAID
}

enum COMMISSIONBASE {
  GMV
  MARKETPLACE_FEE
  NET_PLATFORM_REVENUE
}
```

---

## 3. PHASE 2: ATOMIC MULTI-LEDGER ORDER COMPLETION HOOK

In `mapanytime-api/src/modules/orders/order.service.ts` (`completeOrder`):

```typescript
// Inside prisma.$transaction:
return await prisma.$transaction(async (tx) => {
  // 1. Update order status
  const completedOrder = await tx.orders.update({
    where: { id: orderId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  // 2. Create Seller Settlement (Net goods amount owed to seller)
  await SettlementService.createForCompletedOrder(tx, orderId);

  // 3. Award Buyer Reward Points (₱100 eligible spend = 1 pt)
  await RewardService.awardForCompletedOrder(tx, {
    orderId,
    buyerId: completedOrder.buyerId,
    eligibleSubtotal: completedOrder.subtotal,
  });

  // 4. Calculate & Credit Agent Commission (if seller was recruited by an agent)
  await AgentCommissionService.creditOrderCommission(tx, {
    orderId,
    sellerId: completedOrder.sellerId,
    gmvAmount: completedOrder.subtotal,
  });

  return completedOrder;
});
```

---

## 4. PHASE 3: DYNAMIC MULTI-GATEWAY PAYMENTS (PAYMONGO + XENDIT)

### A. New Provider: `XenditProvider` (`src/modules/payments/providers/xendit.provider.ts`)
```typescript
import axios from 'axios';
import {
  CreateCheckoutInput,
  CheckoutResult,
  PaymentProvider,
  RefundResult,
} from './payment-provider.interface';

export class XenditProvider implements PaymentProvider {
  private secretKey = process.env.XENDIT_SECRET_KEY || '';
  private webhookToken = process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN || '';
  private apiUrl = process.env.XENDIT_API_URL || 'https://api.xendit.co';

  private get authHeader() {
    return `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const payload = {
      external_id: input.orderId,
      amount: input.amountInCentavos / 100, // Xendit uses PHP decimal
      description: input.description || `Order #${input.orderId}`,
      success_redirect_url: input.successUrl,
      failure_redirect_url: input.cancelUrl,
      currency: 'PHP',
    };

    const res = await axios.post(`${this.apiUrl}/v2/invoices`, payload, {
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
    });

    return {
      providerReference: res.data.id,
      checkoutUrl: res.data.invoice_url,
      raw: res.data,
    };
  }

  async refundPayment(paymentReference: string, amountInCentavos: number): Promise<RefundResult> {
    // Implement Xendit refund endpoint integration
    return { success: true, refundReference: `xendit_ref_${Date.now()}` };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    // Verify x-callback-token against process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN
    return signature === this.webhookToken;
  }

  parseWebhookEvent(body: any): any {
    return {
      eventType: body.status === 'PAID' || body.status === 'SETTLED' ? 'payment.paid' : 'payment.failed',
      orderId: body.external_id,
      amountInCentavos: Math.round(Number(body.amount) * 100),
      raw: body,
    };
  }
}
```

### B. Updated Provider Factory (`PaymentService.getProviderAdapter`)
```typescript
static getProviderAdapter(providerCode: string): PaymentProvider {
  switch (providerCode.toUpperCase()) {
    case 'PAYMONGO':
      if (!process.env.PAYMONGO_SECRET_KEY) return new MockProvider();
      return new PayMongoProvider();
    case 'XENDIT':
      if (!process.env.XENDIT_SECRET_KEY) return new MockProvider();
      return new XenditProvider();
    case 'MOCK':
    default:
      return new MockProvider();
  }
}
```

---

## 5. PHASE 4: SCHEDULED BACKGROUND ENGINES

1. **Buyer Points Expiration Engine** (`0 2 * * *` — Daily at 2:00 AM):
   - Finds `RewardTransactions` where `expiresAt <= NOW()` with remaining unspent balance.
   - Appends `-EXPIRATION` transaction and updates `RewardWallet.balance`.

2. **Agent Commission Maturation Engine** (`0 3 * * *` — Daily at 3:00 AM):
   - Finds `AgentCommissionTransactions` with status `PENDING` where `maturesAt <= NOW()`.
   - Moves amounts from `pendingBalance` to `availableBalance` and marks status `MATURED`.

3. **Reconciliation Audit Engine** (`0 4 * * 0` — Weekly Sunday at 4:00 AM):
   - Audits `RewardWallet.balance` against `SUM(RewardTransactions.amount)`.
   - Audits `AgentCommissionAccount.availableBalance + pendingBalance` against `SUM(AgentCommissionTransactions.commissionAmount)`.
   - Logs `RECONCILIATION_ALERT` if any mismatch is found.

---

## 6. PHASE 5: TEST SUITE EXECUTION PLAN

| Test Suite | File Location | Coverage Scope |
| :--- | :--- | :--- |
| `rewards.service.spec.ts` | `src/modules/rewards/rewards.service.spec.ts` | Earning calculations, 20% cap validation, spending locks, 12m expiry. |
| `agent-commission.service.spec.ts` | `src/modules/agents/agent-commission.service.spec.ts` | GMV commission calculations, holding maturation, payout requests. |
| `order-economic-settlement.spec.ts` | `src/modules/orders/order-economic-settlement.spec.ts` | Atomic 4-way transaction on `completeOrder` (rollback on failure). |
| `xendit.provider.spec.ts` | `src/modules/payments/providers/xendit.provider.spec.ts` | Invoice generation, callback token verification, webhook payload parsing. |
