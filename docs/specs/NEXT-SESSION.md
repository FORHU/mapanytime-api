# MapAnytime — Immediate Execution Checklist (Next Session)

**Updated:** 2026-09-07 (auth + deploy). The payments/MapPoints checklist from
**2026-08-24** follows from §1 onward and is unchanged — it was not worked on
2026-09-07 and its items are still open.

**Primary Reference:** [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md)  
**Historical Context:** [`FLAGS.md`](./FLAGS.md) · [`OPEN-FLAGS.md`](./OPEN-FLAGS.md)

---

## 0. CONTINUE HERE — picked up 2026-09-08

Everything from the 2026-09-07 session is **merged and on `staging`**; the repo
is clean and there is nothing left to commit. What remains is AWS console work
and two verifications. Do them in this order.

> **Run `git fetch` first.** GitHub was unreachable at the end of the session, so
> the last confirmed state is `origin/staging` at `7203309`.

- [ ] **A. Check the `ACCESS_TOKEN_EXPIRY` repository secret.** _Two minutes, do
      it first._ Both deploy workflows read `secrets.ACCESS_TOKEN_EXPIRY` and only
      fall back to the `15m` literal. If that secret still says `7d`, production
      access tokens are still seven days and the whole of F98 is not actually in
      effect — while the merged PR makes it look done. Clear it or set `15m`.

- [ ] **B. Do the AWS setup for SSM, before the next merge to `staging`.**
      The staging deploy now triggers on merges to `staging` (it used to watch the
      abandoned `main`), so **the next merge auto-deploys and will fail** at
      `configure-aws-credentials` until this exists. It fails safely — nothing
      reaches ECR, Parameter Store or the box — but it is red every time.
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

- [ ] **C. Prove staging, then production.** No deploy has ever run through the
      SSM path — static checks pass, but the first live run is what finds anything
      wrong. Production is `workflow_dispatch` only so it cannot fire by accident;
      do not press it until staging is green.

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
- [ ] **P1-9. Admin Pricing Engine UI**
  - Build frontend screens in `mapanytime-market-admin` to manage Pricing Configurations and Components via existing API routes.


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
