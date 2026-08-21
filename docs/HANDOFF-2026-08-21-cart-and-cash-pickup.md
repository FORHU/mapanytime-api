# Handoff — multi-store cart (shipped) + cash-on-pickup redesign (open)

**Date:** 2026-08-21 · **Workspace:** `marketPlace/` (4 sibling repos; the root is *not* a git repo)

---

## 1. Read these first

| Path | What it holds |
|---|---|
| `FIX-PLAN.md` **item 17** | Full multi-store cart writeup — decision, tasks, phase 2 scope, still-open list |
| `FIX-PLAN.md` items 1–16 | Prior sessions. 13/17 done. Items 13 and 14 still open |
| `FLAGS.md` | Findings register |
| `FEATURES_AND_FLOWS.md` **Flow 7** | "Pickup Pass vs. Delivery Shipping" — the documented pickup-pass flow |
| `REQUIREMENTS.md` ORD-7 | Marked ✅ — **this is wrong**, see §3.2 |

**In a hurry? Read §9** — the ranked list of what needs tackling, with the three blocking decisions up front.

> ⚠️ Those files live at the workspace **root, which is not a git repo**. They exist only on the original machine. This handoff sits inside `mapanytime-api/docs/` so it travels with a clone; the root docs do not. Copy them across manually or they are lost.

---

## 2. What shipped this session — multi-store cart, Phase 1

**Committed, not pushed, no PRs open.**

| Repo | Branch | Commit |
|---|---|---|
| `mapanytime-api` | `feat/multi-store-cart` | `6d60eb9` |
| `mapanytime-market-app` | `feat/multi-store-cart` | `9863334` |

Both branches are **+1 commit ahead of `origin/main`** — cleanly based. Local `main` is stale in both repos (API by a day, app by three), so `git pull` on main before judging branch state or the divergence looks alarming when it isn't.

**The change in one line:** a cart may hold many stores; an order may not. The single-store rule moved from add-to-cart to checkout rather than disappearing.

Mechanics are in `FIX-PLAN.md` item 17 and the two commit messages — not repeated here. What is *not* recorded anywhere else:

- The rule only ever lived in the Redis `CartPayload` root `storeId`. The **database was never single-store** — `Carts` has no `storeId`, and `CartItems` keys on `(cartId, productId, variantId)`. Those tables are **dead**: nothing in `src/` reads `prisma.carts`. Left in place deliberately (inert; dropping them is a destructive migration for no functional gain).
- The Flutter cart had grouped by store since June (`96a7905`); the API guard contradicting it landed a month later (`6058385`). Same author. The app then swallowed the resulting 400 via `_enqueueSync`'s blanket `.catchError((_) {})`, so items appeared in the cart that the server never accepted.
- **Phase 2 (one gateway payment covering several store-orders) is deliberately deferred.** `Payments.orderId` is required and `Settlements` is `orderId @unique` + `sellerId`; that settlement code landed 2026-08-20 after four payment-module rewrites in three days. Do not start Phase 2 until the per-store flow has held still, and only if buyers actually build multi-store carts often enough to justify it.

**Verification at handoff:** API 367 tests / 44 suites, app 38 tests — all green. `tsc` clean, `flutter analyze` clean, `dart format` clean, ESLint clean on every touched file. No schema change, no migration.

*Pre-existing, not from this work:* 2 ESLint errors in `tests/unit/notification.service.test.ts`, and a Jest worker-teardown warning tracked as F38.

---

## 3. The open thread — cash on pickup → reserve-and-pay-at-stall

This is where the conversation ended. **None of it is written down outside this file.**

### 3.1 Cash was never removed

The user believed cash-on-pickup had been removed. It has not. `prisma/seeders/payments.seeder.ts` seeds a `CASH` provider plus a `COD` method with `isActive: true` and **no `NODE_ENV` gate** (unlike `MOCK`), so it is offered at checkout in every environment.

Cash is threaded through five places:

| File | What cash does differently |
|---|---|
| `src/modules/pricing/pricing-engine.service.ts:480` | `isCashPayment` zero-rates the gateway fee |
| `src/modules/orders/order.service.ts:394` | `completeOrder` skips the "payment must be COMPLETED" gate |
| `src/modules/settlements/settlement.service.ts:80` | books a **negative** settlement — the commission the seller owes |
| `src/modules/returns/return.service.ts:233` | refund path forks; there is no gateway refund to issue |
| `src/modules/payments/payment.service.ts:18` | legacy aliases `CASH_ON_DELIVERY` / `CASH` → `COD` for older app builds |

A cash order's `Payments` row stays `PENDING` forever and **no webhook ever fires** — the entire PAID/FAILED path is bypassed.

### 3.2 The intended new flow

User's framing: *"reserve online, pay at the stall, we will generate a QR code for it — I think this is the old pattern."*

They are right that it is the old pattern: the **Digital Pickup Pass**, Flow 7 in `FEATURES_AND_FLOWS.md`. But it is a shell.

**What exists:** app only — `lib/features/orders/presentation/pages/pickup_pass_page.dart` and `lib/shared/widgets/qr_card.dart`.

**What does not exist:** anything server-side. Zero hits for `pickupCode`, `pickupPass`, `redeem`, or any verification endpoint across `src/` and the schema.

**The pass is not a credential:**

```dart
// order_remote_datasource.dart:120 — the "pickup code"
final code = rawId.length >= 8 ? rawId.substring(0, 8).toUpperCase() : rawId.toUpperCase();

// pickup_pass_page.dart:48 — the QR payload
data: 'MAPANYTIME-ORDER-${currentOrder.id}'
```

Both are derived **client-side from the order id**. No server-issued token, no signature, no single-use guarantee, no redemption record. Anyone who knows an order id can reproduce an identical pass.

`REQUIREMENTS.md` ORD-7 is marked ✅ against `pickup_pass_page.dart` — that is UI, not a met requirement. **Correct that row.**

`showQr` is gated on order status `ready` / `pickedUp`, so the pass does not render for a `PENDING` order.

### 3.3 The bug the user found — forgotten pickup

```
order created  →  PENDING, stock reserved
                  expiry = pickupAt + 2h grace  (floor 15 min)
buyer forgets
   ↓  cron, every minute
expireStaleReservations()
   ├ quantityReserved −= qty      ← stock goes back on sale
   └ reservation status = EXPIRED

order status  →  still PENDING.  Forever.
```

`src/modules/inventory/inventoryReservation.repository.ts:171` releases the stock and closes the reservation but **never touches the order**. No job cancels a stale order, and nothing notifies either party. `PENDING → CANCELLED` is a legal transition (`order.state.ts:8`) that nothing ever calls.

**The worse half:** stock is released while the order stays redeemable. If the buyer turns up the next day and the seller marks it ready, the pass renders and handover proceeds against inventory that may already have been sold to someone else. **Nothing re-checks stock at redemption.**

Today this is masked: prepaid orders go `PROCESSING` at the webhook and their reservations become `CONSUMED`, so they never enter the expiry path. **Pay-at-pickup removes the mask** — unpaid is the normal state, so *every* cash order rides an expiry path built on the assumption that unpaid means abandoned.

### 3.4 What the redesign needs

1. **Server-issued token** on the order — random, not derived from the id, returned only to the owning buyer.
2. **Seller redemption endpoint** — scan or enter the code, validate, mark collected, record who redeemed and when.
3. **Single-use plus expiry**, tied to the reservation window.
4. **Redemption re-validates stock**, not just identity — otherwise the seller takes cash for goods that are gone.
5. **Expiry closes the order**: one transactional job that releases stock *and* moves `PENDING → CANCELLED` with a reason, plus notifications (`emitNotificationToUser` already exists).
6. **Redemption becomes the settlement trigger**, replacing the webhook that cash orders never fire.

Two things make this cheaper than it looks:

- The **negative-settlement mechanism already models exactly this** (landed `b023ac7`): the platform never holds the cash, the seller owes commission, and it nets off their next payout. Redemption simply becomes the firing event instead of `completeOrder`. That mechanism survives the redesign intact.
- It **fits the multi-store cart**: each store's basket is already its own order and its own reservation, so each gets its own pass. Pay-at-stall also sidesteps Phase 2 entirely — no money goes through the gateway, so there is nothing to split.

### 3.5 ⛔ The one unanswered decision

**What should a no-show cost?** Everything else hangs off this.

| Option | Trade-off |
|---|---|
| Nothing — just release the stock | Simplest. One buyer can tie up stock across many stalls for free |
| **Cap concurrent unpaid reservations per buyer** | *Recommended in-session.* No money, no gateway, cheap to build, and targets the failure mode sellers actually care about |
| Deposit via gateway, balance in cash | Makes the reservation binding, but reintroduces a payment and undoes the simplicity |

Also unresolved: **the hold window.** `pickupAt + 2h` was tuned for *prepaid* orders, where a generous hold costs the platform nothing. With pay-at-stall a no-show costs the seller a real sale of real stock — so a shorter hold, a confirmation step, or both.

**Start the next session here** — then read §8, which proposes a design for this and is reviewed against the codebase there.

---

## 4. Also surfaced, not yet actioned

### 4.1 Order → payment flow review (nothing written to `FLAGS.md` yet)

What is solid: pricing is single-source across preview, charge and settlement; `OrderCharges` is a full payer/beneficiary ledger with immutable rate snapshots; stock is properly two-phase; cash-as-negative-settlement is honest accounting.

Five issues found, ranked:

1. **Checkout session inside the DB transaction** — `provider.createCheckoutSession` is a PayMongo network call held inside `prisma.$transaction` (`order.service.ts:285`). A slow gateway holds inventory row locks for its duration; a timeout rolls back an order whose session the provider may already have created. **Fix this one first.**
2. **Settlement is gated on `COMPLETED`, not on payment** — money is captured at the webhook, but no `Settlements` row exists until the seller marks fulfilment. An order paid and never marked complete leaves the seller unpaid with no visible reason.
3. **Webhook ordering is unguarded** — a FAILED arriving after a PAID would still release reservations for an already-paid order.
4. **Gateway line items read `Product #<cuid>`** (`order.service.ts:281`) — buyers see raw ids on the gateway page and their card statement. `productName` is snapshotted one block above.
5. **Line items do not reconcile to the charged total** — they are built from `unitPrice × quantity` with no discount or buyer fee applied, while `amountInCentavos` comes from `buyerTotalAmount`.

### 4.2 User's backlog — mostly untriaged

Raised mid-session; only the first two were investigated.

- **Promo/ads start + end time** — `MerchantAds` has `expiresAt` but **no start field** (`schema.prisma:526`). Needs a `startsAt` column, a migration, and window filtering on every ad query (they currently filter on `isActive` + `expiresAt` only).
- **Out-of-stock hide product** — the data is already there (`Inventory.quantityOnHand` / `quantityReserved`). A query-filter change, no schema work. Note `Inventory` is per-`(storeId, productId, variantId)`, so "hidden" is per-store, not global.
- **Logout on Home button when changing pages** — auth check. Not investigated.
- **Store creation issue; try geolocation** — not investigated.
- **Socket.IO for recently added stores** (id and name only) — not investigated.
- **Currency by user country/location** — *non-trivial.* `currency` is hardcoded `@default("PHP")` on `Orders`, `Payments` and pricing configs, making this a settlement concern rather than a display toggle.

### 4.3 Loose ends from Phase 1

- **Web is unaudited.** `mapanytime-market-web` was not touched. The API change is additive on the fields it reads, so it should not break — but if web checkout assumes one store per cart, it now has the same silent-mismatch shape the app had.
- **`_enqueueSync`'s blanket `.catchError((_) {})`** still hides *every* server rejection in the app — out-of-stock and inactive-product errors fail silently the same way. Deserves a real error path.
- **`FIX-PLAN.md` item 16** — the board line says done, but the body checkboxes (F37/F38/F33) are still unticked. F37 is genuinely done in code.

---

## 5. Environment gotchas

- **Tooling:** Flutter for the app, **npm/npx** for the API. Never bun.
- **`.env` `DATABASE_URL`** — the file carries two entries. Line 5 (localhost) is active; line 6 (staging RDS) is commented out. **Verify before any Prisma write** — it has pointed at staging before.
- **Never add a `Co-Authored-By: Claude` trailer** to commits in this workspace.
- **4 migrations still pending** from earlier FIX-PLAN items.
- API modules live only under `src/modules/`; legacy folders were deleted 2026-08-12.
- The API uses **RabbitMQ** as its async event bus.
- Web "Material 3" is a CSS-variable palette wired into Tailwind, not MUI.

---

## 6. Suggested skills for the next session

| Skill | Why |
|---|---|
| **`grill-me`** | The no-show decision (§3.5) is a design branch with real trade-offs — worth being interrogated on it before any code |
| **`diagnose`** | If picking up the stale-`PENDING`-order bug (§3.3) as a bug rather than as part of the redesign |
| **`tdd`** | The redemption endpoint is money-adjacent and single-use; test-first is the right shape |
| **`code-review`** | Before pushing `feat/multi-store-cart` — nothing has been reviewed yet |

**Do not** start Phase 2 (combined payment) — see §2.

---

## 7. First moves on the new machine

1. `git fetch && git pull` on `main` in both repos — local main is stale.
2. `git checkout feat/multi-store-cart` in both. **The work is unpushed and on no mainline branch**, so it must be pushed from the original machine first, or it will not exist in a fresh clone.
3. Copy the root `.md` files across (`FIX-PLAN.md`, `FLAGS.md`, `REQUIREMENTS.md`, `FEATURES_AND_FLOWS.md`, `NEXT-SESSION.md`) — they are untracked and will not come with a clone.
4. Check `.env` `DATABASE_URL`.
5. Resume at §3.5.

---

## 8. Proposed design — Order QR & seller pickup flow

Authored by the user, 2026-08-21, after the §3 discussion. Recorded verbatim in §8.1, reviewed against the codebase in §8.2. **Read §8.2 before building — three points conflict with what is currently shipped.**

### 8.1 The proposal

Implement the Order QR as a first-class transaction credential, supporting both the normal buyer-side QR flow and a seller-side recovery flow when the buyer forgets their QR.

The backend must always remain the source of truth. The QR should only identify/authorize the pickup transaction and must never contain sensitive customer or payment information.

**1. Buyer places order.** On checkout: create the parent transaction; create individual store-specific orders; generate a secure pickup token per store order; display the corresponding QR to the buyer; store only the secure token/hash/reference needed for validation.

```text
Transaction TX-10001
├── Store Order #10001 — Store A products — Pickup QR A
├── Store Order #10002 — Store B products — Pickup QR B
└── Store Order #10003 — Store C products — Pickup QR C
```

**2. Normal pickup flow.**

```text
BUYER shows Pickup QR
  ↓  SELLER scans QR
  ↓  Backend validates transaction
  ↓  Check seller/store ownership
  ↓  Check payment status
  ↓  Check order status
  ↓  Check QR/token validity
  ↓  Confirm pickup
  ↓  Order = PICKED_UP
```

**3. Buyer forgot the QR.** The seller must still be able to locate the order from the Seller App: `Pending Pickup → Select Order → Verify Order → Confirm Pickup`.

The seller must NOT be able to simply enter an order ID and immediately complete the transaction. The backend must verify: seller is authenticated; order belongs to that seller/store; payment is successful; order is `READY_FOR_PICKUP`; order has not already been picked up; pickup token/credential is valid; and no cancellation/refund/expiration condition prevents pickup.

**4. Seller-side QR recovery.** The seller may have a `Show Pickup QR` option on the order. Recommended *not* to require the seller to scan a QR displayed on the same device — once the seller is authenticated and has the correct order open, `Verify Order → Confirm Pickup` is cleaner. If QR scanning must be the mandatory confirmation method, the seller-displayed QR can be scanned by a second authorized device.

**5. Multi-store cart rule.**

```text
ONE PAYMENT → ONE PARENT TRANSACTION → MULTIPLE STORE ORDERS
            → ONE PICKUP CREDENTIAL PER STORE ORDER
```

One store must never be able to use another store's credential to confirm its order. Every pickup confirmation validates the chain: `Pickup Token → Store Order → Seller/Store → Parent Transaction`.

**6. Backend is the final authority.** Do not trust the QR alone; it carries only a secure reference/token. The backend performs final validation and atomically transitions `READY_FOR_PICKUP → PICKED_UP`. The operation must be transactional so two devices cannot both claim the same order.

**Final rule.** Buyer has QR: seller scans it. Buyer forgot QR: seller opens the order and uses the authenticated seller-side verification flow. In both cases the backend validates payment, seller ownership, order status, pickup credential, and prevents duplicate confirmation.

### 8.2 Review against the codebase

**What is right, and already supported.**

- *Backend as final authority, QR carries only a reference.* Correct, and it is the fix for the §3.2 defect where the pass is derived client-side from the order id.
- *Atomic state transition, no double-claim.* `Orders.version` already exists (`@default(0)`) for optimistic locking, so this needs no new column.
- *One credential per store order, validated through the ownership chain.* Correct, and it maps cleanly onto Phase 1: each store's basket is already its own `Orders` row with its own `storeId`.
- *Seller-side recovery without re-scanning on the same device.* Sound. The stated constraint — never let a seller complete an order from an id alone — is the right guard.

**⚠️ Conflict 1 — "ONE PAYMENT" is Phase 2, which is deferred.**

§5 of the proposal assumes a single payment across stores feeding a parent transaction. That is exactly the combined-payment work deferred in §2 of this handoff and in `FIX-PLAN.md` item 17. What shipped is the opposite: **per-store checkout, one payment per order**, with `POST /orders` rejecting a mixed-store basket.

The proposal is therefore not implementable on the current codebase without first un-deferring Phase 2 — a change to `Payments.orderId`, a payment-group concept, and allocation of the charge and `gatewayFee` across settlements.

Two ways forward, and this is a decision, not a detail:

1. **Keep Phase 1's per-store payments.** The parent transaction becomes a *grouping* record only — it correlates orders placed in one checkout for display and QR issuance, but carries no money. Everything else in the proposal works unchanged. No settlement risk.
2. **Un-defer Phase 2.** The parent transaction becomes a real financial object. Larger, and it touches settlement code that landed 2026-08-20.

Option 1 delivers the entire QR design with none of the financial risk, and leaves Phase 2 free to arrive later.

**⚠️ Conflict 2 — "Check payment status / payment is successful" contradicts pay-at-stall.**

The proposal validates that payment has *already succeeded* before confirming pickup. But §3 of this handoff was designing the opposite: **reserve online, pay at the stall**, where payment happens *at* pickup and the order is deliberately unpaid until then.

These are two different flows and the proposal does not say which it is for:

- If this is the **prepaid** pickup flow, it is coherent as written — and the cash/pay-at-stall redesign in §3 is a separate piece of work still needing its own design.
- If this is meant to **replace** cash-on-pickup, then the "payment is successful" check must become "collect payment now, then confirm" — redemption *is* the payment event, and it becomes the settlement trigger (§3.4 item 6).

**Resolve this first.** It determines whether the redemption endpoint reads payment state or writes it.

**⚠️ Conflict 3 — `PICKED_UP` does not exist in the database.**

`ORDERSTATUS` is `PENDING | PROCESSING | READY_FOR_PICKUP | COMPLETED | CANCELLED | FAILED` (`schema.prisma:849`). There is no `PICKED_UP`.

The app already anticipates one — `order_remote_datasource.dart:88` maps **both** `COMPLETED` and `PICKED_UP` to `OrderStatus.pickedUp`, so the client is ready for a status the backend never emits. Either:

- add `PICKED_UP` to the enum and to `order.state.ts` transitions (a migration), or
- reuse `COMPLETED` and drop `PICKED_UP` from the design.

Adding it is probably right — "picked up" and "completed" are genuinely different events once money can change hands at the counter — but it is a migration, and there are already 4 pending.

**Other notes.**

- **No parent transaction model exists.** `Orders` has no parent link. This needs a new model plus a migration regardless of which option above is chosen.
- **The no-show decision (§3.5) is still unanswered** and this proposal does not address it. Pickup validation must also reject an order whose reservation has expired — otherwise a seller confirms pickup for stock already released back to sale (the §3.3 defect). The proposal's "no cancellation/refund/expiration condition prevents pickup" covers this in principle; it needs the expiry job from §3.4 item 5 to exist before it can be checked.
- Minor: the proposal's line *"Store A must never be able to use Store A's credential to confirm Store B's order"* reads as a typo — the intent is that no store can use another store's credential. Captured that way in §8.1 above.

### 8.3 Suggested build order

1. Settle Conflict 2 — prepaid pickup, or pay-at-stall. Everything else depends on it.
2. Settle Conflict 1 — parent transaction as grouping record (recommended) or as a financial object.
3. Add the parent transaction model + `PICKED_UP` status in one migration.
4. Server-issued pickup token on each store order, replacing the client-derived code.
5. Redemption endpoint with the full validation chain, atomic via `Orders.version`.
6. Expiry job that closes stale orders (§3.4 item 5) — required before pickup validation can honestly check expiry.
7. Seller-app pending-pickup list and confirm flow; buyer-app pass switched to the server token.

---

## 9. What we need to tackle — Claude's read

My consolidated view at handoff. Everything below appears somewhere above; this is the ranked version with an opinion attached, because the earlier sections record findings without saying which ones matter most.

### 9.1 Three decisions that block code

Nothing in §8 can be built until these are answered. They are cheap to decide and expensive to guess wrong.

| # | Decision | Why it blocks | My recommendation |
|---|---|---|---|
| **D1** | **Prepaid pickup, or pay-at-stall?** (§8.2 Conflict 2) | Determines whether the redemption endpoint *reads* payment state or *writes* it. Every downstream validation rule changes | Pick one and build it alone. Trying to serve both from one endpoint is how the payment status check ends up meaning two different things |
| **D2** | **Parent transaction: grouping record or financial object?** (§8.2 Conflict 1) | Financial means un-deferring Phase 2 and touching settlement code that is 1 day old | **Grouping record.** Delivers the whole QR design with none of the settlement risk, and leaves Phase 2 free to arrive later |
| **D3** | **What does a no-show cost?** (§3.5) | Pickup validation cannot honestly check expiry until the expiry policy exists | **Cap concurrent unpaid reservations per buyer.** No money, no gateway, cheap, and it targets the failure sellers actually feel |

### 9.2 Defects worth fixing regardless of which way D1–D3 go

These are independent of the QR redesign. They are live now.

1. **Checkout session inside the DB transaction** (`order.service.ts:285`) — *highest risk item in the codebase right now.* A PayMongo call inside `prisma.$transaction` holds inventory row locks for the gateway's latency, and a timeout rolls back an order whose session may already exist provider-side. Fix independently of everything else in this document.
2. **Stale orders are never closed** (§3.3) — stock is released while the order stays `PENDING` and redeemable. This is a correctness bug today, not only a pay-at-stall problem, and it is the prerequisite for the expiry check in §8.
3. **The pickup pass is not a credential** (§3.2) — the code is `orderId.substring(0,8)` and the QR is `MAPANYTIME-ORDER-<id>`, both client-derived. Anyone with an order id reproduces a valid-looking pass. Only harmless today because nothing honours it server-side; it stops being harmless the moment §8 ships.
4. **Settlement gated on `COMPLETED`, not payment** (§4.1) — a paid order never marked fulfilled leaves the seller unpaid with no visible reason.
5. **Webhook ordering unguarded** (§4.1) — a late FAILED still releases reservations for a paid order.
6. **`_enqueueSync` swallows every server rejection** (§4.3) — out-of-stock and inactive-product errors fail silently in the app exactly as the store-conflict error used to. The class of bug we just fixed one instance of.

My ordering: **1 and 2 first.** They are live defects with money and stock attached, and neither depends on any decision above.

### 9.3 Corrections owed to the docs

Small, but they are actively misleading whoever reads them next.

- `REQUIREMENTS.md` **ORD-7** marked ✅ against `pickup_pass_page.dart` — that is a UI shell with no backend. Mark it unbuilt.
- `FIX-PLAN.md` **item 16** — board line says done, body checkboxes (F37/F38/F33) unticked. F37 is genuinely done in code.
- The §4.1 order→payment findings are **not in `FLAGS.md`** yet. They should be, or they will be rediscovered.

### 9.4 Not yet started

- **Web is unaudited** (§4.3). `mapanytime-market-web` may still assume one store per cart. The API change is additive so it should not break, but "should not" is doing real work in that sentence. Worth an hour before anyone demos.
- **The six backlog items** (§4.2). Two are scoped (`MerchantAds.startsAt` needs a migration; out-of-stock hiding is a query filter). Four are untouched. **Currency-by-location is the one to be careful with** — `currency` is hardcoded `PHP` on `Orders`, `Payments` and pricing configs, so it is a settlement change wearing a UI change's clothing.

### 9.5 If I picked up this work tomorrow

1. Push `feat/multi-store-cart` in both repos so the work exists off this machine.
2. Fix the checkout-session-in-transaction bug (§9.2 item 1) — self-contained, high value, no decisions needed.
3. Fix stale order closure (§9.2 item 2) — also self-contained, and unblocks §8.
4. Answer D1, then D2, then D3.
5. Only then start the QR build order in §8.3.

Steps 2 and 3 are real progress that needs nobody's input, which is why they come before the decisions rather than after them.
