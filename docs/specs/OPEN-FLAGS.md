# MapAnytime — Open Flags, F39 onward

Triage batch raised **2026-08-24**, worked **2026-08-25**. Continues the
numbering in [`FLAGS.md`](FLAGS.md), which ends at F38. Currently F39–F83.

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

## ✅ Closed 2026-08-25

| Flag    | Outcome                                                                                                                     |
| :------ | :-------------------------------------------------------------------------------------------------------------------------- |
| **F45** | Cart clear 404 — app now calls `/cart/clear`; the silent swallow that hid it logs                                           |
| **F46** | Mock payment button dev-gated, and the fake `x-mock-secret` server guard removed                                            |
| **F55** | Recovery closed. `FIX-PLAN.md` is unrecoverable — absent from git, editor local history (239 entries) and the recycle bin   |
| **F57** | `FLAGS.md` header — dangling `FIX-PLAN.md` pointer replaced, all three branch names corrected                               |
| **F64** | The phantom ₱2.30 (raised and fixed same day, see below)                                                                    |
| **F65** | _Half closed._ The silent per-method rate fallback now warns. The underpricing itself is open — it needs Xendit's rate card |
| **F68** | `FLAGS.md` test count corrected — 234/31 was stale, it is 379/45                                                            |
| **F70** | The production mock guard tests the adapter in use, not the database record                                                 |
| **F71** | `.env.example` documents `MAPANYTIME_WEB_APP_URL` and the full three-part rule                                              |
| **F72** | The `process.env.FRONTEND_URL` bridge is gone — both providers read config directly                                         |
| **F73** | Startup and request-time share one return-URL predicate, pinned by tests                                                    |

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

### F43. Inventory can go negative (S4)

`order.service.ts:442`, `order.service.ts:761` and `payment.service.ts:643` all
decrement `quantityReserved` without checking whether the reservation-expiry
sweeper already released it. Reachable in normal use — any pickup later than
`pickupAt + 2h` trips it.

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

### F75. Stock has no row lock, and `Inventory.version` is dead (S9)

The stock check at `order.service.ts:113,143-148` uses neither a row lock nor a
conditional update. The schema carries an `Inventory.version` optimistic-lock
column and **nothing in `src/` reads or writes it** — confirmed by grep on
2026-08-25. Classic oversell race on the last unit under concurrent checkout.

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

### F83. Checkout offers providers that cannot take money

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

**Fix:** resolve the adapter inside `getActivePaymentMethods` and drop any
provider that comes back as `MockProvider`, the same way the `MOCK` row itself
is dropped. Product-visible — methods vanish from the picker — so it wants a
deliberate yes rather than being slipped in.

**This also sharpens F65.** With PayMongo not a real account, it is not that
_some_ transactions price off the fallback: the seeded rate card is
"PayMongo Standard Rates v1" for an account that does not exist, and Xendit —
the only usable gateway — has no rates at all. Every real payment the platform
can currently take is priced off a guessed 2.00%.

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

**Blocks F39–F42 and F47–F54.** Nothing in MapPoints can be built until this
one number is decided.

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

## Suggested order for tomorrow

1. **F63** — the reward rate. One number, and F39–F42 plus F47–F54 all wait on
   it.
2. **F65** — get Xendit's contracted GCash/Maya rates and seed them. Costs
   money every day it is open.
3. **F66** — correct `FLAGS.md` once those rates land.
4. **F43** — inventory can go negative. Held on 2026-08-25 because one of its
   three sites is in `payment.service.ts`, which the merge touched; that merge
   is done, so it is unblocked.
5. **F44 + F52** — one scheduler, two problems. Build the job once.
6. **F41, F42** — scope calls: agents in or out, and per-store-order semantics.
7. **F47–F51, F53, F54** — spec edits, once F63 and F39–F42 are settled.
8. **F55 fallback, F56, F59, F60, F61, F62, F67, F69, F72** — register and doc
   reconciliation.

`F58` is not a task; it is a standing rule for every item above that edits a
markdown file in this repo.
