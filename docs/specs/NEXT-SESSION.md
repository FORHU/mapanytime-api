# Next session — consolidated tasks

**Updated 2026-08-24.** This is the immediate developer to-do list derived from `MASTER_EXECUTION_PLAN.md`.

Full detail lives in [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) (decisions and sequencing) and [`FLAGS.md`](./FLAGS.md) (findings). This file is the short version — the to-do, not the record.

---

## State at the pause

| Repo | Branch | Verified |
| :--- | :--- | :--- |
| `mapanytime-api` | `feat/retire-vat` | 325 tests / 39 suites · tsc · ESLint |
| `mapanytime-market-web` | `feat/buyer-checkout-admin-wiring` | tsc · ESLint · `next build` |
| `mapanytime-market-app` | `feat/retire-vat` | `flutter analyze` · 26 tests |

**Nothing is committed.** You commit manually.

---

## 0. Before anything else

- [x] **Run the migrations.** Five written and applied via `prisma migrate dev`.
- [x] **Commit the work.** All three repos cleanly committed by feature.

---

## 1. Two migration bugs found and fixed (2026-08-20, late)

---

## 2. Item 14 — the app cannot take a payment · ✅ **DONE 2026-08-20**

- [x] Datasource + Riverpod provider for `GET /payments/methods?amount=<goodsTotal>`
- [x] Replace the hardcoded list at `checkout_page.dart` with the live one —
      showing each method's `feeAmount` / `buyerTotalAmount`, and rendering
      `unavailableReason` on disabled methods instead of hiding them
- [x] **Make `OrderRemoteDataSource.createOrder` return the `checkoutUrl`.**
- [x] Present that URL via `url_launcher` (in-app browser view / external browser)
- [x] Leave cash on its existing pay-on-pickup path — no gateway, no URL
- [x] Leave the pickup pass QR alone (`MAPANYTIME-ORDER-{orderId}`)

The web `features/checkout` built for item 6 is the working reference. The API
side needs nothing further.

---

## 3. Item 13 — analytics · **phase 2 only**

Settled: dedup now, rollups and ranking deferred. Without deduplication every
view count is inflated and rollups built on top inherit the error; rollups and
ranking need real traffic to shape them, and there is none yet.

- [ ] Issue a client-side `sessionId` — **the web sends none today**
- [ ] Send it on every analytics event
- [ ] Collapse repeat views of the same product by the same session within a window
- [ ] ~~Phase 3 rollups, ranking, recommendations~~ — deferred by decision

`recommendations_page.dart` stays a screen with nothing behind it until ranking
exists.

---

## 4. Smaller open threads

Carried over from `FIX-PLAN.md`; none are blocking.

- [ ] **Contracted rates for `QRPH` and `GRAB_PAY`** (item 1). Both price off the
      2.00% fallback today and will undercharge if their real rate is higher.
      This is a commercial input, not a code change — get the numbers, then seed
      them as `PricingComponents`.
- [ ] **`CommissionRules` is orphaned** (item 2). `TaxationService` was its only
      reader and is deleted. Migrate any live per-category rates into
      `PricingComponents` (`SELLER_MARKETPLACE_FEE` scoped by `categoryId`), then
      drop the table. Left in place because dropping is destructive and the table
      may hold real rates.
- [ ] **`Orders.taxAmount` is a leftover.** VAT was retired; nothing writes this
      column any more. Drop it, or it will confuse someone in six months.
- [ ] **Admin invite endpoint (ID-5).** `AdminInvites` is a model with no
      endpoint — the same shape of gap as the four just closed in item 11.
- [ ] **Push notifications (NTF-4).** Still nothing at either end. Explicitly out
      of scope for item 11, which built the in-app feed only.
- [ ] **Reconciliation (F24).** Seller settlement is now built and covered.
      Payment reconciliation against PayMongo's own statement, and admin
      financial reporting, remain unverified — and are now meaningful, since
      orders price off real rates.
- [ ] **Tri-Domain Economic Architecture (ECO-1 to ECO-11, AGT-3/4).**
      Spec: `mapanytime-api/docs/specs/ECONOMIC_AND_PAYMENT_SYSTEM_IMPLEMENTATION_SPEC.md`.
      1. Buyer Rewards: `RewardWallet`, `RewardTransactions`, `RewardConfigurations` (100 pts = ₱10, 20% cap, 12m rolling expiry).
      2. Seller Incentives: `SellerCampaigns`, `SellerCampaignTransactions` (merchant-funded buyer point campaigns).
      3. Agent Commissions: `AgentCommissionAccount`, `AgentCommissionTransactions`, `AgentPayouts` (real PHP commissions, 0.05% GMV configurable).
      Atomic multi-ledger settlement inside `OrderService.completeOrder()` $transaction alongside seller settlement.
- [ ] **Dynamic Multi-Gateway Payment System with Xendit Integration (F13/F14).**
      Add `XenditProvider` implementing `PaymentProvider` (`src/modules/payments/providers/xendit.provider.ts`).
      Configure dynamic gateway selection and failover across PayMongo and Xendit in `PaymentService.getProviderAdapter`.
- [ ] **`-web` has no `.gitattributes`.** See §0.

---

## 5. Worth a look when convenient

Not on the plan, noticed in passing:

- The **cash-commission netting** built this session (a negative settlement that
  nets off the seller's next gateway-funded payout) has no way to collect from a
  seller who takes **only** cash — their balance just goes further negative and
  no payout ever runs. Fine while most sales are online; revisit if that stops
  being true.
- `SETTLEMENT_HOLD_DAYS` defaults to **7**. That was my choice as a sensible
  default covering the return window, not a decision you made. Confirm it.
