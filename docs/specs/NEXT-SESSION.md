# MapAnytime — Immediate Execution Checklist (Next Session)

**Updated:** 2026-08-24  
**Primary Reference:** [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md)  
**Historical Context:** [`FLAGS.md`](./FLAGS.md)

---

## 0. Current Baseline State

| Module                    | Branch                                    | Verified Status                                                     |
| :------------------------ | :---------------------------------------- | :------------------------------------------------------------------ |
| `mapanytime-api`          | `feat/wishlist-refund-and-role-cleanup`   | 358 tests / 43 suites passing · `tsc` · ESLint · Working tree clean |
| `mapanytime-market-web`   | `feat/seller-finance-and-catalog-cleanup` | `tsc` · ESLint · `next build` · Working tree clean                  |
| `mapanytime-market-app`   | `feat/wishlist-and-notifications`         | `flutter analyze` · 26 tests · Working tree clean                   |
| `mapanytime-market-admin` | `main`                                    | Working tree clean                                                  |

---

## 1. PHASE 1 (P0): FINANCIAL CORRECTNESS (DO THESE FIRST)

_The platform must prove that a single ₱1,000 transaction reconciles end-to-end before implementing new features._

- [ ] **P0-1. Confirm Real Contracted Payment Rates (QRPH & GrabPay)**
  - Obtain the real commercial rates for `QRPH` and `GRAB_PAY`.
  - Insert them into `PricingComponents` so they do not fall back to the generic 2.00% rate.
- [ ] **P0-2. Inspect & Migrate Orphaned `CommissionRules`**
  - Check if `CommissionRules` contains any live category-specific commission rates.
  - Migrate active rows to `PricingComponents` (`SELLER_MARKETPLACE_FEE` scoped by `categoryId`).
  - Verify migration and safely drop the obsolete `CommissionRules` table.
- [ ] **P0-3. Remove Obsolete `Orders.taxAmount`**
  - Verify zero code reads/writes `Orders.taxAmount`.
  - Create a migration to drop the column, regenerate Prisma client, and verify tests.
- [ ] **P0-4. Confirm Settlement Hold Policy (`SETTLEMENT_HOLD_DAYS`)**
  - Confirm the default **7-day hold period** with the business owner (protects platform during return window).
- [ ] **P0-5. Verify Vertical Financial Transaction Lifecycle**
  - Trace and test:
    $$\text{Cart} \rightarrow \text{Pricing Engine} \rightarrow \text{Order Creation} \rightarrow \text{Payment Gateway} \rightarrow \text{Webhook Confirmation} \rightarrow \text{Order Completion} \rightarrow \text{Seller Settlement} \rightarrow \text{Payout Batch}$$
- [ ] **P0-6. Provider-Backed Refunds & Payment Reconciliation**
  - Connect provider refund execution (`PayMongoProvider.refundPayment`).
  - Verify refund adjustments update payment status (`REFUNDED` / `PARTIALLY_REFUNDED`) and reverse unearned settlements.
  - Build automated payment-provider reconciliation job (`capturedAmount` vs `MapAnytime payments`).

---

## 2. PHASE 2 (P1): SECURITY, OPERATIONS & CORE PRODUCT GAPS

- [ ] **P1-1. HTTP CORS Hardening**
  - Remove wildcard origin reflection on credentialed HTTP endpoints.
  - Restrict `Access-Control-Allow-Origin` to explicit allowlisted origins (matching the WebSocket gateway).
- [ ] **P1-2. Environment & Staging Isolation**
  - Separate staging and production container names, ports, env files, and databases.
- [ ] **P1-3. Admin Invitation Endpoint (ID-5)**
  - Implement `POST /v1/admin/invites` (token generation, expiration, email dispatch, and activation flow).
- [ ] **P1-4. Analytics Session ID & View Deduplication**
  - Generate client `sessionId` on web and mobile.
  - Deduplicate repeat views by `sessionId + productId + time window` before rollups.
- [ ] **P1-5. In-App Notification Feed Routes (NTF-1 to NTF-3)**
  - Wire `GET /v1/notifications`, `PATCH /v1/notifications/:id/read`, `POST /v1/notifications/read-all`, and unread badge count.
- [ ] **P1-6. Map Pin $\rightarrow$ Storefront Experience**
  - Complete the client flow: Pin tap $\rightarrow$ store summary preview $\rightarrow$ storefront $\rightarrow$ products $\rightarrow$ cart.
- [ ] **P1-7. Scheduled Cron Hygiene**
  - Verify reservation expiration job; remove or implement empty cron shells.
- [ ] **P1-8. Add `.gitattributes` to `-web`**
  - Ensure consistent line endings across environments.

---

## 3. PHASE 3 (P2): GROWTH ANALYTICS & ADVERTISING

- [ ] **P2-1. Analytics Daily Rollups & Rule-Based Ranking**
  - Implement daily aggregation cron, most-viewed, trending, and proximity-based sorting.
- [ ] **P2-2. Merchant Advertising Marketing Wallet**
  - Build merchant marketing deposit wallet to fund sponsored map pin ad spend.

---

## 4. PHASE 4 (P3): TRI-DOMAIN ECONOMIC ECOSYSTEM

_Spec: [`ECONOMIC_AND_PAYMENT_SYSTEM_IMPLEMENTATION_SPEC.md`](./ECONOMIC_AND_PAYMENT_SYSTEM_IMPLEMENTATION_SPEC.md) and [`MAP_POINTS_FEATURE_SPEC.md`](./MAP_POINTS_FEATURE_SPEC.md)_

- [ ] **P3-1. Buyer Loyalty Rewards (`RewardWallet` + `RewardTransactions` + `RewardConfigurations`)**
  - ₱100 eligible subtotal = 1 Reward Point (~1%).
  - 100 Reward Points = ₱10 discount (max 20% order subtotal cap).
  - 12-month rolling expiration with explicit `-EXPIRATION` ledger entries.
- [ ] **P3-2. Seller Incentives (`SellerCampaigns` + `SellerCampaignTransactions`)**
  - Merchant-funded buyer point campaigns with budget tracking and ROI metrics.
- [ ] **P3-3. Agent Recruiter Commissions (`AgentCommissionAccount` + `AgentCommissionTransactions` + `AgentPayouts`)**
  - Real PHP commissions (0.05% GMV configurable).
  - 7-day holding window (`PENDING` $\rightarrow$ `MATURED`) and payout requests (Min ₱500).
- [ ] **P3-4. Atomic Multi-Ledger Hook in `OrderService.completeOrder`**
  - Atomically commit order completion + seller settlement + buyer reward + agent commission.
- [ ] **P3-5. Dynamic Multi-Gateway Payments (`XenditProvider`)**
  - Add `XenditProvider` and dynamic gateway switching/failover in `PaymentService.getProviderAdapter`.
