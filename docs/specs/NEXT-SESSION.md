# MapAnytime — Immediate Execution Checklist (Next Session)

**Updated:** 2026-10-26 (Checkpoint / Turning Point).

**Primary Reference:** [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md)  
**Historical Context:** [`FLAGS.md`](./FLAGS.md) · [`OPEN-FLAGS.md`](./OPEN-FLAGS.md)

---

## ▶ RESUME HERE — Checkpoint 2026-10-26 (Turning Point)

**Current Staging State:**

- All 3 repositories (`mapanytime-api`, `mapanytime-market-web`, `mapanytime-market-app`) are cleanly synchronized on `staging` with 0 uncommitted changes.
- **API PR #167** merged: Seeded Stripe provider & domestic card rates (coexistence with Xendit). Issue #128 closed.
- **API PR #168** merged: Made `marketplace_data.seeder.ts` fully idempotent across re-runs.
- **API PR #169** merged: Standardized seed passwords to `Password123!` (satisfying mobile 8+ char rule) and added auto-refresh for existing accounts.
- **App PR #81** merged: Android release signing configured with `key.properties` and automated debug fallback. Issue #76 closed.
- **Infrastructure / Secrets:** Obsolete secrets purged (#130 closed); Gmail SMTP configured on port 465 SSL (#135 closed).
- **Staging Database (`13.250.56.66`):** All 56 migrations up to date; all 16 modular seeders executed cleanly with 0 errors. Staging login verified (200 OK).
- **Staging Mobile APK:** Built at `mapanytime-market-app/build/app/outputs/flutter-apk/app-release.apk` (167.2 MB) and installed onto physical Realme phone (RMX3231).

**Strict Directive:**

- **No Over-Engineering** (codified in `.agents/rules/no-overengineering.md`). Minimal, direct solutions only.

**Immediate Next Tasks When Resuming Tomorrow:**

1. **Physical Phone Verification ([App #71](https://github.com/FORHU/mapanytime-market-app/issues/71))**:
   - Log in on Realme phone with `dual@example.com` / `Password123!`.
   - Verify: Map tab retention during tab switches, store navigation back-stack, live order toast reception, checkout "Back to Home" navigation.
   - Close Issue #71 on Board #24 once verified.
2. **Publish APK to Web Admin ([App #72](https://github.com/FORHU/mapanytime-market-app/issues/72))** [COMPLETED]:
   - Uploaded `app-release.apk` (167.2 MB, SHA256 `eb39ca254311f2d392ec326ae4aeda6d081e976f581ce6ca26c8f6361680356d`) to `https://dev.mapanytime.com/admin/app-releases`.
   - Release `1.0.0` (build 1, Channel: Stable) marked active & downloadable; public download verified via `/api/v1/app/download`. Issue #72 closed.
3. **P2-2. Merchant Advertising Marketing Wallet** (`mapanytime-api`):
   - Minimal marketing deposit wallet (`MarketingWallet` + `MarketingWalletTransactions`) to fund sponsored map pin ad spend (`/v1/merchant-ads`).
4. **P3-1. Buyer Loyalty Rewards (`RewardWallet`)** (`mapanytime-api`):
   - Minimal buyer loyalty points ledger (₱100 spend = 1 point, 100 points = ₱10 discount) hooked into order completion.

---

The production deploy order, for when production starts, is on API #115
(pre-deploy checks) and #116 (the deploy itself).

The 2026-10-06 notes below are older; their unticked items are still open
unless marked superseded.

## 0. Previous session — 2026-10-06

### ✅ Completed This Session

- **F74**: Gateway session creation moved outside DB transaction to prevent pool exhaustion & rollback anomalies
- **F44**: Automated `expireStalePendingOrders` sweeper running every 2 minutes releasing holds and marking abandoned orders `CANCELLED`
- **F76**: Flutter mobile client sends `Idempotency-Key` header on checkout
- **F91**: Inventory reservation TTL sweeper running every 60 seconds wired into server boot & shutdown
- **F92**: Fixed Inventory Reservation IDOR and removed redundant insecure confirm route
- **Distributed Rate Limiting**: Migrated to RedisStore with namespaced keys, structured 429 logging, and emergency local limit fallback for security-sensitive auth routes
- **Client 429 Cooldown**: TanStack Query (Web) and Dio Smart Retry (Flutter App) now dynamically honor the server's `Retry-After` header
- **P0-6**: Provider-Backed Refunds & Automated Reversal (Xendit provider refund API, journal reversal, restock)
- **Stripe Authoritative Spec**: Authored [`STRIPE_PAYMENT_IMPLEMENTATION_PLAN.md`](./STRIPE_PAYMENT_IMPLEMENTATION_PLAN.md) detailing Stripe lifecycle, idempotency keys, raw webhook handling, reconciliation sweeper, failure testing, junior dev scope, and senior review checklist

### ▶️ Next Up (Junior Developer Scope & Production Hardening)

- **Stripe Integration**: Implement Stripe provider (`stripe.provider.ts`), raw webhook router (`/webhooks/stripe`), and webhook deduplication per [`STRIPE_PAYMENT_IMPLEMENTATION_PLAN.md`](./STRIPE_PAYMENT_IMPLEMENTATION_PLAN.md)
- **Payment Reconciliation**: Background sweeper for unresolved payments
- **Failure-Oriented Tests**: Duplicate webhook, race conditions, lost webhook recovery
- **P1-2**: Environment & Staging Isolation

> **Run `git fetch` first.** GitHub was unreachable at the end of the session, so
> the last confirmed state is `origin/staging` at `7203309`.

- [x] ~~**A. Check the `ACCESS_TOKEN_EXPIRY` repository secret.**~~ **Superseded
      2026-10-14:** JWT was removed (#122/#123); access-token expiry no longer
      exists, and the deploy workflows no longer read that secret. The secret
      can be deleted from the repository.

- [ ] **B. Do the AWS setup for SSM, before the first production deploy.**
      _Corrected 2026-10-14:_ merges do **not** deploy. The workflows are
      `ci.yml` (push/PR) and two `workflow_dispatch`-only deploys
      (`deploy-production.yml`, `deploy-dev.yml` for the shared dev host). A deploy
      without this setup fails at `configure-aws-credentials` — safely, before
      anything reaches ECR, Parameter Store or the box.
      Full checklist with the reasoning: [`../../infra/README.md`](../../infra/README.md) §4.
  - [ ] Create the OIDC role — trust `infra/aws-oidc-trust-policy.json`,
        permissions `infra/cicd-deploy-policy.json`. ARN → `AWS_DEPLOY_ROLE_ARN`.
  - [ ] Tag the instances; set `EC2_TARGET_TAG_KEY` / `EC2_TARGET_TAG_VALUE` as
        **GitHub environment variables, not repository-wide** — both workflows read
        the same names and rely on `environment:` to resolve them per environment.
  - [ ] Attach to each instance role: `AmazonSSMManagedInstanceCore` +
        `ec2-ecr-pull-policy.json` + `ec2-cloudwatch-logs-policy.json` +
        `ec2-app-runtime-policy.json`. The ECR one used to be self-granted on every
        deploy via `iam:PutRolePolicy`; that step is deleted, so it must be attached
        by hand or `docker pull` is denied on the box.
  - [ ] Confirm each box is a managed node: `aws ssm describe-instance-information`.

- [ ] **C. Prove the SSM path on the first production deploy.** _Corrected
      2026-10-14:_ there is no staging server — production is the only box — so
      there is no staging deploy to prove first. No deploy has run through the SSM
      path yet; static checks pass, but watch the first live run closely.

- [ ] **D. After the first green staging deploy:** delete the stale scp'd env
      files at `/home/ec2-user/mapanytime-api.env` and
      `/home/ec2-user/mapanytime-api-staging.env`. Nothing overwrites them (the new
      path is `/opt/mapanytime-api/`) and they still hold every secret they held
      before.

- [ ] **E. Ship the auth migration to production.** It goes out with the next
      production deploy via `prisma migrate deploy`. Expect **one forced re-login
      for every user** — the migration drops all sessions and clears
      `activeSessionId`, because refresh tokens cannot cross the plaintext→hash
      change. Staging already went through this on 2026-09-07.

### Open questions, unanswered

- [ ] **Does production use a different S3 bucket?**
      `infra/ec2-app-runtime-policy.json` names `forhu-marketplace-dev`, taken from
      the staging `.env` — the one value in `infra/` most likely wrong for
      production. If both environments genuinely share a bucket, that is its own
      problem: staging writes would be landing beside real customer uploads.
- [ ] **What happens to `main`?** It is 25 commits behind `staging`, holds nothing
      `staging` lacks, and `origin/HEAD` points at `staging`. It reads as abandoned
      rather than release-bearing. Retire it or start using it.

### Not started, offered

- [ ] **`gc3-client-web` health check and rollback.** Different repo
      (`lwshq/gc3-client-web`). Its production deploy removes the old container
      before starting the new one and never verifies the result, so a crash-on-boot
      image deploys green with downtime and nothing to roll back to. Its SSM wait
      loop also polls for only ~5 minutes, which reports a false failure on a slow
      but successful deploy. Both are fixed in this repo's version and worth porting.

---

## 0b. Baseline

**Current — 2026-09-07:**

| Module           | Branch                          | Verified Status                                                |
| :--------------- | :------------------------------ | :------------------------------------------------------------- |
| `mapanytime-api` | `staging` (default) @ `7203309` | 702 tests / 66 suites · `tsc` · ESLint · prettier · tree clean |

**Stale — 2026-08-24**, kept because it is the last verified state for the three
modules not touched on 2026-09-07. The `mapanytime-api` row is superseded above;
that branch has long since merged.

| Module                    | Branch                                    | Verified Status                                                     |
| :------------------------ | :---------------------------------------- | :------------------------------------------------------------------ |
| `mapanytime-api`          | `feat/wishlist-refund-and-role-cleanup`   | 358 tests / 43 suites passing · `tsc` · ESLint · Working tree clean |
| `mapanytime-market-web`   | `feat/seller-finance-and-catalog-cleanup` | `tsc` · ESLint · `next build` · Working tree clean                  |
| `mapanytime-market-app`   | `feat/wishlist-and-notifications`         | `flutter analyze` · 26 tests · Working tree clean                   |
| `mapanytime-market-admin` | `main`                                    | Working tree clean                                                  |

---

## 1. PHASE 1 (P0): FINANCIAL CORRECTNESS (DO THESE FIRST)

_The platform must prove that a single ₱1,000 transaction reconciles end-to-end before implementing new features._

- [x] **P0-1. Confirm Real Contracted Payment Rates**
  - Verify exact PayMongo & Xendit processing rates for GCash/Maya vs Card.
  - Insert `QRPH` and `GRAB_PAY` real rates into `PricingComponents`.
- [x] **P0-2. Migrate Orphaned `CommissionRules`**
  - Migrate active rows from `CommissionRules` to `PricingComponents` (`SELLER_MARKETPLACE_FEE` scoped by `categoryId`).
  - Verify migration and safely drop `CommissionRules` table and endpoints.
- [x] **P0-3. Remove Obsolete `Orders.taxAmount`**
  - Verify 0 code reads/writes.
  - Drop column `taxAmount`.
  - Create a migration to drop the column, regenerate Prisma client, and verify tests.
- [x] **P0-4. Confirm Settlement Hold Policy (`SETTLEMENT_HOLD_DAYS`)**
  - Confirm the default **7-day hold period** with the business owner (protects platform during return window).
- [x] **P0-5. Verify Vertical Financial Transaction Lifecycle**
  - Trace and test:
    $$\text{Cart} \rightarrow \text{Pricing Engine} \rightarrow \text{Order Creation} \rightarrow \text{Payment Gateway} \rightarrow \text{Webhook Confirmation} \rightarrow \text{Order Completion} \rightarrow \text{Seller Settlement} \rightarrow \text{Payout Batch}$$
- [x] **P0-6. Provider-Backed Refunds & Payment Reconciliation**
  - Connected provider refund execution (`PayMongoProvider.refundPayment` & `XenditProvider.refundPayment`).
  - Verified refund adjustments update payment status (`REFUNDED` / `PARTIALLY_REFUNDED`), reverse unearned settlements, and restock inventory.

---

## 2. PHASE 2 (P1): SECURITY, OPERATIONS & CORE PRODUCT GAPS

- [x] **P1-1. HTTP CORS Hardening**
  - Remove wildcard origin reflection on credentialed HTTP endpoints.
  - Restrict `Access-Control-Allow-Origin` to explicit allowlisted origins (matching the WebSocket gateway).
- [ ] **P1-2. Environment & Staging Isolation**
  - Separate staging and production container names, ports, env files, and databases.
- [x] **P1-3. Admin Invitation Endpoint (ID-5)**
  - Implement `POST /v1/admin/invites` (token generation, expiration, email dispatch, and activation flow).
- [x] **P1-4. Analytics Session ID & View Deduplication**
  - Generate client `sessionId` on web and mobile.
  - Deduplicate repeat views by `sessionId + productId + time window` before rollups.
- [x] **P1-5. In-App Notification Feed Routes (NTF-1 to NTF-3)**
  - Wire `GET /v1/notifications`, `PATCH /v1/notifications/:id/read`, `POST /v1/notifications/read-all`, and unread badge count.
- [ ] **P1-6. Map Pin $\rightarrow$ Storefront Experience**
  - Complete the client flow: Pin tap $\rightarrow$ store summary preview $\rightarrow$ storefront $\rightarrow$ products $\rightarrow$ cart.
- [ ] **P1-7. Scheduled Cron Hygiene**
  - Verify reservation expiration job; remove or implement empty cron shells.
- [x] **P1-8. Add `.gitattributes` to `-web`**
  - Ensure consistent line endings across environments.
- [x] **P1-9. Admin Pricing Engine UI**
  - Build frontend screens in `mapanytime-market-admin` to manage Pricing Configurations and Components via existing API routes.

---

## 3. PHASE 3 (P2): GROWTH ANALYTICS & ADVERTISING

- [x] **P2-1. Analytics Daily Rollups & Rule-Based Ranking**
  - Implement daily aggregation cron, most-viewed, trending, and proximity-based sorting.
- [x] **P2-2. Merchant Advertising Marketing Wallet**
  - Build merchant marketing deposit wallet to fund sponsored map pin ad spend.

---

## 4. PHASE 4 (P3): TRI-DOMAIN ECONOMIC ECOSYSTEM

_Spec: [`ECONOMIC_AND_PAYMENT_SYSTEM_IMPLEMENTATION_SPEC.md`](./ECONOMIC_AND_PAYMENT_SYSTEM_IMPLEMENTATION_SPEC.md) and [`MAP_POINTS_FEATURE_SPEC.md`](./MAP_POINTS_FEATURE_SPEC.md)_

- [x] **P3-1. Buyer Loyalty Rewards (`RewardWallet` + `RewardTransactions` + `RewardConfigurations`)**
  - ₱100 eligible subtotal = 1 Reward Point (~1%).
  - 100 Reward Points = ₱10 discount (max 20% order subtotal cap).
  - 12-month rolling expiration with explicit `-EXPIRATION` ledger entries.
- [x] **P3-2. Seller Incentives (`SellerCampaigns` + `SellerCampaignTransactions`)** (PR #171)
  - Merchant-funded buyer point campaigns with budget tracking, in-transaction order completion hook, and ROI metrics.
- [x] **P3-3. Agent Recruiter Commissions (`AgentCommissionAccount` + `AgentCommissionTransactions` + `AgentPayouts`)** (PR #173)
  - Real PHP commissions (0.05% GMV configurable).
  - 7-day holding window (`PENDING` $\rightarrow$ `MATURED`) and payout requests (Min ₱500).
- [x] **P3-4. Atomic Multi-Ledger Hook in `OrderService.completeOrder`** (PR #171, PR #173)
  - Atomically commit order completion + seller settlement + buyer reward + seller campaign incentive + agent commission.
- [x] **P3-5. Dynamic Multi-Gateway Payments (`XenditProvider`)**
  - Add `XenditProvider` and dynamic gateway switching/failover in `PaymentService.getProviderAdapter`.
