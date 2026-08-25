# MapAnytime — Feature Requirements

Consolidated requirements register for the four projects in this workspace.
Companion to [`FLAGS.md`](./FLAGS.md): **this file says what the system is meant
to do; `FLAGS.md` says what is currently wrong with it.**

**Assembled:** 2026-08-20 · **Sources:** the 26 `.md` files in the workspace,
`prisma/schema.prisma`, 25 mounted route groups, and the three clients
(`-web`, `-app`, `-admin`).

> **There is no PRD.** No document in this workspace states a requirement before
> it was built. Everything below is reverse-derived from schema, routes, screens
> and the retrospective docs, then marked with the status the code actually
> supports. Where the `.md` files disagree with the code, the code wins and the
> disagreement is recorded under [Doc drift](#doc-drift).

**Status key** — ✅ built · ◐ partial · ⚠ built but wrong · ⬚ not built · ⊘ withdrawn

**Coverage:** 102 requirements — 63 ✅ · 14 ◐ · 19 ⬚ · 6 ⊘ (recounted 2026-08-25)

**No ⚠ rows remain.** The last two — CART-2 (preview disagreed with checkout) and
FEE-8 (two pricing engines) — closed on 2026-08-20. Everything still outstanding
is unbuilt or partial, not built-and-wrong.

_This line has now drifted twice. It claimed 100 across one split, was corrected
to 108 across another on 2026-08-20 and called "a mechanical recount", and was
still wrong by six rows on 2026-08-25 — before that day's two status changes,
the real figures were 63 / 15 / 19 / 5, not 70 / 17 / 16 / 5. A hand-maintained
tally beside a hand-maintained table will keep drifting; if the number matters,
count it in CI rather than in prose._

---

## Product in one paragraph

A map-first local marketplace for the Philippines. Buyers open a map, see nearby
stores and sponsored deals as pins, buy for collection at the store, and pay
through a gateway. Pickup is the only fulfilment mode — delivery was cut (F36). Sellers onboard with verification documents, are approved by an admin,
run one or more stores, list products (or house-and-lot property listings),
advertise, and are settled net of commission. Agents recruit sellers. A platform
pricing engine decides every fee on every order and writes an immutable charge
ledger.

---

## ID — Identity & access

| #    | Requirement                                                                         | Status | Evidence                                                                                    |
| :--- | :---------------------------------------------------------------------------------- | :----- | :------------------------------------------------------------------------------------------ |
| ID-1 | Buyers, sellers, agents and admins register and sign in by email/password or Google | ✅     | `auth.route.ts`                                                                             |
| ID-2 | Access tokens refresh without re-login; logout invalidates the session server-side  | ✅     | `Session` model, `/auth/refresh-token`                                                      |
| ID-3 | An account carries a status that gates access (active / suspended / …)              | ✅     | `USERACCOUNTSTATUS`                                                                         |
| ID-4 | Every endpoint's authority is a role→permission grant an admin can edit at runtime  | ✅     | `/v1/rbac`, `permission.gates.test.ts`                                                      |
| ID-5 | Admin accounts are created by invitation, with expiry and status                    | ◐      | `AdminInvites` model; no invite endpoint exists                                             |
| ID-6 | A user can reset a forgotten password                                               | ⬚      | Flutter has `forgot_password_page` and `reset_password_page`; the API has no reset endpoint |

## STO — Seller onboarding & stores

| #     | Requirement                                                                                                                              | Status | Evidence                                                 |
| :---- | :--------------------------------------------------------------------------------------------------------------------------------------- | :----- | :------------------------------------------------------- |
| STO-1 | A seller registers a store declaring capacity (owner / broker / proxy) and uploads verification documents (BIR certificate, IDs, titles) | ✅     | `SELLERCAPACITY`, `Documents`, `DOCUMENTTYPES`           |
| STO-2 | A store stays invisible to buyers until an admin approves it; rejection carries a reason                                                 | ✅     | `/v1/admin/approvals`, `STOREAPPROVALSTATUS`             |
| STO-3 | One seller may operate several stores and switch between them                                                                            | ✅     | `/stores/my-stores`, store selector in `-web`            |
| STO-4 | Store profile: opening hours per day, map coordinates, contact details, imagery                                                          | ✅     | `StoreHours`, `StoreLocations`                           |
| STO-5 | A seller edits their own store profile and nothing else                                                                                  | ✅     | `PATCH /v1/stores/:id`, ownership checked in the service |
| STO-6 | Buyers rate and review stores                                                                                                            | ⬚      | `StoreReviews` model only — no route, no client          |

## MAP — Map discovery

| #     | Requirement                                                                  | Status | Evidence                                                                                                           |
| :---- | :--------------------------------------------------------------------------- | :----- | :----------------------------------------------------------------------------------------------------------------- |
| MAP-1 | Buyers browse stores as pins on a map around their location, within a radius | ✅     | `GET /stores/nearby`, `world_map_page.dart`                                                                        |
| MAP-2 | Tapping a pin opens store name, distance and a way into the storefront       | ✅     | `store_bottom_sheet.dart`, `world_map_controller.dart`, `store_repository.dart` — shipped on `mapbox_maps_flutter` |
| MAP-3 | Sponsored deals appear as promoted pins within 1–50 km                       | ◐      | `GET /merchant-ads/nearby` works; no web client calls it (F18)                                                     |
| MAP-4 | A storefront page lists a store's products                                   | ✅     | `storefront_page.dart`, `/store/[id]`                                                                              |

## CAT — Catalog

| #     | Requirement                                                              | Status | Evidence                                                                            |
| :---- | :----------------------------------------------------------------------- | :----- | :---------------------------------------------------------------------------------- |
| CAT-1 | Products carry images, price, stock, category, tags and a publish status | ✅     | `Products`, `PRODUCTSTATUS`, `ProductImages`                                        |
| CAT-2 | Variant products are built from options and option values                | ✅     | `ProductVariants`, `ProductOptions`, `ProductVariantToOptionValue`                  |
| CAT-3 | Admins maintain a category tree (roots, branches, whole trees)           | ✅     | `/v1/categories`                                                                    |
| CAT-4 | Sellers link supplier products for sourcing                              | ✅     | `/v1/supplier-products`                                                             |
| CAT-5 | A seller creates a listing from a photo, with fields filled in by AI     | ◐      | `/seller/ai-upload` and `ai.consumer.ts`, which sleeps 3 s and logs — no model call |
| CAT-6 | Buyers review products they bought                                       | ⬚      | `ProductReviews` model only; `features/orders/api/reviews.api.ts` is dead code      |
| CAT-7 | Buyers keep a wishlist                                                   | ⬚      | `Wishlists` / `WishlistItems` models only — no route                                |

## PROP — Property listings

| #      | Requirement                                                                                                                       | Status | Evidence                                            |
| :----- | :-------------------------------------------------------------------------------------------------------------------------------- | :----- | :-------------------------------------------------- |
| PROP-1 | House-and-lot and raw-land listings carry structured metadata: terrain, furnishing, title type, negotiability, tax responsibility | ✅     | `ProductProperties` and six enums                   |
| PROP-2 | A listing moves draft → pending review → active / rejected under admin approval                                                   | ✅     | `PROPERTYSTATUS`, `/admin/approvals/properties/:id` |
| PROP-3 | Each property has its own seller dashboard                                                                                        | ✅     | `GET /properties/:id/dashboard`                     |
| PROP-4 | Property documents (titles, tax declarations) attach to the listing                                                               | ✅     | `PropertiesFiles`                                   |

## CART — Cart & checkout

| #      | Requirement                                                                  | Status | Evidence                                                                                                                                                                                                                                                                          |
| :----- | :--------------------------------------------------------------------------- | :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CART-1 | A cart holds items from one store; add and clear                             | ✅     | `/v1/cart`                                                                                                                                                                                                                                                                        |
| CART-2 | The pricing preview shows the buyer exactly what checkout will charge        | ✅     | Preview routed through `PricingEngineService` 2026-08-20; the second engine is deleted. The preview quotes the goods total and returns `paymentFeeIncluded: false` — the fee is per-method and no method is chosen yet, so `GET /payments/methods?amount=` quotes it at selection |
| CART-3 | Stock is reserved for 15 minutes when the order is created                   | ✅     | `InventoryReservations.expiresAt`                                                                                                                                                                                                                                                 |
| CART-4 | Auto-applied promotions are reflected before checkout                        | ✅     | `computeItemDiscount` in the preview                                                                                                                                                                                                                                              |
| CART-5 | A buyer-facing checkout screen itemises every line, transaction fee included | ◐      | Flutter `checkout_page.dart` does; web has only `/seller/checkout` (F19)                                                                                                                                                                                                          |

## INV — Inventory

| #     | Requirement                                                                    | Status | Evidence                                                |
| :---- | :----------------------------------------------------------------------------- | :----- | :------------------------------------------------------ |
| INV-1 | Stock is tracked per store × product × variant, split on-hand against reserved | ✅     | `Inventory`                                             |
| INV-2 | Every movement is recorded with its reference type                             | ✅     | `InventoryMovements`                                    |
| INV-3 | Expired reservations release automatically                                     | ✅     | One-minute cron in `scheduler/index.ts`                 |
| INV-4 | Restock and adjustment are safe under concurrency                              | ✅     | `version` column, `inventory.repository.adjust.test.ts` |

## ORD — Orders & fulfillment

| #     | Requirement                                                                          | Status | Evidence                                                                                                                                                                              |
| :---- | :----------------------------------------------------------------------------------- | :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ORD-1 | An order is for pickup or delivery, with a pickup time when relevant                 | ✅     | `FULLFILLMENTTYPE`, `pickupAt`                                                                                                                                                        |
| ORD-2 | Orders move through a state machine; cancel and complete are explicit transitions    | ✅     | `order.state.test.ts`, `PATCH /orders/status`                                                                                                                                         |
| ORD-3 | Store contact and address are snapshotted onto the order at creation                 | ✅     | `storeAddressSnapshot`, `sellerPhoneSnapshot`                                                                                                                                         |
| ORD-4 | A seller works a queue of their store's orders and sees store stats                  | ✅     | `GET /orders/store`, `/orders/store/stats`                                                                                                                                            |
| ORD-5 | ~~Shipments are created and tracked through statuses~~ — **withdrawn with delivery** | ⊘      | No `Shipments` model, no `SHIPMENTSTATUS`, no `src/modules/shipments/`. `FULLFILLMENTTYPE` has exactly one member: `PICKUP`. Was marked ✅ against code that does not exist — see F59 |
| ORD-6 | A buyer requests a return; approval refunds the money at the provider                | ◐      | `return.service.ts` computes `refundAmount` and stops — no provider call                                                                                                              |
| ORD-7 | A buyer shows a pickup pass at the store                                             | ✅     | `pickup_pass_page.dart`                                                                                                                                                               |

## PAY — Payments

| #     | Requirement                                                                                      | Status | Evidence                                                             |
| :---- | :----------------------------------------------------------------------------------------------- | :----- | :------------------------------------------------------------------- |
| PAY-1 | Providers and their methods are data, not an enum — activatable and prioritised                  | ✅     | `PaymentProviders`, `PaymentMethods`, `PAYMENTMETHODTYPE`            |
| PAY-2 | A buyer is sent to a hosted checkout session and returns to a pollable status                    | ✅     | `paymongo.provider.ts`, `GET /orders/:orderId/payment`               |
| PAY-3 | Webhooks are signature-verified, deduplicated per (provider, event), and `COMPLETED` is terminal | ✅     | `processProviderWebhook`                                             |
| PAY-4 | A keyless environment still works through a mock provider, refused in production                 | ✅     | `getProviderAdapter` and the production guard                        |
| PAY-5 | Only the order's buyer or its store's seller may read or pay it                                  | ✅     | `assertOrderAccess`, 404 rather than 403                             |
| PAY-6 | Legacy client method strings keep resolving during the rollout                                   | ✅     | `LEGACY_METHOD_CODE_ALIASES`                                         |
| PAY-7 | Refunds and voids are reflected in payment state                                                 | ⬚      | `REFUNDED` / `PARTIALLY_REFUNDED` / `REFUND_PENDING` are unreachable |

## FEE — Pricing & fees

| #     | Requirement                                                                                                             | Status | Evidence                                                                                                                                                                                      |
| :---- | :---------------------------------------------------------------------------------------------------------------------- | :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEE-1 | Pricing is versioned and effective-dated, resolved by priority                                                          | ✅     | `PricingConfigurations`                                                                                                                                                                       |
| FEE-2 | Components scope by provider, method, category, store or seller plan, with min/max caps                                 | ✅     | `PricingComponents`                                                                                                                                                                           |
| FEE-3 | Marketplace commission is charged on the goods subtotal only                                                            | ✅     | `pricing.engine.financial-rules.test.ts`                                                                                                                                                      |
| FEE-4 | The buyer transaction fee is the gateway pass-through, grossed up so the gateway's cut on the captured total is covered | ✅     | `buyerTransactionFee` breakdown. No platform margin — the old 0.23% was GCash's own rate misread as markup (F32)                                                                              |
| FEE-5 | The fee payer policy (buyer / seller / platform / shared) is resolved server-side, never by the client                  | ◐      | The engine supports all four; nothing passes it, so every order prices as `BUYER` (F20)                                                                                                       |
| FEE-6 | Fees come from contracted provider rates, not a universal fallback                                                      | ✅     | `prisma/seeders/pricing.seeder.ts` seeds the contracted rates as an ACTIVE configuration. QR Ph and GrabPay have no rate on file and still hit the fallback, which now warns once per process |
| FEE-7 | An admin creates, edits, validates and activates a pricing configuration                                                | ◐      | Create only; no update or activate endpoint (F21)                                                                                                                                             |
| FEE-8 | One pricing engine decides every fee                                                                                    | ✅     | `PricingEngineService` is the only engine; `src/modules/taxation/` is deleted. `CommissionRules` is orphaned pending a data migration                                                         |

## VAT — Tax

**Retired 2026-08-20.** MapAnytime earns commission on sales it facilitates and
never takes title to the goods, so output VAT is the seller's own liability
against their own BIR registration. The platform charges no tax, holds none,
and remits none. Listed prices are seller-set and treated as tax-inclusive.

VAT-1 through VAT-5 are withdrawn rather than unmet — there is no gap here to
close. The decision and its worked example live in `FLAGS.md` under _Confirmed
business rules_; `tests/unit/pricing.engine.financial-rules.test.ts` and
`tests/unit/order.service.charges.test.ts` enforce that no tax term and no
`TAX` charge row can reappear.

| #     | Requirement                                                                         | Status | Evidence                                                                                                                |
| :---- | :---------------------------------------------------------------------------------- | :----- | :---------------------------------------------------------------------------------------------------------------------- |
| VAT-1 | ~~12 % VAT is charged, ledgered to `GOVERNMENT` and kept out of seller settlement~~ | ⊘      | Withdrawn — no tax is charged                                                                                           |
| VAT-2 | ~~VAT is charged on the actual consideration, after discounts~~                     | ⊘      | Withdrawn                                                                                                               |
| VAT-3 | ~~VAT applies according to the seller's registration status~~                       | ⊘      | Withdrawn — the seller's own registration, not the platform's concern. `BIR_CERTIFICATE` upload stays as onboarding KYC |
| VAT-4 | ~~The rate and its exemptions are configurable~~                                    | ⊘      | Withdrawn                                                                                                               |
| VAT-5 | ~~Collected VAT is remitted and reportable~~                                        | ⊘      | Withdrawn — nothing is collected                                                                                        |

## LED — Ledger, settlement & payout

| #     | Requirement                                                           | Status | Evidence                                                                                            |
| :---- | :-------------------------------------------------------------------- | :----- | :-------------------------------------------------------------------------------------------------- |
| LED-1 | Every order writes immutable charge rows naming payer and beneficiary | ✅     | `OrderCharges`, `order.service.charges.test.ts`                                                     |
| LED-2 | The fee rates used are frozen onto the order                          | ✅     | `sellerMarketplaceFeeRate`, `paymentProviderFeeRate`, …                                             |
| LED-3 | A paid order creates a seller settlement with a release-eligible date | ⬚      | **Nothing writes `Settlements`** — no `settlements.create` exists in `src`                          |
| LED-4 | Released settlements batch into a payout with a reference number      | ◐      | `PayoutService.createPayout` is complete but filters on `RELEASED` settlements that can never exist |
| LED-5 | The chain order → payment → settlement → payout reconciles            | ◐      | Only `OrderCharges` against `Orders.totalAmount` is proven (F24)                                    |

## PRM — Promotions & discounts

| #     | Requirement                                                                 | Status | Evidence                                                    |
| :---- | :-------------------------------------------------------------------------- | :----- | :---------------------------------------------------------- |
| PRM-1 | Every promotion declares who funds it: seller, platform or shared           | ✅     | `PROMOTION_FUNDING`                                         |
| PRM-2 | Percentage discounts, BOGO and flash sales apply at item level              | ✅     | `order.service.bogo.test.ts`, `MERCHANTDISCOUNTTYPE`        |
| PRM-3 | A discount is ledgered as a seller→buyer charge                             | ✅     | `DISCOUNT` row with `CHARGEBENEFICIARY.BUYER`               |
| PRM-4 | Platform vouchers and shipping subsidies sit later in the discount pipeline | ⬚      | Pipeline documented in `FLAGS.md` A2; steps 4 and 5 unbuilt |

## ADS — Merchant advertising

| #     | Requirement                                                                                               | Status | Evidence                                                  |
| :---- | :-------------------------------------------------------------------------------------------------------- | :----- | :-------------------------------------------------------- |
| ADS-1 | A merchant runs ads with a goal, format, kind, budget, schedule and attached products                     | ✅     | `MerchantAds`, `MerchantAdProducts`                       |
| ADS-2 | Impressions, clicks and attributed orders are recorded from a public endpoint without trusting the client | ✅     | `AdEvents`; revenue derived server-side (F13)             |
| ADS-3 | A merchant sees per-ad analytics including ROAS                                                           | ✅     | `GET /merchant-ads/:id/analytics`                         |
| ADS-4 | Sponsored placements resolve by proximity                                                                 | ✅     | `GET /merchant-ads/nearby`                                |
| ADS-5 | Ad spend is billed from a marketing wallet                                                                | ⬚      | The `ADVERTISING_FEE` component type exists and is unused |

## NTF — Notifications

| #     | Requirement                                                         | Status | Evidence                                                                                          |
| :---- | :------------------------------------------------------------------ | :----- | :------------------------------------------------------------------------------------------------ |
| NTF-1 | Buyer and seller are notified in real time when a payment completes | ✅     | `emitNotificationToUser` in the webhook path                                                      |
| NTF-2 | A user reads a notification feed and marks items read               | ◐      | `NotificationService` has the methods; no route mounts them; `notification_feed_page.dart` exists |
| NTF-3 | Transactional email is sent off the request path                    | ✅     | `email.consumer.ts` on `email.send.requested`                                                     |
| NTF-4 | Push notifications reach the mobile app                             | ⬚      | Nothing found                                                                                     |

## ANL — Analytics & recommendations

| #     | Requirement                                                                                                    | Status | Evidence                                                                                           |
| :---- | :------------------------------------------------------------------------------------------------------------- | :----- | :------------------------------------------------------------------------------------------------- |
| ANL-1 | Client events (views, searches, cart adds) are ingested in batches off the request path                        | ✅     | `POST /analytics/events`, `analytics.consumer.ts`                                                  |
| ANL-2 | Sellers see store and product performance                                                                      | ✅     | `/seller/analytics`                                                                                |
| ANL-3 | Admins see marketplace metrics and an approvals queue                                                          | ◐      | The endpoint is real; `/admin`, `/admin/categories` and `/admin/orders` render hardcoded data (B4) |
| ANL-4 | Views are deduplicated per session before they count                                                           | ⬚      | Phase 2 of `docs/analytics-evaluation.md`; the web sends no `sessionId` (P1.3)                     |
| ANL-5 | Daily aggregation produces store and product rollups                                                           | ⬚      | Phase 3 of the same document                                                                       |
| ANL-6 | Popularity and performance rank separately: most viewed, trending, most engaged, best selling, best converting | ⬚      | Specified in `analytics-evaluation.md` §4                                                          |
| ANL-7 | Search and recommendations are ranked from those signals, rule-based first                                     | ⬚      | `analytics-evaluation.md` §5–6; `recommendations_page.dart` already exists on the client           |

## ADM — Admin & governance

| #     | Requirement                                               | Status | Evidence                                                                                                                    |
| :---- | :-------------------------------------------------------- | :----- | :-------------------------------------------------------------------------------------------------------------------------- |
| ADM-1 | One queue holds every pending store and property approval | ✅     | `GET /admin/approvals`                                                                                                      |
| ADM-2 | Admins manage users, roles and permissions                | ✅     | `/admin/users`, `/admin/permissions`                                                                                        |
| ADM-3 | Admins manage the category tree                           | ◐      | Endpoints real; the screen renders hardcoded data (B4)                                                                      |
| ADM-4 | Privileged actions are audit-logged                       | ◐      | `AuditLogs` model and `audit.service.ts` exist; the audit consumer is still on the API roadmap                              |
| ADM-5 | Mobile releases are published with a forced-update gate   | ✅     | `AppRelease`, `RELEASESTATUS`, public and admin routes                                                                      |
| ADM-6 | The admin experience has one home                         | ◐      | It lives in `-web/src/app/admin`; `mapanytime-market-admin` is a separate project with one page, untouched since 2026-06-22 |

## AGT — Agent programme

| #     | Requirement                                                                                                                               | Status | Evidence                                                                              |
| :---- | :---------------------------------------------------------------------------------------------------------------------------------------- | :----- | :------------------------------------------------------------------------------------ |
| AGT-1 | An agent registers a seller and starts their onboarding                                                                                   | ✅     | `POST /agent/register-seller`, `/agent/sellers/:sellerId/onboarding`                  |
| AGT-2 | An agent sees who they recruited and how far along each is                                                                                | ✅     | `GET /agent/recruits`, `/agent/recruited`                                             |
| AGT-3 | An agent earns real-money commission on recruited sellers' completed sales via `AgentCommissionAccount` and `AgentCommissionTransactions` | ⬚      | Commission ledger model, configurable base (`GMV`), pending-to-matured holding window |
| AGT-4 | An agent requests payouts (`AgentPayouts`) to bank/GCash when available commission reaches minimum threshold                              | ⬚      | Payout lifecycle and admin approval queue                                             |

## PLT — Platform & operations

| #      | Requirement                                                                   | Status | Evidence                                                                                            |
| :----- | :---------------------------------------------------------------------------- | :----- | :-------------------------------------------------------------------------------------------------- |
| PLT-1  | Route → controller → service → repository is enforced, not merely recommended | ✅     | `engineering-handbook.md`, eslint boundary rules                                                    |
| PLT-2  | One correlation id ties an API request to the work its consumers do           | ✅     | `correlationMiddleware`, the event envelope                                                         |
| PLT-3  | Async work runs on a topic exchange with retry and a dead-letter path         | ✅     | `infrastructure/rabbitmq`                                                                           |
| PLT-4  | Redis provides cache-aside reads and rate limiting                            | ✅     | `CacheUtil.remember`, `authLimiter`                                                                 |
| PLT-5  | The service shuts down gracefully                                             | ✅     | `engineering-handbook.md`, graceful shutdown                                                        |
| PLT-6  | Only allowlisted origins may call the API with credentials                    | ◐      | The socket is fixed (F14); HTTP still reflects any origin (F22 / P1.1)                              |
| PLT-7  | Scheduled jobs keep the system tidy                                           | ◐      | The reservation sweep is real; the daily cleanup and the cache flush are empty shells that only log |
| PLT-8  | CI blocks a merge on schema validity, types, lint and tests                   | ✅     | 237/237 tests, `prisma validate`, `tsc`, eslint                                                     |
| PLT-9  | The API is documented and browsable                                           | ✅     | Swagger, `swagger.spec.test.ts`                                                                     |
| PLT-10 | Staging can be deployed without endangering production                        | ⬚      | They share container name, port, env-file path and docker network (B1)                              |
| PLT-11 | Product imagery is served through the image pipeline                          | ⬚      | `next/image` cannot serve real product imagery (P1.2)                                               |

## ECO — Tri-Domain Economic System (Buyer Rewards, Seller Incentives, Agent Commissions)

| #      | Requirement                                                                                                                                                                     | Status | Evidence                                                 |
| :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----- | :------------------------------------------------------- |
| ECO-1  | Dedicated buyer reward ledger (`RewardWallet` + `RewardTransactions`) with append-only balance tracking                                                                         | ⬚      | Buyer loyalty points ledger                              |
| ECO-2  | Buyers earn 1 Reward Point per ₱100 eligible product subtotal (excluding buyer fees, processing fees, taxes) on completed orders                                                | ⬚      | Configurable earn rate rule                              |
| ECO-3  | Buyers redeem Reward Points at 100 Reward Points = ₱10 discount (₱0.10 per point) up to 20% max of eligible order subtotal                                                      | ⬚      | Server-validated checkout discount engine                |
| ECO-4  | Buyer Reward Points have a 12-month rolling expiration with explicit `-EXPIRATION` ledger entries                                                                               | ⬚      | `expiresAt` timestamps with scheduled expiration job     |
| ECO-5  | Dedicated seller promotional campaign ledger (`SellerCampaigns` + `SellerCampaignTransactions`) tracking merchant marketing spend and ROI                                       | ⬚      | Seller marketing budget and bonus point campaign builder |
| ECO-6  | Dedicated agent commission ledger (`AgentCommissionAccount` + `AgentCommissionTransactions`) tracking real-money sales commission                                               | ⬚      | Recruiter commission engine with holding period          |
| ECO-7  | In-transaction multi-ledger settlement: `OrderService.completeOrder` atomically executes order completion, seller settlement, buyer reward points, and agent commission         | ⬚      | Single atomic Prisma transaction on order completion     |
| ECO-8  | Refunded or cancelled orders reverse earned points (`-REVERSAL`) and agent commission (`-COMMISSION_REVERSAL`) proportionally                                                   | ⬚      | Proportional reversal ledger entries                     |
| ECO-9  | Point spending is concurrency-safe with strict non-negative balance checks                                                                                                      | ⬚      | Transactional locking / atomic conditional update        |
| ECO-10 | All economic rates (earn rate, redemption value, 20% cap, agent commission % and base) are dynamically versioned via `RewardConfigurations` and `AgentCommissionConfigurations` | ⬚      | Dynamic settings schema and admin APIs                   |
| ECO-11 | Scheduled reconciliation crons verify wallet and commission balances against ledger sums (`SUM(amount)`)                                                                        | ⬚      | Ledger audit and discrepancy alerting job                |

---

## <a name="doc-drift"></a>Doc drift found while gathering

The `.md` files contradict each other and the code in seven places. Fix these or
the next person gathers the wrong requirements.

| Where                                | Problem                                                                                                             |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`, two comments | Cite `docs/payments-rework-review.md §3` and `§11`; that file no longer exists. §3 is now F1 in `FLAGS.md`          |
| `-web/docs/TODO-NEXT.md`             | Points at `mapanytime-api/docs/TODO-NEXT.md` as the "source of truth for API/infra work" — that file does not exist |
| `-web/docs/production-readiness.md`  | Its Docs row promises `connection-audit.md` (§1–§9, "referenced by ~14 in-code flags"); the file is gone            |
| B2, "There is no payment gateway"    | Stale. PayMongo landed in `cfd4d31`, and the mock provider is now refused in production                             |
| P1.1 and F22, CORS                   | The same finding recorded twice under two numbering schemes                                                         |
| `-api/README.md` roadmap             | Lists RBAC as still to do; RBAC is built, mounted and tested                                                        |
| `-app/toDo/backlog.md`               | Three open questions from before `/stores/nearby` shipped — the endpoint and its response shape now exist           |

## What no requirement covers yet

Worth an explicit decision rather than a silent absence:

- ~~**Who remits the VAT**~~ — **decided 2026-08-20**: nobody, on the platform's
  side. MapAnytime charges no tax; output VAT is the seller's own liability.
  The VAT section is withdrawn.
- **Whether a seller ever gets paid** (LED-3). The settlement row the whole
  payout chain reads is never created.
- **Reviews, wishlists and the notification feed** — models and screens exist at
  both ends with no endpoint between them.
- **`features/finance` and `features/fulfillment`** in `-web` — complete client,
  contract and hook, no components. Build the screens or delete the folders.
