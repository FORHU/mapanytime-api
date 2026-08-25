# MapAnytime — Open Flags

Single consolidated register for the pricing/fee/ledger rework. Supersedes the
scattered per-project findings docs.

> **Findings live here.** Sequencing used to live in `FIX-PLAN.md`, which was
> lost in the 2026-08-24 docs consolidation and is unrecoverable — it survives in
> no git history, no editor local history and no recycle bin. Until a replacement
> exists, sequencing lives in [`NEXT-SESSION.md`](NEXT-SESSION.md). Note that
> The second register — `mapanytime-market-app/docs/PICKUP-NEXT.md`, S-numbered
> — was deleted by `2e366bd`. Its still-open findings were swept and carried
> into [`OPEN-FLAGS.md`](OPEN-FLAGS.md) as F43, F44 and F74–F81, so there is one
> register again. See F56 there for the full S-to-F mapping.

**Last verified:** 2026-08-20. Confirmed business rules and both worked examples
re-verified against `src/modules/pricing/pricing-engine.service.ts` on 2026-08-25.

**Branches:** `mapanytime-api@feat/wishlist-refund-and-role-cleanup`,
`mapanytime-market-web@feat/seller-finance-and-catalog-cleanup`,
`mapanytime-market-app@feat/wishlist-and-notifications`

---

## Confirmed business rules

These are settled. Regression tests in `tests/unit/pricing.engine.financial-rules.test.ts`
enforce them — treat a failure there as a business-rule breach, not a broken test.

| Rule                        | Value                                                                                                                                                                                                                                                                                                                                   |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tax**                     | **None. The platform is a marketplace intermediary and collects no VAT** — decided 2026-08-20, superseding the earlier 12% rule                                                                                                                                                                                                         |
| Marketplace commission      | 2.00% of subtotal, charged to the seller                                                                                                                                                                                                                                                                                                |
| Marketplace commission base | **Subtotal only** — never shipping or payment fees                                                                                                                                                                                                                                                                                      |
| Buyer transaction fee       | **Varies by payment method** — the contracted rate for the method the buyer chose, passed through to the gateway in full. GCash 2.23%, Maya 1.79%, domestic card 3.125% + ₱13.39, cash 0%. The 0.23% "platform handling" slice was retired 2026-08-20 (F32), so the platform keeps none of it: this fee is cost recovery, never revenue |
| Payment fees                | Must come from configured provider rates, not a universal fallback                                                                                                                                                                                                                                                                      |
| Payer policy                | `BUYER` / `SELLER` / `PLATFORM`, resolved server-side; checkout must never override it                                                                                                                                                                                                                                                  |
| Discounts vs vouchers       | **Sellers fund discounts; MapAnytime funds vouchers.** A seller promotion is a `DISCOUNT` row (payer `SELLER`) and reduces the commission base. A MapPoints redemption is a `PLATFORM_SUBSIDY` row (payer `PLATFORM`) and does **not** — decided 2026-08-25                                                                             |
| MapPoints earn rate         | **₱100 spent = 1 point, a point is worth ₱0.10** — 0.1%, costing 5% of commission. Admin-editable at runtime; raising it is a config change (F63)                                                                                                                                                                                       |

### Who funds a discount, and what commission follows

Two things reduce what a buyer pays, and they are not the same event.

A **seller discount** is the seller's own promotion. F4 settled that commission
follows the discounted subtotal, and gave the reason: _"a seller funding a
promotion no longer pays commission on money nobody handed them."_

A **MapPoints voucher** is funded by the platform. The seller is handed the full
amount — MapAnytime makes up the difference — so that same reason points the
other way: **commission stays on the pre-voucher subtotal.** This is not an
exception to F4, it is F4's principle applied. The rule underneath both is
_commission on what the seller actually received._

Worked example — ₱1,000 order, buyer redeems a ₱50 voucher, GCash:

```
Goods                      ₱1,000.00
MapAnytime voucher           -₱50.00   PLATFORM_SUBSIDY, payer PLATFORM
Buyer transaction fee         ₱21.19   2.23% of ₱950
BUYER PAYS                   ₱971.19

Marketplace commission        ₱20.00   2.00% of ₱1,000, unreduced
SELLER RECEIVES              ₱980.00   full, as if no voucher existed

Platform: +₱20.00 commission −₱50.00 voucher
PLATFORM NET                 -₱30.00
```

Per order that looks alarming; it is the wrong frame. The buyer had to earn the
₱50 first, which at 0.1% took ₱50,000 of spend and generated ₱1,000 of
commission. **Lifetime cost = earn rate ÷ commission rate**, so 5% of margin at
0.1% and 50% at 1%. That ratio, not the single-order view, is what makes the
rate the decision that matters.

`ORDERCHARGETYPE` already carries `PLATFORM_SUBSIDY`, `SELLER_SUBSIDY`,
`PROMOTION` and `CAMPAIGN`, and `PROMOTION_FUNDING { SELLER, PLATFORM, SHARED }`
exists. None are read by `src/` yet — the vocabulary is there, the wiring is
not, so no migration is needed to book a redemption correctly.

### Why no tax

MapAnytime earns commission on a sale it facilitates; it never takes title to
the seller's goods. Output VAT on those goods is the seller's own liability
against their own BIR registration, so the platform neither charges it to the
buyer nor holds it for remittance. Listed prices are seller-set and treated as
tax-inclusive.

This reverses F11, which recorded VAT dropping to 0 as a _defect_. It was a
defect then — the code had lost a rule nobody had retired. It is the rule now.
A `TAX` charge row appearing on an order is a regression.

### Worked example — ₱1,000 order, paid by GCash

```
Goods                     ₱1,000.00
Buyer transaction fee        ₱22.30   GCash 2.23% — the gateway's own rate
                          ─────────
BUYER PAYS                ₱1,022.30

Marketplace commission       ₱20.00   2.00% of subtotal, charged to the seller
SELLER RECEIVES             ₱980.00

Platform gross               ₱42.30   commission + buyer fee
Gateway pass-through        -₱22.30   all of it, to whichever provider ran it
PLATFORM NET                 ₱20.00   the commission alone
```

**The buyer fee depends on the payment method; the platform's margin does not.**
Swap the method and only the buyer's line moves — Maya 1.79% → ₱17.90, domestic
card 3.125% + ₱13.39 → ₱44.64, cash 0% → ₱0.00 — and every peso of it is
remitted to the provider that processed it. MapAnytime's ₱20.00 comes from the
**seller's** commission, which is the same on every method, every provider and
every basket size.

The platform is **not tied to one payment provider.** `PaymentProviders` is a
table, not a constant: `PAYMONGO`, `MOCK` and `CASH` are seeded today, each with
its own `PaymentMethods` and its own rates in `PricingComponents`. A cash order
never touches PayMongo at all. Rates are seeded per method, not guessed (F2) —
`QRPH` and `GRAB_PAY` are the exception and still price off a 2.00% fallback,
which is the one place a new provider can silently undercharge.

---

## 🔴 Blocking — needs a decision before work continues

### ~~F1. Migration destroys payment-fee history~~ — FIXED 2026-08-19

`20260819054809_ads_payment_promotio_order_sync` dropped `Orders.paymentFeeAmount`
in the same statement that added its replacement, destroying the fee history on
every existing order.

The statement is now split: add the new columns, copy
`paymentFeeAmount` into `paymentProviderFeeAmount`, then drop. Staging and
production keep their history when they deploy. The migration's warning header
was rewritten to match. Local was re-recorded with `prisma migrate resolve`
after the edit, and `migrate diff` confirms no drift.

### ~~F2. No real payment-provider rates~~ — FIXED 2026-08-20

The contracted PayMongo rates are now seeded as an `ACTIVE`
`PricingConfigurations` row by `prisma/seeders/pricing.seeder.ts`: GCash 2.23%,
Maya 1.79%, domestic card 3.125% + ₱13.39, plus the 2% commission. Verified
against the engine reading live config — the platform nets exactly its
commission on every method at every basket size.

**Still open:** `QRPH` and `GRAB_PAY` have no contracted rate on file and price
off the 2.00% fallback, which will undercharge if their real rate is higher.
The engine now logs a warning once per process when no configuration matches,
so this state is no longer silent.

International cards are out of scope (Philippines only), but PayMongo rates on
**card issuance**, not merchant location — a foreign-issued card presented at a
stall bills 4.02% while we charge the domestic 3.125%, absorbing ~₱9 per ₱1,000.
Rare, and accepted knowingly.

### ~~F3. `PaymentFeeRules` vs `PricingComponents` overlap~~ — FIXED 2026-08-19

`PaymentFeeRules` duplicated what `PricingComponents` models, and nothing read
it. Removed: the model and the `FEECALCULATIONTYPE` enum from the schema, both
`feeRules` back-relations, `PricingRepository.getPaymentFeeRules`, and the
`CREATE TABLE` from the migration — it had only ever been applied locally, so
staging never creates a table that would be dropped again. Provider rates now
have exactly one home: `PricingComponents` (see F2).

### ~~F4. Commission treatment of discounts is unverified~~ — RESOLVED 2026-08-20

**Settled: commission now follows the **discounted** subtotal (`subtotal - discount`). A seller funding a promotion no longer pays commission on money nobody handed them. Pinned by `tests/unit/pricing.engine.financial-rules.test.ts`.**

The engine charges commission on the **gross, pre-discount** subtotal, preserved
from `TaxationService`. That means a seller funding a 20% discount pays
commission on money they never received. Preserved deliberately rather than
changed — but it needs checking against the actual seller agreement.

### ~~F5. Staging deploy cannot be run from this machine~~ — RESOLVED 2026-08-20

**Mitigated: `scripts/check-db-target.ts` prints the database any command is about to write to, and `db:setup` / `db:seed` refuse a non-local host outright.**

`DATABASE_URL` in `.env` points at `localhost`; the staging RDS URL sits
commented out on line 6. This is a property of the machine, not the checkout,
and this repo has had it pointing at both on the same day. `migrate deploy` from
here would hit localhost.

---

## 🟠 Correctness — fixed, but worth knowing

| #   | Was                                                                                                                                                                                                                                                 | Now                                                                                                                                                                  |
| :-- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F6  | `prisma validate` failed outright: `FEECALCULATIONTYPE` referenced but never defined, plus 3 relations on `PricingComponents` with no opposite field                                                                                                | Valid                                                                                                                                                                |
| F7  | `tsc` passed only against a **stale generated client** still holding `CommissionRules` and no `OrderCharges` — a meaningless green                                                                                                                  | Client regenerated; genuinely clean                                                                                                                                  |
| F8  | `CommissionRules` deleted from the schema while `taxation.repository.ts` and two seeders still called it                                                                                                                                            | Restored                                                                                                                                                             |
| F9  | `beneficiary: 'BUYER'` written to `OrderCharges` — the enum had no such value, so **every discounted order would throw**                                                                                                                            | `BUYER` added to `CHARGEBENEFICIARY`                                                                                                                                 |
| F10 | Four `@@unique` constraints dropped (`CartItems`, `WishlistItems`, `ProductReviews`, `MerchantAdProducts`) while the changelog called constraints "hardened"; the seeder was rewritten around the missing one                                       | Restored — the live DB still had all four                                                                                                                            |
| F11 | VAT silently became 0 on every order when `TaxationService` left the checkout path                                                                                                                                                                  | 12% restored — then **retired 2026-08-20**: no VAT is charged at all, by decision. See _Confirmed business rules_                                                    |
| F12 | Commission charged on subtotal − discount + shipping + tax; settlement credited the seller the VAT                                                                                                                                                  | Commission on subtotal; tax term since removed entirely                                                                                                              |
| F13 | Public `POST /merchant-ads/:id/events` accepted a client-supplied `revenueAmount` feeding `attributedRevenue` and ROAS                                                                                                                              | Derived server-side from a `COMPLETED` order on the ad's own store                                                                                                   |
| F14 | Socket CORS reflected every origin with `credentials: true`                                                                                                                                                                                         | Allowlist via `CORS_ORIGIN`, open only when unset                                                                                                                    |
| F15 | `server.listen` lost its explicit `'0.0.0.0'` in a containerised service                                                                                                                                                                            | Restored                                                                                                                                                             |
| F16 | `DELETE /merchant-ads/:id` silently deactivated while answering "deleted successfully", leaving its test failing                                                                                                                                    | 409 restored                                                                                                                                                         |
| F17 | `storeSlug` on nearby deals was always `""`, plus a dead `ad.store?.storeName` fallback                                                                                                                                                             | Slug selected in the ads query                                                                                                                                       |
| F26 | The API's `.dockerignore` did not exclude docs, so `COPY . .` pulled `docs/` and every README into the build context and invalidated the layer cache on any doc edit. The web project already excluded them                                         | `*.md` and `docs` excluded; the two projects now match                                                                                                               |
| F27 | `Dockerfile` declared `EXPOSE 3002` while the app listens on `PORT=4002`, and the README plus three onboarding guides told developers to curl `localhost:3002` — every one of those commands fails                                                  | 14 occurrences corrected to 4002 across the Dockerfile, README and guides                                                                                            |
| F25 | `SellerLayout` (in the `shared/` kernel) imported `StoreSelectorDropdown` from `features/`, breaking the repo's own enforced boundary rule — a lint error that would fail CI                                                                        | Taken as a `storeSelector` slot prop, composed in `SellerAuthGate`, matching the pattern the file already documents for `stores`                                     |
| F29 | `SHARED` payer policy charged the buyer half the gateway cost and left `sellerPaymentDeduction` unassigned, so the **platform** absorbed the other half — "buyer half / platform half"                                                              | Seller's half assigned; between them the two halves cover the gateway and the platform nets exactly its commission                                                   |
| F30 | The gateway fee was computed on the order amount, but PayMongo bills on the **captured** total — order + fee. Every pass-through order left the platform short by `fee × rate` (₱0.50 per ₱1,000 GCash)                                             | Grossed up by `(amount × rate + fixed) / (1 - rate × buyerShare)`; the share term keeps `SELLER`/`PLATFORM` ungrossed, since nothing is added to what the buyer pays |
| F31 | Cash was zero-rated by comparing `paymentMethodCode` to `'CASH'`, but the seeded cash **method** code is `COD` (`'CASH'` is the _provider_). The check never fired, so every pay-at-the-stall buyer was charged ~2.23% for a gateway that never ran | Matched on `PAYMENTMETHODTYPE.CASH`, with the legacy `COD` / `CASH_ON_DELIVERY` spellings as fallback                                                                |
| F32 | `DEFAULT_BUYER_PLATFORM_RATE` of 0.23% was booked as platform margin, but 2.00% + 0.23% is exactly GCash's 2.23% — the single rate had been split into a fictional cost-plus-margin, so the platform counted revenue it had already remitted        | Set to 0. Platform revenue is the commission alone                                                                                                                   |

---

## 🟡 Open work

### ~~F18. Buyer deals carousel shows invented data on a live page~~ — RESOLVED 2026-08-20

**STALE — not reproducible. `PromotionsNearYouCarousel`, `FloatingMapDealCard` and "Baguio Craft Coffee" do not exist anywhere in `-web`. Closed after a full-repo search.**

`PromotionsNearYouCarousel` and `FloatingMapDealCard` each declare an optional
`deals` prop with a hardcoded fallback (invented stores such as "Baguio Craft
Coffee"). `src/app/buyer/page.tsx` mounts both **without passing `deals`**.

`GET /merchant-ads/nearby` exists and works. No web client calls it. The
endpoint and the UI were both built; the wire between them never was.

> The seller dashboard cards are **not** affected — they take props from
> `useStoreOverviewStats` and show real data.

### ~~F19. No buyer-facing checkout UI~~ — RESOLVED 2026-08-20

**Built: `-web` gained `features/cart`, `features/checkout`, a `/checkout` page and an `AddToCartButton` on the store page. `PriceBreakdown` shows the goods total until a method is picked, then that method's fee and the real charge.**

Only `src/app/seller/checkout` exists. With VAT retired the transparency stake
is lower, but the buyer still has no web screen itemising the ₱22.30
transaction fee that takes a ₱1,000 basket to ₱1,022.30. The Flutter app's
`price_breakdown_card.dart` does itemise it; the web has no equivalent.

### ~~F20. Payer policy is not configurable~~ — RESOLVED 2026-08-20

**Built: `PricingConfigurations.paymentFeePayerPolicy` column, read by the engine and settable through the admin endpoints. Migration `20260820130000_pricing_payer_policy`.**

`paymentFeePayerPolicy` is an engine input, but nothing in checkout passes it, so
every real order prices as `BUYER`. Making it configurable needs a column on
`PricingConfigurations`, which has no such field — a second migration, held
until F1 lands.

### ~~F21. Admin pricing is read-only~~ — RESOLVED 2026-08-20

**Built: create / update / component CRUD / validate / activate / archive, all admin-gated. Activation refuses an invalid configuration and archives the incumbent in one transaction.**

`POST /pricing/configurations` exists; no update endpoint does. "Save & Sync"
and "Add Component" are deliberately disabled rather than faked. Needs
create / update / validate / activate, and must refuse to activate an invalid
configuration.

### ~~F22. HTTP CORS still reflects every origin~~ — RESOLVED 2026-08-20

**Fixed: HTTP now uses the same `CORS_ORIGIN` allowlist the socket got in F14, and the API refuses to boot in production with it unset.**

`src/app.ts` carries the same flaw fixed on the socket. Pre-existing, and to be
handled as a separate security cleanup rather than mixed into the financial work.

### ~~F23. Test suite instability~~ — FIXED 2026-08-19

Diagnosed properly rather than papered over. Jest defaulted to 11 workers on a
12-core machine, each running ts-jest across the app's whole import graph
including the multi-megabyte generated Prisma client. The contention pushed
integration suites from ~7s in isolation to minutes, and a suite blew even a
20s budget while the full run took 470s.

`maxWorkers: '50%'` in `jest.config.ts` fixes it: **470s to ~10s**, stable
across three consecutive runs. Type-checking stays on — `tsconfig` excludes
`tests/`, so ts-jest is the only thing checking test files.

The earlier note blaming database/Redis/Rabbit cold start was wrong; those are
mocked in the integration suites. Corrected in place.

### F28. Cart preview and checkout still run different engines

`CartService.previewPricing` prices through `TaxationService.calculateOrderFinancials`;
`OrderService.createOrder` prices through `PricingEngineService`, which adds
`buyerTransactionFee` on top. The preview never includes that fee, so on a
₱1,000 basket the buyer is shown **₱1,000.00 and charged ₱1,022.30**.

Retiring VAT narrowed this — it was ₱1,120.00 against ₱1,144.98 — but the
structural mismatch is untouched, and the docstring above `previewPricing`
still claims it uses "the exact same logic `OrderService.createOrder` uses so
what's shown before checkout never drifts."

Fix is to route the preview through `PricingEngineService` and return the fee
breakdown, which also retires the second engine. Blocks CART-2 and F19: there
is no point building a buyer checkout screen on a number that is wrong.

### ~~F33. `MOCK_SANDBOX` is seeded active and offered at checkout~~ — RESOLVED 2026-08-20

**Fixed on both layers: filtered out of `getActivePaymentMethods` in production, and seeded inactive there too.**

`payments.seeder.ts` creates the Mock provider with `isActive: true`, so
`GET /payments/methods` returns "Sandbox Simulator" as a selectable option
alongside GCash and Maya. `MockProvider` accepts any webhook signature, so in
production this is a payment method that marks orders paid for free.

The mock _webhook route_ is correctly gated behind `NODE_ENV !== 'production'`
(F-note in `payment.route.ts`), but the _method_ is not. Gate the seeder on
environment, or set `isActive: false` for it outside development.

### F34. The mobile app has no payment path at all — PARTLY ADDRESSED 2026-08-20

**Resolved so far:** the phantom `/payments/qr-payload` is deleted from both
`payments.swagger.yaml` and the app's `ApiEndpoints`, replaced by constants for
the two endpoints that are real (`paymentMethods`, `orderPayment`).
`PaymentMethod` (`lib/features/payments/domain/entities/`) is written.

**Still open — this is where tomorrow starts.** The Flutter checkout still
hardcodes two payment methods:

```dart
const _paymentMethods = <(String, IconData, String)>[
  ('Payment on pickup', Icons.payments_rounded, 'CASH_ON_DELIVERY'),
  ('GCash', Icons.account_balance_wallet_rounded, 'GCASH'),
];
```

It never calls `GET /payments/methods?amount=`, so it shows no fee, cannot know
a method is unavailable for the basket, and `OrderRemoteDataSource.createOrder`
returns only the order id — **discarding the `checkoutUrl`**, which is the thing
the buyer needs to actually pay.

Three separate gaps that add up to a client that cannot take money:

- ~~`GET /v1/payments/qr-payload/{orderId}` is documented and declared but has no
  route, controller or service.~~ Deleted from both ends.
- ~~Both of the app's payment endpoint constants are declared and never
  referenced.~~ Replaced with the real ones.
- `POST /orders/:orderId/payment` is real, mounted and **still unused**.

The pickup pass QR is not a payment QR: it encodes the literal string
`MAPANYTIME-ORDER-{orderId}` for the seller to identify the order.

### ~~F35. The 15-minute stock hold assumes checkout, not pickup~~ — RESOLVED 2026-08-20

**Fixed: reservations now expire at `pickupAt` + 2 hours grace, floored at the old 15 minutes. See `resolveReservationExpiry` in `order.service.ts`.**

`InventoryReservations.expiresAt` is set 15 minutes out, which fits "reserve and
pay immediately". The confirmed model is reserve online, pay at the stall — where
pickup may be hours or days later, so every reservation expires long before the
buyer arrives and the sweep releases stock they still intend to buy.

Pickup orders need their own hold rule, or the hold must survive until the
pickup window closes.

### ~~F36. A delivery business is modelled but not run~~ — RESOLVED 2026-08-20

**Cut: `Shipments` model and module, `SHIPMENTSTATUS`, `FULLFILLMENTTYPE.DELIVERY`, `ORDERCHARGETYPE.SHIPPING`, `CHARGEBENEFICIARY.COURIER`, `ADDRESSTYPE.SHIPPING` and `shippingAmount` are gone. Migration `20260820150000_cut_delivery`.**

Fulfillment is pickup-only, yet the codebase carries: the `Shipments` model
(courier, tracking number, label URL, shipped/delivered timestamps), the whole
`src/modules/shipments/` module, `SHIPMENTSTATUS`, `FULLFILLMENTTYPE.DELIVERY`,
`shippingAmount` threaded through the pricing engine and the charge ledger,
`BuyerAddresses` with a `SHIPPING` type, and Flow 7 in `FEATURES_AND_FLOWS.md`.

Nothing computes a shipping fee anywhere, so a delivery order would ship free if
the path were reachable. Build it or cut it — leaving it is dead weight every
future change has to keep compiling.

### ~~F37. `GET /payments/methods?amount=` is N+1~~ — RESOLVED 2026-08-20

**Fixed: the engine reads its configuration and all components in one query and matches them in memory. `calculateManyOrderPricing` prices every method off a single read (~15 queries → 2).**

Introduced 2026-08-20 with the per-method quoting. `describeMethod` calls
`PricingEngineService.calculateOrderPricing` once per method, and each call
re-reads `PricingConfigurations` and `PricingComponents` — so a seven-method
response issues roughly fifteen queries on a public, unauthenticated endpoint.

Correct, but wasteful and trivially abusable. Resolve the active configuration
and its components once, then price each method against the in-memory set.

### ~~F38. Jest reports a worker that will not exit~~ — RESOLVED 2026-08-20

**Fixed: the RabbitMQ reconnect `setTimeout` is now held, `unref`'d and cleared on shutdown. It was keeping the event loop alive for up to 30s after a reconnect was scheduled.**

`A worker process has failed to exit gracefully` appears on full runs. It began
after `a8a9c9c` (store banner uploads / nearby-deals discount fields), so
something in that change leaks a handle or an unref'd timer. All 242 tests pass,
so this is a teardown leak rather than a failure — but it is the same class of
problem as F23 and will eventually cost run time in CI.

### F24. Reconciliation is only half done — PARTLY ADDRESSED 2026-08-20

`OrderCharges` is proven to reconcile against `Orders.totalAmount` by test.
**Seller settlement is now built and covered** (`tests/unit/settlement.service.test.ts`)
— the ledger arithmetic, the hold, the cash debit and the paid-out guard.

Still unverified end to end: payment reconciliation against the provider's own
statement, and admin financial reporting. Both are now meaningful, since F2
landed and orders price off real rates.

---

## Verified green (2026-08-20)

API `tsc` · API ESLint (`src` + `prisma`) · `flutter analyze lib` (no issues) ·
**392/392 tests across 45 suites** (~27s, re-counted 2026-08-25 after the
returns sweep — F84/F85/F87/F88 brought 26 of them)

Re-verified after the VAT retirement. Web `tsc` / ESLint / `next build` and
`prisma validate` were last confirmed 2026-08-19 and are untouched by that
change.

---

## Worked example — ₱1,000 order, GCash, BUYER policy

GCash's contracted rate, read from the seeded `PricingConfigurations` row (F2).
Verified against `PricingEngineService.calculateOrderPricing` on 2026-08-20.

```text
Subtotal                        ₱1,000.00
Order amount                    ₱1,000.00   <- no tax term
  Gateway cost      2.23%          ₱22.30   -> the provider (here PayMongo)
  Platform margin   0.00%           ₱0.00   -> retired by F32
Buyer transaction fee   2.23%       ₱22.30
BUYER PAYS                      ₱1,022.30

Commission 2.00% of subtotal       ₱20.00
SELLER NET                        ₱980.00
PLATFORM NET                       ₱20.00   <- from the seller, not the buyer
```

The buyer's fee is the gateway's cost passed straight through, so it tracks the
payment method and nets the platform nothing. Two consequences worth holding on
to: the fee is a _rate on the order amount_, so retiring VAT shrank it — it fell
from ₱24.98 to ₱22.30 when the base fell from ₱1,120 to ₱1,000 — and changing
payment provider changes what the buyer pays without touching what MapAnytime
earns.

---

## Appendix — architecture reference

Carried over from the retired `SYSTEM_CHANGELOG.md`. This is reference
material, not open work; the flags above are the actionable part.

### A1. Separation of feature domains

Transactions and revenue streams are divided into three non-overlapping domains:

```
                            MAPANYTIME DOMAINS
                                     │
     ┌───────────────────────────────┼───────────────────────────────┐
     ▼                               ▼                               ▼
1. PRICING DOMAIN             2. PROMOTION DOMAIN             3. ADVERTISING DOMAIN
• Marketplace Commission       • % Discounts (20% OFF)        • Daily Boost (₱100-₱500)
• Buyer Platform Fee           • Buy One Get One (BOGO)       • Promoted Map Pin
• Gateway Processing Costs     • Flash Sales & Vouchers       • Clicks, Orders, ROAS
• Payer Policies               • Seller/Platform Subsidies    • Marketing Wallet
```

### A2. Promotion funding model

Every promotion record explicitly declares its financial funding source:

```prisma
enum PROMOTION_FUNDING {
  SELLER       // Seller absorbs the entire discount
  PLATFORM     // Platform subsidizes the discount (seller receives full price)
  SHARED       // Configured percentage split between seller and platform
}
```

### Discount Execution Pipeline

1. Base product price
2. Product / Variant discount
3. Merchant store promotion
4. Platform campaign voucher
5. Shipping subsidy
6. Buyer transaction fee calculation
7. Final buyer checkout total

### A3. Itemized financial ledger (`OrderCharges`)

Every transaction writes an immutable, auditable set of financial charges directly to `OrderCharges`:

```prisma
model OrderCharges {
  id          String            @id @default(cuid())
  orderId     String

  type        ORDERCHARGETYPE
  source      String?           // e.g. "PayMongo Gateway", "Standard 2.0% Commission"
  description String?

  rate        Decimal?          @db.Decimal(8, 5)
  amount      Decimal           @db.Decimal(12, 2)

  payer       CHARGEPAYER       // BUYER | SELLER | PLATFORM
  beneficiary CHARGEBENEFICIARY // BUYER | SELLER | PLATFORM | PAYMENT_PROVIDER | COURIER | GOVERNMENT

  createdAt   DateTime          @default(now())

  order       Orders            @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId])
  @@index([type])
  @@index([payer])
  @@index([beneficiary])
}
```

### Typical Ledger Entry for ₱1,000 Order, paid by GCash

| Charge Type              | Amount             | Payer      | Beneficiary        | Source                            |
| :----------------------- | :----------------- | :--------- | :----------------- | :-------------------------------- |
| `PRODUCT`                | $\text{₱}1,000.00$ | `BUYER`    | `SELLER`           | Cart Items Subtotal               |
| `BUYER_TRANSACTION_FEE`  | $\text{₱}22.30$    | `BUYER`    | `PLATFORM`         | GCash rate ($2.23\%$), per method |
| `SELLER_MARKETPLACE_FEE` | $\text{₱}20.00$    | `SELLER`   | `PLATFORM`         | Marketplace Commission ($2.00\%$) |
| `PAYMENT_PROCESSING_FEE` | $\text{₱}22.30$    | `PLATFORM` | `PAYMENT_PROVIDER` | Gateway cost, per provider        |

The first and last rows move with the payment method the buyer picked — and so
with the provider behind it — but the two always cancel, because the buyer fee
exists only to recover the gateway cost.
`SELLER_MARKETPLACE_FEE` is the platform's whole revenue on the order and is
identical on every method. A `DISCOUNT` row (`payer: SELLER`,
`beneficiary: BUYER`) is written whenever the order carries one, and a
`SHIPPING` row when non-zero. No `TAX` row is ever written — the `TAX` member
and the `GOVERNMENT` beneficiary remain in the enums only so historical orders
stay readable.

### A4. Schema reference

#### Versioned pricing configurations & components

```prisma
enum PRICINGSTATUS {
  DRAFT
  ACTIVE
  SCHEDULED
  EXPIRED
  ARCHIVED
}

enum PRICINGCOMPONENTTYPE {
  BUYER_TRANSACTION_FEE
  SELLER_MARKETPLACE_FEE
  PAYMENT_PROCESSING_FEE
  FIXED_TRANSACTION_FEE
  WITHDRAWAL_FEE
  ADVERTISING_FEE
}

model PricingConfigurations {
  id             String        @id @default(cuid())
  name           String
  description    String?
  status         PRICINGSTATUS @default(DRAFT)
  currency       String        @default("PHP")

  effectiveFrom  DateTime      @default(now())
  effectiveUntil DateTime?
  priority       Int           @default(0)

  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  components     PricingComponents[]

  @@index([status])
  @@index([effectiveFrom, effectiveUntil])
}

model PricingComponents {
  id              String                 @id @default(cuid())
  pricingId       String

  type            PRICINGCOMPONENTTYPE
  calculationType PRICINGCALCULATIONTYPE @default(PERCENTAGE)

  ratePercentage  Decimal?               @db.Decimal(7, 5)
  fixedAmount     Decimal?               @db.Decimal(12, 2)
  minFee          Decimal?               @db.Decimal(12, 2)
  maxFee          Decimal?               @db.Decimal(12, 2)

  providerId      String?
  paymentMethodId String?
  sellerPlan      String?
  categoryId      String?
  storeId         String?

  priority        Int                    @default(0)
  isActive        Boolean                @default(true)

  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @updatedAt

  pricing         PricingConfigurations  @relation(fields: [pricingId], references: [id], onDelete: Cascade)
  provider        PaymentProviders?      @relation(fields: [providerId], references: [id])
  paymentMethod   PaymentMethods?        @relation(fields: [paymentMethodId], references: [id])
  category        Categories?            @relation(fields: [categoryId], references: [id])

  @@index([pricingId])
  @@index([type, isActive, priority])
  @@index([providerId])
  @@index([paymentMethodId])
  @@index([categoryId])
  @@index([storeId])
}
```

#### Immutable fee snapshots on `Orders`

```prisma
model Orders {
  sellerMarketplaceFeeRate   Decimal          @default(0.0200) @db.Decimal(8, 5)
  sellerMarketplaceFeeAmount Decimal          @default(0) @db.Decimal(12, 2)

  paymentProviderFeeRate     Decimal?         @db.Decimal(8, 5)
  paymentProviderFixedFee    Decimal?         @db.Decimal(12, 2)
  paymentProviderFeeAmount   Decimal          @default(0) @db.Decimal(12, 2)

  buyerTransactionFeeRate    Decimal?         @db.Decimal(8, 5)
  buyerTransactionFeeAmount  Decimal          @default(0) @db.Decimal(12, 2)
  paymentFeePayer            PAYMENTFEEPAYER  @default(BUYER)
}
```

### A5. Module layout

- **Pricing (`src/modules/pricing/`)**:
  - `pricing.route.ts` $\rightarrow$ `pricing.controller.ts` $\rightarrow$ `pricing.service.ts` $\rightarrow$ `pricing.repository.ts`
- **Merchant Ads (`src/modules/merchantAds/`)**:
  - `merchantAds.route.ts` $\rightarrow$ `merchantAds.controller.ts` $\rightarrow$ `merchantAds.service.ts` $\rightarrow$ `merchantAds.repository.ts`
- **Orders (`src/modules/orders/`)**:
  - `order.route.ts` $\rightarrow$ `order.controller.ts` $\rightarrow$ `order.service.ts` $\rightarrow$ `order.repository.ts`
