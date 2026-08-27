# MapAnytime — Open Flags, F39 onward

Triage batch raised **2026-08-24**, worked **2026-08-25** and **2026-08-27**.
Continues the numbering in [`FLAGS.md`](FLAGS.md), which ends at F38. Currently
F39–F93.

F84–F88 come from a sweep of the returns and refund path — the current branch's
own module, and ground neither register had covered.

The range is deliberately not in the filename any more. It was
`OPEN-FLAGS-F39-F62.md`, then `-F72`, and every new finding meant renaming the
file or letting the name contradict the contents — the same drift F57 and F59
record elsewhere. The name is stable now; the header carries the range.

Every finding below was verified against the working tree, not inferred from
naming. Where a flag restates something already written down elsewhere, the
original id is given in parentheses.

> **F39–F42 are decisions, not defects.** They need a call before any MapPoints
> code is written. Everything else is a finding with a known fix.

**This file is tracked as of 2026-08-25.** It was deliberately untracked while
the batch was being agreed, which is the same one-copy-in-one-place state that
lost `FIX-PLAN.md` (F55). Findings raised during a session and never written
down do not survive it.

---

## ✅ Closed 2026-08-27 — the inventory races

| Flag    | Outcome                                                                                                                     |
| :------ | :-------------------------------------------------------------------------------------------------------------------------- |
| **F43** | Stock is no longer handed back twice. Releases claim the reservation rows; a hold already given back releases nothing       |
| **F75** | Reserving is one conditional UPDATE, so the loser of a race for the last unit is refused. `Inventory.version` is live again |
| **F89** | Reservations are linked to their order by id — the old match also attached the buyer's unrelated holds                      |
| **F90** | A successful payment no longer marks the hold CONSUMED while the goods are still on the shelf                               |
| **F91** | _New._ The reservation TTL sweeper exists but nothing calls it — raised, not fixed; it belongs with F44                     |
| **F92** | _New._ No ownership check on the reservation release/confirm endpoints — raised, not fixed                                  |
| **F93** | _New._ Inventory lookups ignore variantId — latent, a precondition on variant-level stock                                   |

New in `src/modules/inventory/inventoryStock.repository.ts`, covered by
`tests/unit/inventoryStock.repository.test.ts` (9 cases). Suite: 517 tests / 51
suites passing, `tsc`, ESLint and Prettier clean.

**One migration is written but not applied:**
`20260827160000_inventory_nonnegative_check` adds `CHECK` constraints so neither
counter can go negative again, clamping existing damage first. It joins the four
already pending — see F84's clawback note, they should go together.

---

## ✅ Closed 2026-08-25

| Flag    | Outcome                                                                                                                        |
| :------ | :----------------------------------------------------------------------------------------------------------------------------- |
| **F45** | Cart clear 404 — app now calls `/cart/clear`; the silent swallow that hid it logs                                              |
| **F46** | Mock payment button dev-gated, and the fake `x-mock-secret` server guard removed                                               |
| **F55** | Recovery closed. `FIX-PLAN.md` is unrecoverable — absent from git, editor local history (239 entries) and the recycle bin      |
| **F57** | `FLAGS.md` header — dangling `FIX-PLAN.md` pointer replaced, all three branch names corrected                                  |
| **F64** | The phantom ₱2.30 (raised and fixed same day, see below)                                                                       |
| **F65** | _Half closed._ The silent per-method rate fallback now warns. The underpricing itself is open — it needs Xendit's rate card    |
| **F68** | `FLAGS.md` test count corrected — 234/31 was stale, it is 379/45                                                               |
| **F70** | The production mock guard tests the adapter in use, not the database record                                                    |
| **F71** | `.env.example` documents `MAPANYTIME_WEB_APP_URL` and the full three-part rule                                                 |
| **F72** | The `process.env.FRONTEND_URL` bridge is gone — both providers read config directly                                            |
| **F73** | Startup and request-time share one return-URL predicate, pinned by tests                                                       |
| **F83** | Checkout no longer offers a gateway backed by the mock adapter                                                                 |
| **F84** | _Half closed._ A refund on an already-paid-out settlement is now loud instead of silent. The clawback ledger needs a migration |
| **F85** | Returns have a window: `RETURN_WINDOW_DAYS`, defaulting to 7 to match the settlement hold                                      |
| **F87** | A refund restocks the goods and winds back `totalSold`, writing the `RETURN` movement the schema always had room for           |
| **F88** | A repeat PATCH of the current status is a retry, not a second refund                                                           |

**F55's fallback is still open:** reconstructing the lost decision log from
`FLAGS.md` and `NEXT-SESSION.md`.

---

## ⛔ Closed, but read them — both were "do this first"

### ~~F70. The production mock guard checks the wrong thing~~ — FIXED 2026-08-25

`payment.service.ts:454` refuses a mock webhook in production by testing the
**database record**:

```js
if (providerRecord.code === 'MOCK' && process.env.NODE_ENV === 'production') {
```

But `getProviderAdapter()` silently returns `MockProvider` whenever a
provider's secret key is missing. With `XENDIT_SECRET_KEY` unset in
production, `providerRecord.code` is `'XENDIT'` — so the guard never fires —
while the adapter actually in use is `MockProvider`, whose `verifyWebhook`
returns `true` unconditionally.

**`POST /webhook/xendit` would accept any payload with any signature and mark
orders paid.** The same applies to `/webhook/paymongo`. The guard predates the
silent-fallback behaviour and was never updated for it.

Fixed by keying the guard on the adapter actually returned:

```js
const adapter = this.getProviderAdapter(providerRecord.code);
if (adapter instanceof MockProvider && process.env.NODE_ENV === 'production') {
```

### ~~F55. `FIX-PLAN.md` is lost~~ — UNRECOVERABLE, closed 2026-08-25

The 2026-08-24 docs consolidation (`0192e8f` → `9f6eea6`, 16:28–16:54) moved the
workspace-root planning docs into `mapanytime-api/docs/specs/`. `FLAGS.md`,
`REQUIREMENTS.md`, `FEATURES_AND_FLOWS.md` and `NEXT-SESSION.md` survived.
`FIX-PLAN.md` did not.

It is not in this folder, not anywhere in the workspace, and never existed in
any git repository — the old root was not a repo. Its distinctive content (the
17-item sequence, "Cart cannot hold two stores", "Engine-room cleanups", the
decision log) greps to nothing across the new docs. Roughly 701 lines,
including every decision settled in the 2026-08-20 session.

**Searched 2026-08-25 and it is gone.** Editor local history holds 239 entries
for this workspace and none reference it; the recycle bin holds 35 items,
several of them deleted docs from this workspace, and it is not among them.
Git never had it. Nothing further to try.

**What remains open** is the fallback: reconstructing the decision log from
`FLAGS.md` and `NEXT-SESSION.md`. Note that its "Cart cannot hold two stores"
item is still true — see the correction under F42.

---

## 🔴 Decisions blocking MapPoints implementation

### ~~F39. The redemption discount has no funding owner~~ — DECIDED 2026-08-25

**Sellers fund discounts; MapAnytime funds vouchers.** A seller promotion is a
`DISCOUNT` row (payer `SELLER`); a MapPoints redemption is a `PLATFORM_SUBSIDY`
row (payer `PLATFORM`, beneficiary `BUYER`). The platform absorbs the full cost
with no seller contribution, so `SellerCampaign` is not needed for phase 1.

Recorded in `FLAGS.md` under _Confirmed business rules_ and _Who funds a
discount, and what commission follows_.

### ~~F40. The commission base under redemption is undefined~~ — FOLLOWS FROM F39

**Commission stays on the pre-voucher subtotal.** Not a separate decision: F4
settled that commission follows what the seller actually received, and under a
platform-funded voucher the seller receives the full amount. The seller's ₱20 on
a ₱1,000 order is unchanged whether or not points were spent.

Recorded in `FLAGS.md` with a worked example.

### F41. `Agents` does not exist in the schema

Section 4 of the spec describes a full peso-denominated commission ledger —
`AgentCommissionAccount`, `AgentCommissionTransaction`, pending/available
balances, a 7-day hold, and bank/GCash payouts with a ₱500 minimum — on top of
an entity that is not in `prisma/schema.prisma`.

Confirmed present: `Buyers`, `Orders`, `OrderCharges`, `Settlements`.
Confirmed missing: `Agents`, `RewardWallet`, `SellerCampaign`, `Promotions`.

This is the largest scope item in the document and it currently reads as
incremental. Decide explicitly whether agents are in or out of phase 1.

### F42. Reward rules for multi-store carts — **not blocking; a precondition for item 17**

**Downgraded 2026-08-25.** The flag originally read "Phase 1 of item 17 shipped,
so a cart can hold items from several stores". That is false, and it was the
only reason F42 blocked anything.

The cart is single-store, verified in code:

- `cart.service.ts:14` — the cart holds one `storeId: string | null`, not a list
- `cart.service.ts:62` — adding a product from a second store is refused while
  the cart is non-empty
- `order.controller.ts:65,82` — checkout reads that one id and creates one order

So there is no multi-store cart for the reward rules to be ambiguous about, and
MapPoints can be built without answering this.

**What to carry forward:** when item 17 does land, "₱100 eligible subtotal =
1 point" and "maximum 20% of the eligible order subtotal" both need a
definition at the **store-order** level, because one checkout will then produce
several of them. Deciding that while the rules are still on paper costs
nothing; deciding it after points are in circulation means a migration. Treat
it as a precondition on item 17 rather than an open question now.

_Verified by reading the code rather than the status board — which is exactly
what F60 says the board cannot be trusted for. This flag was itself an instance
of that._

---

## 🟠 Live code defects, in no F-register

All four are traced in `mapanytime-market-app/docs/PICKUP-NEXT.md` under its own
S-numbering and were re-verified in code on 2026-08-24. None of them appear in
`FLAGS.md`, so anyone reading only the F-register will miss them.

### ~~F43. Inventory can go negative (S4)~~ — FIXED 2026-08-27

`order.service.ts:442`, `order.service.ts:761` and `payment.service.ts:643` all
decrement `quantityReserved` without checking whether the reservation-expiry
sweeper already released it. Reachable in normal use — any pickup later than
`pickupAt + 2h` trips it.

**The fix.** All three sites decremented from the _order's items_, which say
what was bought, not from the _reservation rows_, which say what is still held.
Releases now go through `InventoryStockRepository.releaseOrderReservations`,
which claims the rows still `RESERVED` in a single
`UPDATE ... RETURNING "inventoryId", "quantity"` and decrements only what that
claim returned. The status transition _is_ the claim, so whoever gets there
first — sweeper, cancel, completion, or a retry of any of them — releases the
stock exactly once, and everyone else releases nothing.

The same claim-first rule now covers `consumeReservation`, `releaseReservation`
and the TTL sweeper in `inventoryReservation.repository.ts`, all three of which
read the status and then wrote, with a window in between.

Note the fourth write site F87 added: a refund increments `quantityOnHand`. That
one needed no change — it puts goods back on the shelf and never touches
`quantityReserved`, which is the counter that was going negative.

### F44. Orders stick in `PENDING` forever (S5)

Nothing reconciles an order against the gateway when a webhook never arrives.
The scheduler's non-settlement jobs (`infrastructure/scheduler/index.ts`, daily
cleanup and cache flush) are empty stubs that only log. The buyer is shown
"confirmed" the whole time.

### F45. The app's cart clear call 404s (S6)

`cart_remote_datasource.dart` calls `DELETE /cart`; the API only registers
`DELETE /cart/clear` (`cart.route.ts:10`). Silently swallowed, and harmless
today only because checkout clears the cart by another path.

### F46. "Simulate Mock Payment" ships in the buyer app (S15)

`lib/features/orders/presentation/pages/pickup_pass_page.dart:122` renders a
button that calls the mock-webhook endpoint. The mock _webhook_ is
production-gated; this button is not.

---

## 🟡 MapPoints spec defects

These are internal inconsistencies in the spec, fixable by editing the document.

### F47. `RewardWallet.pendingBalance` is a dead field

Points are awarded only at `ORDERSTATUS.COMPLETED`, and the spec's own §5
sequence writes straight to `balance`. Nothing is ever pending. Only the agent
account legitimately needs a pending/available split.

### F48. Earn-source is stored twice

The `REWARDTRANSACTIONTYPE` enum encodes the source (`PURCHASE`, `REFERRAL`,
`REVIEW`, `STORE_VISIT`, `CAMPAIGN`) and the row _also_ carries `source String?`.
The same fact in two columns can disagree. Keep a single `EARN` type plus
`source`, or keep the source-typed enum and drop the column.

### F49. Concurrency is asserted, never specified

§7 promises "concurrency-safe point deduction" and §8 claims every movement is
"concurrency-locked", but no mechanism is named — `SELECT … FOR UPDATE`, a
conditional decrement, or an optimistic version column. The double-spend race is
the whole reason the rule exists, so the mechanism belongs in the spec.

### F50. `balance` has no non-negative constraint

`balance Int @default(0)` permits a negative wallet. The agreed rule is that it
must never go below zero. Needs a CHECK constraint, not just a service-layer
guard.

### F51. Enum vocabulary diverges, and there is no `REFUND` type

Agreed vocabulary is `EARN` / `SPEND` / `BONUS` / `REFUND` / `EXPIRED` /
`REVERSAL` / `ADJUSTMENT`. The spec ships `REDEMPTION` for spend, `EXPIRATION`
for expiry, and has no `REFUND` at all — refunds ride on `REVERSAL` alone.
Decide whether refund and reversal are genuinely the same event; if they are,
say so in the spec so the omission reads as deliberate.

### F52. Point expiry has no scheduled job

Twelve-month expiry requires a recurring job that writes `EXPIRED` rows. The
scheduler has no such job and its existing non-settlement jobs are stubs — the
same gap as F44, and worth fixing once for both.

### F53. Three competing names

The file is `MAP_POINTS_FEATURE_SPEC.md`, the document body says "Reward Points"
throughout, and the agreed brand is "MapPoints". Pick one user-facing name; the
Prisma models can stay `RewardWallet` / `RewardTransactions`.

Worth recording: the spec contains **zero** occurrences of "coin". The rename
away from a coin/token framing is already done.

### F54. The earn base excludes concepts that no longer exist

Both the spec and the recommendation exclude "taxes" and "shipping" from the
eligible subtotal. The platform collects no VAT (F11, retired 2026-08-20) and
delivery was cut (F36 / item 15). Harmless, but it dates the document.

---

## 🟠 Recovered from the deleted PICKUP-NEXT.md (F56)

Traced in the 2026-08-22 order-flow review, deleted with the file by `2e366bd`,
and re-verified against the tree on 2026-08-25. Every one of these was checked,
not carried over on faith.

### F74. The gateway call sits inside the order transaction (S8)

`order.service.ts:302` calls `provider.createCheckoutSession` inside the
`prisma.$transaction` opened at line 79, and **no timeout override is
configured** — so Prisma's 5s default applies. A slow gateway response rolls
the order back after the checkout session already exists at the provider. If
the buyer then pays, the webhook arrives for an order that was never
committed.

Captured money, no order. The single most expensive failure on this list.

### ~~F75. Stock has no row lock, and `Inventory.version` is dead (S9)~~ — FIXED 2026-08-27

The stock check at `order.service.ts:113,143-148` uses neither a row lock nor a
conditional update. The schema carries an `Inventory.version` optimistic-lock
column and **nothing in `src/` reads or writes it** — confirmed by grep on
2026-08-25. Classic oversell race on the last unit under concurrent checkout.

**The fix.** `InventoryStockRepository.tryReserve` moves the availability test
inside the write:

```sql
UPDATE "Inventory" SET "quantityReserved" = "quantityReserved" + $qty
WHERE "id" = $id AND "quantityOnHand" - "quantityReserved" >= $qty
```

Postgres re-evaluates that `WHERE` against the latest committed row after the
statement blocks on a concurrent writer, so the loser of a race for the last
unit matches no row and is refused — no retry loop, and no reliance on an
isolation level the connection does not actually use. The earlier read is kept
only so the common-case error message can quote a stock count.

This is a row lock rather than the optimistic-lock scheme `version` was added
for, and it is the better fit: an optimistic column needs a retry loop around
every caller to be worth anything. `version` is no longer dead — every stock
write increments it, so it is an honest change counter — but nothing _gates_ on
it. Dropping it stays an option; it is cheap to keep.

### F76. The app never sends `Idempotency-Key` (S10)

`order.controller.ts:13-29` implements Redis-backed idempotency, and the
Flutter app has **zero occurrences** of the header. `dio_smart_retry` retries
timeouts, so a slow-but-successful `POST /orders` duplicates the order. The
server side is already built; only the client half is missing.

### F77. Redis is a single point of failure for ordering (S11)

The cart lives in Redis alone on a 7-day TTL (`cart.service.ts:20,108`), so
order creation cannot proceed while Redis is down.

### F78. The webhook `orderId` path is unverified against a live payload (S12)

`payment.service.ts` extracts the order id from the nested payment object. If a
provider does not propagate `reference_number`/`metadata` down to it, every
real webhook silently no-ops as `ignored_no_order_id` — the failure mode is
silence, which is why it needs a live payload to settle rather than a reading
of the code.

### F79. `GET` handlers create rows (S16)

Both `getMyOrders` and order `create` lazily insert a `buyers` row on read — a
GET with a write side effect, duplicated in two places.

### F80. `PaymentMethod.fromJson` casts an id unguarded (S17)

`json['id'] as String` throws on a null id instead of degrading.

### F81. Dead reservation code implies a flow that was never built (S18)

`lib/features/orders/data/reservation_remote_datasource.dart` and
`reservationControllerProvider` are referenced nowhere else. Confirmed still
present 2026-08-25.

---

## ⚪ Doc and process integrity

### ~~F56. Two disconnected findings registers~~ — RESOLVED BY DELETION 2026-08-25

`FLAGS.md` held F1–F38 and called itself the "single consolidated register",
while `mapanytime-market-app/docs/PICKUP-NEXT.md` held S1–S18 and never named
it back.

That second register no longer exists. Commit `2e366bd`
("docs(guides): standardize Flutter Framework-Structure guide suite") deleted
`docs/PICKUP-NEXT.md` (510 lines) and `toDo/backlog.md` (28 lines) from the app
repo.

**Unlike `FIX-PLAN.md` (F55), both are recoverable** — they were tracked, so
git still has them:

```
git show 2e366bd^:docs/PICKUP-NEXT.md
git show 2e366bd^:toDo/backlog.md
```

The S-findings were swept against the tree on 2026-08-25 and the ones still
open are carried below as F74–F81, so the register is now genuinely single.
`FLAGS.md`'s pointer to PICKUP-NEXT was removed at the same time.

**S-number disposition:**

| S       | Status                                                            |
| :------ | :---------------------------------------------------------------- |
| S1      | FIXED — the datasource unwraps `data.providers`                   |
| S2      | FIXED 2026-08-25 — `paymentMethodId` is forwarded                 |
| S3      | FIXED — cancelling a paid order now refunds through the adapter   |
| S4      | Open → **F43**                                                    |
| S5      | Open → **F44**                                                    |
| S6      | FIXED 2026-08-25 → F45                                            |
| S7      | FIXED — `MockProvider.checkoutUrl` is `null`, not a relative path |
| S8–S12  | Open → **F74–F78**                                                |
| S13     | FIXED — min/max is enforced in `payment.service.ts`               |
| S14     | Open → **F65** (the fallback rate)                                |
| S15     | FIXED 2026-08-25 → F46                                            |
| S16–S18 | Open → **F79–F81**                                                |

### F57. The `FLAGS.md` header is stale

It reads "**Last verified:** 2026-08-20 · **Branches:** `mapanytime-api@main`,
`mapanytime-market-web@main`", and routes readers to `FIX-PLAN.md` for
sequencing — a file that no longer exists (F55). Both branches named are wrong.

### F58. These docs are now behind a CI format gate

The consolidation moved the planning docs into a repo whose CI runs
`prettier . --check`. Any markdown edit here can turn the build red, and has
twice today. Run `npx prettier --write` on anything touched in `docs/`.

### F59. Delivery is still documented as a live feature

`FEATURES_AND_FLOWS.md` still carries Flow 7 "Pickup Pass vs. Delivery Shipping"
with `POST /v1/shipments` calls, a "Shipment Tracking" feature bullet, and
`Orders ||--o{ Shipments` in the ER diagram. `REQUIREMENTS.md` ORD-5 still marks
shipments **✅** against `/v1/shipments` and `SHIPMENTSTATUS`.

Verified deleted from the tree: the `Shipments` model, `shippingAmount`,
`SHIPMENTSTATUS`, and `src/modules/shipments/`.

### F60. Item status contradicts itself across documents

Items 14, 15 and 16 show as done on the status board while their body checkboxes
sit unticked, and `FLAGS.md` F34 still says "this is where tomorrow starts" for
app payment work that has shipped — `paymentMethodsProvider` is wired,
`checkoutUrl` is returned and launched, `url_launcher` is a dependency.

Item 13 is the mirror image: the first two checkboxes claim the web sends no
`sessionId`, but it issues and sends one and the API stores it behind
`@@index([sessionId, occurredAt])`. Only the dedup step is genuinely open.

### ~~F61. PICKUP-NEXT's own open list carries closed items~~ — MOOT 2026-08-25

The file was deleted by `2e366bd` (see F56). Its stale entries went with it, and
its still-open findings are carried as F43, F44 and F74–F81.

### ~~F62. `toDo/backlog.md` is a superseded design~~ — MOOT 2026-08-25

Twelve unticked boxes describing a Google Maps implementation — API key in
`AndroidManifest.xml`, `GMSServices` in `AppDelegate.swift`, `BitmapDescriptor`
markers — against an app that shipped on `mapbox_maps_flutter`. Deleted by
`2e366bd`; recoverable at `git show 2e366bd^:toDo/backlog.md` if the twelve
boxes are ever worth re-reading, which they are not.

**The reference outlived the file:** `REQUIREMENTS.md` MAP-2 still cited it as
"still open work" after it was gone. Corrected 2026-08-25 — see F82.

### ~~F83. Checkout offers providers that cannot take money~~ — FIXED 2026-08-25

`getActivePaymentMethods` filters on exactly one condition:

```js
(provider) => provider.code !== 'MOCK' || process.env.NODE_ENV !== 'production';
```

A provider whose secret key is missing is still offered. `getProviderAdapter`
silently returns `MockProvider` in that case, and `MockProvider` returns
`checkoutUrl: null` — so the buyer picks GCash, an order and a `PENDING`
payment row are created, and **there is no way to pay it.**

The `MOCK` provider row is correctly hidden in production. _PayMongo backed by
the mock_ is not, so this fails identically in production, announced only by a
`console.warn`.

Live today: `PAYMONGO_SECRET_KEY` is unset, so all five PayMongo methods
(GCash, Maya, QR Ph, Card, GrabPay) are dead ends. The only real gateway is
Xendit sandbox.

**Fixed** in `0348787`: `getActivePaymentMethods` now resolves the adapter and
drops any provider that comes back as `MockProvider`, the same way the `MOCK`
row itself is dropped. The warning is emitted once per provider per process
rather than per checkout page load — that endpoint is public and
unauthenticated, so a line per unconfigured provider per load buried the log.

It is product-visible: with `PAYMONGO_SECRET_KEY` unset, all five PayMongo
methods disappear from the picker and only Xendit and Pay on Pickup remain.
That is the honest state of the system, not a regression.

**This also sharpens F65.** With PayMongo not a real account, it is not that
_some_ transactions price off the fallback: the seeded rate card is
"PayMongo Standard Rates v1" for an account that does not exist, and Xendit —
the only usable gateway — has no rates at all. Every real payment the platform
can currently take is priced off a guessed 2.00%.

### ~~F89. Checkout attached the buyer's unrelated reservations to the order~~ — FIXED 2026-08-27

Found while fixing F43. After creating the order, `createOrder` linked
reservations with
`updateMany({ where: { buyerId, orderId: null, status: 'RESERVED' } })` — every
dangling hold that buyer had, not the ones this checkout had just taken. A cart
reservation, or a concurrent checkout at another store, was adopted by whichever
order committed first.

Harmless while releases decremented from the order's own items; actively wrong
once they decrement from the reservation rows, which is what F43's fix does —
the order would hand back stock it never held. `createOrder` now collects the
ids it creates and links exactly those.

### ~~F90. A successful payment ended the hold in name only~~ — FIXED 2026-08-27

Also found while fixing F43. On `payment.succeeded` the webhook flipped the
order's reservations to `CONSUMED` — but never decremented `quantityReserved`.
The rows said the stock was gone while the counter still held it, and the
balancing decrement arrived later, from the order's items at completion.

That is exactly the pairing F43 removed, so the two had to be settled together.
The reservations now stay `RESERVED` through payment: money changing hands moves
no goods, and they sit on the shelf held for that buyer until pickup.
`completeOrder` ends the hold in the same claim that takes the stock down.

That change has a consequence that had to be handled in the same breath. A paid
order's reservations are now visible to the TTL sweeper, which would expire the
hold `pickupAt + 2h` and put goods the buyer has **already paid for** back on
sale — the seller could then sell the same unit twice. The old `CONSUMED` flip
hid those rows from the sweeper by accident, so the protection was real but
undocumented and resting on a bug.

`expireStaleReservations` now says so explicitly: it skips holds whose order is
`PROCESSING` or `READY_FOR_PICKUP`. Cart holds and unpaid orders are still swept;
`CANCELLED`, `FAILED` and `COMPLETED` orders release their own holds, so anything
still `RESERVED` against those is leftovers worth clearing. Pinned by
`tests/unit/inventoryReservation.repository.sweeper.test.ts`.

A late pickup on a paid order therefore keeps its hold, and completion ends it
normally. If a hold _has_ already gone — by any route — completion now releases
nothing rather than driving the counter negative, which is the F43 case.

### F91. The reservation TTL sweeper is never called

`InventoryReservationRepository.expireStaleReservations` is reachable only
through `InventoryReservationService.expireReservations`, and **nothing calls
that** — no route, no controller, no cron. Verified by grep on 2026-08-27.
`infrastructure/scheduler/index.ts` schedules ad windows, settlement maturation
and the MapPoints sweep; there is no reservation job among them.

So reservations never expire on their own today. Stock is held until the order
completes, is cancelled, or its payment fails. An abandoned checkout holds its
units forever.

This belongs with F44 (P1-7, "verify reservation expiration job; remove or
implement empty cron shells") — same job, same scheduler. Two notes for whoever
wires it up:

- The paid-order guard described in F90 is what stops the sweep from reselling
  goods out from under a buyer who has paid. It is already in place; do not
  remove it as a redundant filter.
- It made F43 look unreachable-by-sweeper, but F43 was reachable anyway:
  `POST /inventory/reservations/:id/release` is routed and authenticated, so a
  buyer could release a hold and then cancel the order, which released the same
  stock a second time.

### F92. Any logged-in user can release or consume anyone's reservation

Found while tracing F43's reachability. `inventoryReservation.controller.ts`
never reads `req.user` in either handler:

```ts
static async release(req, res, next) {
  const { id } = req.params;
  const reservation = await InventoryReservationService.releaseReservation(id);
```

`confirm` is the same shape. The service methods take only a reservation id —
there is no `buyerId` parameter to check against. `authenticate` proves somebody
is logged in, nothing more, and reservation ids are the only thing standing
between an attacker and someone else's held stock. Compare `reserve` and
`getActiveReservations` in the same controller, which both resolve
`req.user.id` properly.

Two routed endpoints, both stock-mutating:

- `POST /inventory/reservations/:id/release` — frees another buyer's hold, so
  their goods go back on sale mid-checkout.
- `POST /inventory/reservations/:id/confirm` — worse. It runs
  `consumeReservation`, which decrements real `quantityOnHand`, writes a `SALE`
  movement, and attaches the reservation to **an `orderId` supplied in the
  request body**. An authenticated user can book someone else's held stock as
  sold against an order of their choosing.

Pre-existing, not introduced by the F43 work — but F43's fix routes both
handlers through the new claim primitives, so they are freshly worth reading.
The fix is an ownership check in the service (resolve the buyer from the user
and require `reservation.buyerId` to match), plus a decision on whether
`confirm` should be buyer-callable at all: order completion already consumes
reservations internally, so the endpoint may just want removing.

**Not fixed** — it needs the `confirm`-should-exist call, and an authz change
deserves its own change rather than riding along with an inventory fix.

### F93. Inventory lookups ignore `variantId`

`Inventory` is unique on `[storeId, productId, variantId]`, so one product can
own several stock rows. Three lookups pick one arbitrarily:

- `order.service.ts:131` — `product.inventory[0]` (what checkout reserves against)
- `order.service.ts:471` — `findFirst({ where: { productId } })` (what completion decrements)
- `return.service.ts:422` — the same `findFirst`, for the F87 restock

Nothing guarantees those three resolve to the same row. `store.service.ts:48`
already reads `p.variant?.inventory[0] ?? p.product.inventory[0]`, so the
variant-row shape is anticipated in the codebase.

**Latent today, verified 2026-08-27:** nothing in `src/` creates an `Inventory`
row with a `variantId` — the only mention outside these lookups is
`inventoryReservation.repository.ts:130`, which copies `inv.variantId` onto a
movement record. Product creation writes one variant-less row per product, so
every lookup above resolves to the same single row and the ambiguity cannot
bite yet.

It becomes live the moment variant stock is written, which the varieties work in
PR #68/#69 is heading towards. `OrderItems.variantId` already exists in the
schema and checkout does not populate it (see the "cart items are product-only
today" note on `computeItemDiscount`). Treat this as a precondition on
variant-level stock, not a bug to fix now: whoever writes the first
variant-scoped `Inventory` row has to fix these three lookups in the same
change, or checkout will reserve against one row and completion will decrement
another.

### F82. References outlive the files they point at

Third instance of the same failure in two days: `FLAGS.md` → `FIX-PLAN.md`
(F57), `REQUIREMENTS.md` MAP-2 → `toDo/backlog.md`, and eight separate
citations of `PICKUP-NEXT.md` — six in docs, two in shipped source comments
(`order.service.ts:667`, `profile_page.dart:190,204`).

A deleted doc leaves its citations behind, and a code comment pointing at a
file nobody can open is worse than no comment: it reads as authoritative. The
doc-side references were repointed on 2026-08-25.

Worth a convention: a finding cited from source should name its **id**, which
survives, rather than its **filename**, which does not.

---

## Raised 2026-08-25

### F63. The reward rate contradicts itself by 10×

[`MAP_POINTS_FEATURE_SPEC.md`](MAP_POINTS_FEATURE_SPEC.md) states two
incompatible rates. Line 43 sets the earn rate at `₱100 = 1 point` and
annotates it "~1% reward rate"; line 45 values a point at `₱0.10`. ₱100 spent
earning ₱0.10 of discount is **0.1%**, not 1%. Every other number in the
document — the schema defaults, the `1,250 pts ≈ ₱125` example — agrees with
0.1%. Only the annotation says 1%.

The platform's entire margin is the 2.00% commission, so the cost of the
programme as a share of revenue is `reward rate ÷ 2.00%` — **5% at 0.1%, 50%
at 1%**. F39 settled that MapAnytime funds redemptions (sellers give
discounts, the platform gives vouchers), which puts the whole cost here with
no seller contribution.

~~**Blocks F39–F42 and F47–F54.** Nothing in MapPoints can be built until this
one number is decided.~~

**Settled at 0.1% — in code, not here.** MapPoints shipped while this register
sat idle: `269adf9` (PR #68) and `a66929a` (PR #70) landed
`src/modules/rewards/`, and `reward.service.ts` reads
`DEFAULT_EARN_PERCENTAGE = 0.001` with `DEFAULT_POINT_VALUE_PHP = 0.1` — ₱100
spent earns 1 point worth ₱0.10. That is the 0.1% reading every other number in
the spec agreed with, so the annotation on line 43 of
[`MAP_POINTS_FEATURE_SPEC.md`](MAP_POINTS_FEATURE_SPEC.md) is the one thing left
to correct; it still says "~1%". The rate is admin-editable and versioned
(`RewardConfigurations`), so it is a configuration decision now, not a code one.

**F47–F54 need re-sweeping against that module, not reading as open.** Spot-checked
on 2026-08-27, all against the shipped code: F49's concurrency is a conditional
`updateMany` on the wallet balance and on the voucher status; F51's `REFUND` is
in `REWARDTRANSACTIONTYPE`; F52's expiry job exists as
`RewardService.expireOldPoints` and is wired into
`infrastructure/scheduler/index.ts`; F50's non-negative `CHECK` is in migration
`20260825080357`. The earn hook is live in `OrderService.completeOrder`. The
rest of F47–F54 were not checked — verify each in the tree before acting on what
this register says about them.

### F65. Xendit's GCash and Maya have no contracted rate

`pricing.seeder.ts` seeds no `PricingComponents` row for either Xendit method,
so both fall through to `DEFAULT_PAYMENT_GATEWAY_RATE` (2.00%). PayMongo GCash
charges the buyer its real 2.23%; the same wallet via Xendit charges 2.00%,
and anything Xendit bills above that comes out of the commission.

Unlike the pre-existing gap (`QRPH`, `GRAB_PAY` — rarely chosen), Xendit is
seeded **active at priority 2 with both gateways live**, and the picker offers
"GCash (Xendit)" as an ordinary choice. Mainstream path, not an edge case.

Half fixed: the fallback no longer happens silently. Closing it needs the real
rate card seeded.

**Accepted for now — decided 2026-08-25.** Xendit is sandbox-only, so no real
money is moving and a wrong rate costs nothing today. The warning stays; the
2.00% fallback stays.

**The condition on that decision:** this must be closed _before_ Xendit goes
live, not after. On the first real order the gap becomes silent margin loss on
every transaction — and because PayMongo is not a configured account either
(F83), Xendit is the only gateway that can take money, so it would be **100%**
of real payments, not a subset.

Two ways to close it, in preference order:

1. **Seed the real rates.** Get the contracted GCash/Maya rate card from the
   Xendit account and add the `PricingComponents` rows. This is the only
   actual fix; the rates are commercial terms specific to the account, so
   nobody can derive them from documentation.
2. **Refuse to offer an unrated gateway** — the same shape as F83's fix. A
   method with no `PAYMENT_PROCESSING_FEE` component gets hidden rather than
   quietly billed at 2.00%. Safe by construction, but it hides Xendit entirely
   until (1) is done, leaving only Pay on Pickup, which is why it is not the
   default today.

### F66. `FLAGS.md` understates the unpriced methods

Its text names `QRPH` and `GRAB_PAY` as the exceptions. With Xendit there are
four, two of them mainstream. Correct once F65's rates land.

### F67. The docs describe Xendit as future work

[`MASTER_IMPLEMENTATION_PLAN.md`](MASTER_IMPLEMENTATION_PLAN.md) line 1535
lists "Xendit adapter only if commercially required" as future item 21, and
`ECONOMIC_AND_PAYMENT_SYSTEM_IMPLEMENTATION_SPEC.md` frames it as "PHASE 3".
It shipped on main. Same family as F59/F60.

### F68. `FLAGS.md` reports a stale test count

Line 357 says "234/234 tests across 31 suites". Actual: **358 across 43**.

### F69. The two-provider checkout decision lives only in a seeder comment

Method names are suffixed "(Xendit)" because the web picker shows the provider
as a subtitle and the Flutter picker does not, so the name itself has to carry
it. A real product decision recorded nowhere but `payments.seeder.ts`.

### F71. `.env.example` ships a value that breaks Xendit checkout

It sets `FRONTEND_URL="http://localhost:3000"`. Xendit rejects a return URL
that is not https, that carries **any** port (even `:443`), or whose hostname
is `localhost` — all verified against the live sandbox. Configuring from the
example file therefore produces a checkout that fails on every Xendit order,
with an opaque `400 INVALID_URL / "Please provide a valid HTTPS URL"` that
names only the scheme and hides the real cause.

The variable is now `MAPANYTIME_WEB_APP_URL`, validated at startup by
`assertCheckoutReturnUrl()`. `.env.example` still needs updating — it was
modified on main, so it was left for after the merge.

### ~~F73. Startup and the provider disagreed on a valid return URL~~ — FIXED 2026-08-25

Main's `b8a7852` fixed the same HTTPS problem independently, by forcing the
scheme in `xendit.provider.ts`:

```js
frontendUrl.startsWith('https://') ? frontendUrl : 'https://example.com';
```

That catches `http://` and nothing else. Measured against the sandbox, all of
these begin with `https://`, pass the check untouched, and are still rejected:
`https://localhost`, `https://localhost:3000`, `https://100.124.116.30:4002`,
`https://app.example.test:443`. So the obvious response to the comment above
it — "Xendit requires HTTPS, I'll write `https://localhost:3000`" — sails
through to a 400 that blames the scheme.

Both sides now share one predicate, `checkoutReturnUrlProblems` in
`config.ts`, so the startup check and the request-time fallback cannot drift
apart. Pinned by `tests/unit/checkout-return-url.test.ts`.

**A trap inside the trap:** `new URL('https://host:443').port` is the empty
string, because the URL API normalises a scheme's default port away. Xendit
rejects that URL anyway — it objects to a port being written at all, not to
its value. Reading `URL.port` alone therefore misses precisely the case a
reader is most likely to try. The predicate reads the port as written.

### ~~F72. The `FRONTEND_URL` bridge in `config.ts` is a shim~~ — FIXED 2026-08-25

Closed by the same change: `XenditProvider` now calls
`strictCheckoutReturnUrlBase()` and `PayMongoProvider` reads
`MAPANYTIME_WEB_APP_URL`, both imported from config. Neither touches
`process.env.FRONTEND_URL`, so the write-back shim is gone and the name in
`.env` is the name that reaches the provider regardless of import order.

The original entry, for the record:

### F72 (original). The `FRONTEND_URL` bridge in `config.ts` is a shim

`PayMongoProvider` and `XenditProvider` read `process.env.FRONTEND_URL`
directly, so `config.ts` writes the resolved value back into the environment
for them. That only holds where `config.ts` is imported first — true for the
server, not guaranteed for a worker or a standalone script. Remove it once
both providers take the value from config instead.

---

## Raised 2026-08-25 — returns and refunds

A sweep of `src/modules/returns/`, the module the current branch is named
after. Neither register had touched it. Every payments flag so far has been
about money coming _in_; these are the same questions on the way back out, and
the answers were mostly missing rather than wrong.

The pattern across all five: **the refund path moves money and nothing else.**
Stock, the seller ledger and the retry semantics were all left where the sale
had put them.

### ~~F84. A refund after payout erases the fact that the seller was paid~~ — HALF FIXED 2026-08-25

`markRefundedForOrder` was an unfiltered `updateMany`:

```js
return client.settlements.updateMany({
  where: { orderId },
  data: { status: 'REFUNDED', settledAt: new Date() },
});
```

A settlement already swept into a `COMPLETED` payout has the seller's money in
the seller's account. Flipping that row to `REFUNDED` destroys the only record
that it was ever paid — `payoutItem` still points at the payout, but the status
now reads as though the money never left. Nothing downstream notices, nothing is
logged, and no debt is booked.

The codebase already has the right shape for this debt: a cash sale books a
**negative settlement** for the commission the seller owes, which nets off their
next payout. A clawback is the same idea. It cannot be written that way here,
because `Settlements.orderId` is `@unique` — there is no room for a second,
negative row against the same order. **That is a schema change**, and the
migration is not something to slip in alongside a service fix.

**What was done:** the update is now a targeted `findUnique` + `update` that
first checks for a `payoutItem`, logs at **error** level with the payout number,
status and amount when it finds one, and returns `{ clawbackOwed, payoutNumber }`
so `executeRefund` can repeat it on the refund's own log line. Both sides of the
loss now appear together.

**What is still open:** the clawback itself. A negative settlement, or a seller
debt ledger, needs `Settlements.orderId` relaxed or a separate model. Until then
recovery is manual — but at least it is _visible_, which it was not.

Pinned by three tests in `settlement.service.test.ts`.

### ~~F85. There was no return window~~ — FIXED 2026-08-25

`createReturnRequest` accepted any order in `COMPLETED`, with no reference to how
long ago it completed. A buyer could open a return on a six-month-old order.

This is what made F84 the eventual default rather than an edge case.
`SETTLEMENT_HOLD_DAYS` is 7, and its own doc comment says the hold exists "to
cover the return window" — but there was no window for it to cover, so every
return filed after day 7 hit a settlement that had already been released and
very likely paid.

It was also a documented requirement that had never been built:
`MASTER_IMPLEMENTATION_PLAN.md:489` lists "return window is respected" and :492
adds "the exact return window must be configurable". `NEXT-SESSION.md:35` calls
the hold the thing that "protects platform during return window". Same family as
F59/F60/F67 — the docs describing a feature the tree does not have.

**Fixed:** `RETURN_WINDOW_DAYS` (default 7, env-configurable) is enforced in
`createReturnRequest` against `order.completedAt`. Both halves are now documented
together in `.env.example`, with the rule that
`RETURN_WINDOW_DAYS <= SETTLEMENT_HOLD_DAYS` — they are one setting in two parts,
and drifting them apart re-opens F84 by configuration.

An order that reached `COMPLETED` without a `completedAt` is **refused** (409),
not treated as open. Open-ended is the one answer that cannot be right.

### F86. A refund hands back the gateway fee the gateway keeps

**Not fixed — this is a decision, not a defect.** It needs a call the same way
F39–F42 did.

`refundAmount` is `Number(order.totalAmount)`, and `totalAmount` is
`pricingResult.buyerTotalAmount` — which, under the `BUYER` fee policy that is
every order today, **includes the payment processing fee**. So a full refund
returns the buyer their ₱1,000 plus the ~₱22.30 they paid GCash to move it.

The gateway does not return its fee on a refund. PayMongo and Xendit both keep
it. So:

- the buyer is made whole, including the fee;
- the seller's settlement is marked `REFUNDED`, so they get nothing;
- `paymentFeeAmount` on that settlement is **0**, because under `BUYER` the
  seller never carried the gateway cost;
- which leaves the platform paying the fee, out of a commission it also just
  gave back.

Nothing records this. It is not in the pricing engine, not in the settlement row,
and not in any ledger — the money simply is not there at the end.

Worth putting beside F63's arithmetic: the platform's whole margin is the 2.00%
commission, and the fee it silently absorbs on a refund is ~2.23%. **One refund
costs slightly more than the commission on the same order earned.** A 1% return
rate is roughly a 2% dent in platform revenue.

Three ways to close it, and picking one is the decision:

1. **Refund the goods, keep the fee.** Refund `subtotal - discount` rather than
   `buyerTotalAmount`. Standard practice, and the buyer bears the cost of their
   own return. Product-visible, and it needs to be in the returns policy text
   before it ships.
2. **Absorb it deliberately**, and price it in — treat it as a cost of the
   returns promise and account for it, rather than discovering it in a
   reconciliation. Wants a `PLATFORM`-payer charge row so it is at least visible.
3. **Move the fee to the seller on a return** — a `SELLER`-payer row on refund.
   Defensible where the return is the seller's fault; indefensible where it is
   not, and the system does not record fault.

There is no safe default here, which is why it is not fixed. Note that (1) and
(3) both change what a buyer gets back, so neither is a quiet change.

### ~~F87. A refund never put the goods back on the shelf~~ — FIXED 2026-08-25

`completeOrder` decrements `quantityOnHand`, decrements `quantityReserved` and
increments `products.totalSold` when the seller hands the order over.
`executeRefund` reversed **none** of it. The goods are physically back with the
seller and the system still counts them as sold and gone.

The only way to correct it was the manual admin restock endpoint, which means it
only happened when somebody noticed.

The tell that this was an omission rather than a decision: the schema has carried
`RETURN` in **both** `INVENTORYMOVEMENTTYPE` and `INVENTORYREFERENCETYPE` since
it was written, and no code has ever written one. Same shape as F81 — dead schema
implying a flow that was never built.

**Fixed:** `restockReturnedItems` runs inside the refund transaction and, per
order line, increments `quantityOnHand`, winds `totalSold` back (clamped at zero
— a negative would sort a returned product below one nobody has ever bought) and
writes the `RETURN` movement row.

`quantityReserved` is deliberately **not** touched: the reservation was consumed
at fulfilment, so there is nothing left to release. Incrementing it here would
make the stock permanently unavailable, which is this exact bug in reverse.

A product whose inventory row has since been deleted is skipped with a warning
rather than failing the refund. The money has already left the gateway by that
point; a stock count is the lesser loss.

### ~~F88. The terminal-state guard was bypassed by a same-status call~~ — FIXED 2026-08-25

`updateReturnStatus` put the transition check inside a not-equal guard:

```js
if (returnRequest.status !== status) {
  const allowed = ALLOWED_RETURN_TRANSITIONS[returnRequest.status] ?? [];
  if (!allowed.includes(status)) throw { ... };
}

if (status === RETURNSTATUS.REFUNDED) {
  return this.executeRefund(id);
}
```

So `PATCH {status: 'REFUNDED'}` on a return **already** in `REFUNDED` skipped the
terminal guard entirely — the table says `REFUNDED: []`, but that branch never
ran — and fell straight into `executeRefund` a second time.

**It was not exploitable today**, and that is the interesting part. The only
thing standing between that and a second payout to the buyer was a check two
layers away in `executeRefund`, which rejects a payment already in `REFUNDED`.
That check holds only while refunds are for the full amount: as soon as anything
makes `totalRefunded < payment.amount` the payment lands in `PARTIALLY_REFUNDED`,
which `executeRefund` explicitly accepts, and the second call goes through for
the remaining balance.

Partial refunds are not built yet. F86's option (1) builds them.

The existing test covered `REFUNDED → APPROVED`, which takes the guarded path.
The same-status case had no test.

**Fixed:** a request for the status the return is already in returns the current
record and stops, before any side effect. That is the correct idempotent answer
for a retried PATCH, and it removes the bypass. Two tests pin it — one for the
refund path, one confirming `APPROVED → APPROVED` no longer re-runs
`holdForOrder`.

---

## Suggested order for tomorrow

1. **F63** — the reward rate. One number, and F39–F42 plus F47–F54 all wait on
   it.
2. **F65** — get Xendit's contracted GCash/Maya rates and seed them. Costs
   money every day it is open.
3. **F66** — correct `FLAGS.md` once those rates land.
4. ~~**F43** — inventory can go negative.~~ **Done 2026-08-27**, together with
   F75, F89 and F90; the restock site F87 added needed no change. Its
   `CHECK`-constraint migration is written but unapplied.
5. **F92** — the reservation endpoints have no ownership check. Live, routed,
   and one of the two writes real stock. Small fix; needs a call on whether
   `confirm` should be buyer-callable at all.
6. **F86** — who pays the gateway fee on a refund. A decision, not a fix, and
   it is the last thing in the money path that is silently unaccounted. Cheap
   to decide, and F86 option (1) is also what would build partial refunds,
   which F88's note depends on.
7. **F84's clawback** — the negative-settlement ledger. Needs
   `Settlements.orderId` relaxed, so it goes with the other pending
   migrations rather than on its own.
8. **F44 + F52 + F91** — one scheduler, three problems. F52's half is already
   built and wired (`RewardService.expireOldPoints`); F91 is the reservation
   sweep, which exists but is called by nothing. Build the job once.
9. **F41, F42** — scope calls: agents in or out, and per-store-order semantics.
10. **F47–F51, F53, F54** — spec edits, once F63 and F39–F42 are settled.
11. **F55 fallback, F56, F59, F60, F61, F62, F67, F69** — register and doc
    reconciliation.

`F58` is not a task; it is a standing rule for every item above that edits a
markdown file in this repo.
