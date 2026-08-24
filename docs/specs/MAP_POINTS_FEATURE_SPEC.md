# MAP Points — Feature Spec & Implementation Plan

**Status:** Planning only — not started. Full spec pasted below is the source of truth for scope; the evaluation above it is what to read first before writing any code.

---

## Evaluation (read this first)

### Scope reality check

This is not a one-day feature. As written, it spans:

- **New backend domain**: an immutable ledger table, a balance/summary table, campaign rules, redemption rules, loyalty-level config, fraud/idempotency guards — plus ~15 new/changed REST endpoints across buyer, seller, and admin surfaces.
- **New Flutter feature module** (`lib/features/mapPoints/`) with a wallet screen, transaction history, an earn-hub, a rewards marketplace with redemption modals, an earn animation, a loyalty/level screen, home-widget, store-page/product-page hooks, checkout integration, and order-completion integration — plus wiring into two _existing_ screens (checkout, order confirmation) that already have real logic (pricing engine, payment methods) this has to slot into without breaking.
- **New web surfaces**: `/seller/promotions` gets a MAP campaign builder (7-step wizard) and analytics cards; `/admin/map-points` gets a full control center (rules, campaigns, loyalty levels, user balances, transaction inspection with filters, fraud monitoring).
- **Cross-cutting concerns**: Socket.IO notification events, RabbitMQ-based async awarding (to keep order/review/referral flows fast, matching the existing `EmailConsumer`/`AnalyticsConsumer` pattern), audit logging for every admin balance adjustment, and idempotency keys so `ORDER_COMPLETED:{orderId}` can never double-award.

Realistically this is **weeks of work across all three repos**, not a single session. Treat the 26 numbered sections in the spec as a backlog, not a sprint.

### Recommended phasing

1. **Phase 1a — Ledger foundation (API only).** Prisma models for the account + immutable ledger, the balance-read path, and one real earning trigger (order completion) wired through the existing order-completion flow with an idempotency key. No UI yet beyond a raw balance/transactions endpoint. This is the only phase that unblocks everything else — get the ledger semantics right before anything touches it.

   Concretely, Phase 1a is just four things:
   1. Two new tables: `MapPointsAccounts` (one row per user — current balance, lifetime earned, lifetime spent) and `MapPointsTransactions` (one row per earn/spend, append-only, never updated or deleted — the permanent record).
   2. One real trigger, at a specific, verified spot: `OrderService.completeOrder()` in `src/modules/orders/order.service.ts:362`. Right after it calls `SettlementService.createForCompletedOrder(tx, orderId)` (line 468) — the call that books what the platform owes the seller, inside the same DB transaction as the completion itself — a sibling call, e.g. `MapPointsService.awardForCompletedOrder(tx, orderId, buyerId)`, credits MAP the same way. Same transaction, same "cannot record a debt/reward for an order that didn't finish completing" guarantee the settlement call already relies on (see the comment at order.service.ts:463-467 — FLAGS.md LED-3).
   3. A DB-level unique constraint on the transaction's reference key (e.g. `ORDER_COMPLETED:{orderId}`) so the same order can never award MAP twice, even under a retry or a race.
   4. Two read-only endpoints — `GET /v1/map-points/balance` and `GET /v1/map-points/transactions` — no UI, just data queryable directly (e.g. via curl/Postman) to confirm the ledger behaves correctly before anything is built on top of it.

   Nothing else — no wallet screen, no animation, no rewards marketplace, no seller/admin tooling — happens until this is confirmed working: balances always match the sum of their transaction log, and no order ever double-credits.

2. **Phase 1b — Buyer wallet UI (mobile).** Wallet screen (balance, lifetime earned/spent, transaction history) reading real data from 1a. Home-screen widget. No redemption yet — read-only.
3. **Phase 1c — Earning surfaces.** Store/product "Earn N MAP" badges (backend-driven, no hardcoded values per the spec's own requirement), the earn animation, review/referral/store-visit triggers.
4. **Phase 1d — Redemption.** Rewards marketplace, redemption confirmation modal, checkout MAP application — this is the highest-risk phase since it touches money math and must be server-validated end to end (never trust a client-computed discount).
5. **Phase 2 — Seller & admin tooling.** Campaign builder, seller MAP analytics, admin control center, transaction inspection with filters, manual balance adjustments with mandatory audit trail.
6. **Phase 3 — Gamification.** Loyalty levels, MAP Streak, Local Hero achievements. These are explicitly "prepare the UI architecture for future" in the spec — safe to defer entirely; build the config schema now, the screens later.

Don't start Phase 1b before 1a is solid — a wallet UI over a half-finished ledger just produces numbers nobody trusts, which is worse than not having the screen yet.

### Architecture decisions to make before writing code

- **Ledger shape**: one `MapPointsAccounts` row per user (`balance`, `lifetimeEarned`, `lifetimeSpent`, `pendingBalance`) plus an append-only `MapPointsTransactions` table (`type`, `amount`, `referenceKey` UNIQUE, `description`, `expiresAt`, `status`, `createdAt`). The balance field is a denormalized cache updated transactionally alongside each ledger insert — never derive it by summing the whole ledger on every read, but never let it drift from the ledger either (recompute-and-reconcile job, matching the existing cron pattern in `scheduler/index.ts`, is worth having from day one).
- **Idempotency**: `referenceKey` (e.g. `ORDER_COMPLETED:{orderId}`, `REFERRAL:{referredUserId}`, `STORE_VISIT:{userId}:{storeId}:{date}`) as a DB-level unique constraint, not just an application-level check — matches the spec's own example and closes the race-condition window a check-then-insert would leave open.
- **Async awarding**: route earning events through RabbitMQ the same way `AnalyticsConsumer` ingests events, so a slow points calculation never blocks the order/review/referral request itself. The consumer is also the natural place to run fraud checks (duplicate detection, velocity limits) before writing the ledger row.
- **Store-visit verification**: the spec says "verified eligible interaction" but doesn't define verification. GPS alone is spoofable (emulators, mock-location apps). Needs a concrete mechanism before Phase 1c — e.g. proximity check server-side against `StoreLocations` combined with a minimum dwell time, or QR-code-at-counter scan (mirroring the existing pickup-pass QR pattern already built for orders).
- **Reuse, don't rebuild**: RBAC/permission middleware, Socket.IO notification rooms (`notifications:user:{userId}`), the existing seller-campaign UI patterns (`/seller/promotions` ad wizard), and `AuditLogs` are all already in place and should be extended, not duplicated.
- **Money-adjacent correctness**: MAP-for-₱ redemption must be calculated and validated server-side at redemption time, exactly like the existing pricing engine already does for orders (`PricingEngineService` is the template — the spec explicitly calls this out and it should be treated as non-negotiable, not just a nice-to-have).

### Cash withdrawal — a separate, bigger decision

You asked whether MAP could also be _withdrawn_ (cashed out to a bank account or e-wallet), not just redeemed in-app for discounts/free items. The original spec never mentions this — every example is an in-platform reward (₱ discount, free item, store reward). That's not an oversight; it's a meaningful line:

- **In-app redemption** (MAP → discount on your next order) is a marketing/loyalty mechanic. It never leaves the platform's books.
- **Cash withdrawal** (MAP → money in your bank/GCash) turns MAP into something functionally close to e-money. In the Philippines that's BSP-regulated territory (the same reason PayMongo itself is a licensed gateway, not something built in-house) — offering cash-out on your own reward points risks needing an EMI license or equivalent, independent of whether blockchain is involved. This is a legal/compliance question, not an engineering one, and it's bigger than "add a feature."

Recommendation: keep withdrawal **off by default and behind an explicit admin toggle** (see settings below) so the architecture supports it later without committing to it now. Build redemption (Phase 1d) first; treat withdrawal as a Phase 2+ decision that needs a compliance answer before any UI for it ships. If it's approved, the natural home is `SellerPayouts`-adjacent — reuse the existing payout batch/status pipeline (`PENDING → PROCESSING → COMPLETED`) rather than inventing a second one.

### Admin-configurable Points Settings

The spec's admin control center (section 14) lists _what_ admins manage but not the actual knobs. These are the settings that should be database-backed config (mirroring how `PricingConfigurations`/`PricingComponents` already version commission rules), never hardcoded constants:

**Earning rules**

- MAP-per-action rates: purchase (flat, or % of order subtotal, or both with a cap), review, referral, store visit, streak milestones.
- Per-user earn caps: daily/weekly/monthly ceilings per action type, to bound fraud/abuse exposure.
- Which actions are currently active (kill switch per earning type, independent of campaigns).

**Redemption rules**

- MAP-to-₱ exchange rate (and whether it's fixed platform-wide or can vary by seller/reward).
- Minimum and maximum MAP redeemable per transaction/per day.
- Which reward types are enabled (₱ discount, free item, store-specific reward).
- Whether redemption can combine with other discounts/promo codes on the same order, or is exclusive.

**Expiration policy**

- Rolling (N days after each earn) vs. calendar-based (e.g. end of year) — pick one, since it changes the ledger query shape (see open question below).
- Expiration warning lead time (the spec's "200 MAP will expire in 7 days" notification — that "7" should be configurable, not literal).
- Whether expired MAP is a hard loss or converts to something else (it should be a hard loss — that's what makes "MAP Liability" in the KPI dashboard meaningful).

**Withdrawal rules** (all default OFF until the compliance question above is resolved)

- Master on/off toggle.
- Minimum withdrawable balance.
- Withdrawal fee (flat or %) if any.
- Per-user withdrawal frequency/amount limits.

**Loyalty levels**

- Level thresholds and names (already flagged as "must be configurable" in the spec — same table shape as earning/redemption rules).
- Per-level benefit multipliers (e.g. Local Hero earns 1.1x MAP on purchases).

**Fraud/anti-abuse thresholds**

- Velocity limits that trigger a manual-review flag instead of auto-crediting (e.g. more than N referrals in 24h, more than N store visits at the same store in a day).
- Whether flagged transactions auto-hold (pending) until an admin clears them, or auto-reject.

Every one of these should be a row in a versioned config table, not an environment variable or a constant in code — the same pattern the existing `PricingConfigurations` table already establishes, so admins can change the economics without a deploy, and every change is itself auditable (old config version stays queryable, matching how commission rule versioning already works).

### Open questions worth resolving before Phase 1a

- Does MAP balance survive account suspension/ban, or freeze/forfeit?
- Rolling expiration (each earn expires N days after it was earned) or calendar-based (e.g. end of year)? This changes the ledger query shape significantly.
- Is "store visit" limited to once per store per day, or per visit with a cooldown?
- Referral reward on signup, or gated on the referred user's first completed order (the latter is much more fraud-resistant and is what most platforms do)?

---

## Original Spec (verbatim, source of truth for scope)

MAPANYTIME — MAP POINTS + UI/UX IMPLEMENTATION REQUIREMENT

Implement the MAP Points system as a complete feature across the MapAnytime platform.

The implementation must include BOTH:

1. Backend functionality
2. Complete UI/UX designs and frontend implementation

The MAP Points experience should feel like a premium, native MapAnytime feature — not like a basic points counter added to the application.

==================================================

1. MAP POINTS CORE
   \==================================================

Name:
MAP Points

Symbol:
MAP

Type:
Off-chain platform reward points

Blockchain:
Not required in Phase 1

MAP Points should be integrated into the existing MapAnytime ecosystem and connected to:

- Purchases
- Store visits
- Reviews
- Referrals
- Promotions
- Loyalty
- Seller campaigns
- Agent incentives
- Rewards
- Coupons

The system must use an immutable transaction ledger.

Never modify a user's MAP balance without creating a corresponding transaction record.

================================================== 2. BUYER UI/UX
==================================================

Add a dedicated MAP Points experience to the Flutter mobile application.

Recommended locations:

- Home dashboard
- Profile
- Wallet / Rewards section
- Order completion screen
- Store pages
- Product pages
- Notifications
- Referral section

Create a dedicated:

/map-points

or equivalent Flutter feature:

lib/features/mapPoints/

Suggested structure:

lib/features/mapPoints/
├── data/
├── domain/
├── presentation/
│ ├── pages/
│ ├── widgets/
│ └── controllers/
└── map_points.dart

================================================== 3. MAP POINTS WALLET UI
==================================================

Create a premium MAP Points wallet screen.

The top section should prominently display:

MAP POINTS

Current Balance

Example:

        MAP POINTS

             1,250 MAP

        ≈ Available Rewards

Include:

- Current balance
- Lifetime MAP earned
- Lifetime MAP spent
- Pending MAP
- Expiring MAP
- Recent transactions

The balance should have a subtle animated counter when the screen loads.

================================================== 4. MAP POINTS TRANSACTION HISTORY
==================================================

Create a transaction history interface.

Example:

+50 MAP
Completed Order
Order #12345
Today

+100 MAP
Referral Reward
John joined MapAnytime
Yesterday

-200 MAP
Redeemed Reward
₱200 Store Discount
Aug 20

Each transaction should display:

- Amount
- Transaction type
- Description
- Reference
- Date/time
- Status
- Expiration where applicable

Use positive/negative visual hierarchy to make earning and spending immediately understandable.

================================================== 5. MAP EARNING UI
==================================================

Create an "Earn MAP" section.

Example cards:

┌─────────────────────────────┐
│ 🛒 Shop & Earn │
│ Earn MAP when you complete │
│ purchases. │
│ │
│ +50 MAP │
└─────────────────────────────┘

┌─────────────────────────────┐
│ ⭐ Review a Purchase │
│ Share your experience. │
│ │
│ +10 MAP │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 👥 Refer a Friend │
│ Invite friends to MapAnytime│
│ │
│ +100 MAP │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 📍 Visit Local Stores │
│ Discover participating │
│ stores near you. │
│ │
│ +20 MAP │
└─────────────────────────────┘

The actual reward values must be configurable from the backend.

Do not hardcode reward amounts.

================================================== 6. MAP REWARDS MARKETPLACE
==================================================

Create a dedicated Rewards section where users can redeem MAP.

Example:

MAP REWARDS

[ ₱50 OFF ]
500 MAP

[ ₱100 OFF ]
950 MAP

[ FREE ITEM ]
1,500 MAP

[ SPECIAL STORE REWARD ]
2,000 MAP

Each reward card should show:

- Reward image/icon
- Reward name
- MAP cost
- Description
- Participating store
- Availability
- Expiration
- Redeem button

Use a confirmation modal before redemption.

Example:

Redeem ₱100 Discount?

Cost:
950 MAP

Your balance:
1,250 MAP

Remaining:
300 MAP

[ Cancel ] [ Redeem ]

================================================== 7. MAP EARN ANIMATION
==================================================

Create a special MAP earning animation.

When a buyer earns MAP after completing an eligible action:

Example:

        ✨
     +50 MAP
        ✨

     MAP EARNED!

    Completed Order

The animation should be short, smooth, and non-intrusive.

It should feel rewarding without becoming annoying.

Use this animation for:

- Completed purchases
- Referrals
- Reviews
- Store visits
- Campaign rewards
- Special bonuses

================================================== 8. MAP LEVEL / LOYALTY SYSTEM
==================================================

Prepare the UI architecture for future MAP loyalty levels.

Example:

MAP EXPLORER
0–999 MAP

LOCAL SHOPPER
1,000–4,999 MAP

CITY EXPLORER
5,000–14,999 MAP

MAP CHAMPION
15,000+ MAP

Display:

Current Level
Progress Bar
MAP required for next level
Benefits

Example:

LOCAL SHOPPER

████████████░░░░

3,200 / 5,000 MAP

1,800 MAP until City Explorer

Benefits may eventually include:

- Bonus MAP
- Exclusive promotions
- Early access
- Special discounts
- Seller rewards

The loyalty levels must be configurable rather than hardcoded.

================================================== 9. MAP POINTS ON STORE PAGES
==================================================

Add MAP earning information directly to participating store pages.

Example:

┌─────────────────────────────┐
│ ⭐ Verified Store │
│ │
│ Earn up to 50 MAP │
│ on eligible purchases │
│ │
│ [ View Products ] │
└─────────────────────────────┘

Products may also display:

+20 MAP

or:

Earn 20 MAP with this purchase

This should be driven by backend campaign rules.

================================================== 10. CHECKOUT MAP UI
==================================================

Add MAP information to checkout.

Example:

MAP POINTS

Current Balance:
1,250 MAP

Available Reward:
₱100 OFF

[ Apply 950 MAP ]

After applying:

Subtotal ₱1,000
Discount -₱100
Platform Fee ₱XX
Tax ₱XX
────────────────────────
Total ₱XXX

MAP Used:
950 MAP

Remaining:
300 MAP

The MAP discount/reward must be validated server-side.

Never trust the amount calculated by the mobile client.

================================================== 11. ORDER COMPLETION UI
==================================================

After a successful order:

        🎉 ORDER COMPLETED

        +50 MAP

     MAP Points Earned

        New Balance
          1,300 MAP

[ View Order ]

[ View MAP Rewards ]

This should be one of the most important MAP touchpoints.

================================================== 12. SELLER UI
==================================================

Add MAP functionality to:

/seller/promotions

Create a dedicated:

MAP REWARDS

section.

Seller should be able to create campaigns such as:

"Earn 50 MAP when you spend ₱500"

or:

"Double MAP Weekend"

or:

"Earn 100 MAP on Product X"

Seller campaign builder:

Step 1:
Campaign Name

Step 2:
Products / Categories

Step 3:
MAP Reward

Step 4:
Minimum Purchase

Step 5:
Campaign Duration

Step 6:
Budget / Maximum Rewards

Step 7:
Review & Publish

================================================== 13. SELLER MAP ANALYTICS
==================================================

Add analytics cards:

MAP Rewards Given
MAP Campaign Cost
Orders Generated
Revenue Generated
New Customers
Repeat Customers
MAP Conversion Rate

Example:

MAP CAMPAIGN

MAP Distributed
4,250

Orders
183

Revenue
₱92,500

New Customers
47

ROI
3.8x

================================================== 14. ADMIN MAP CONTROL CENTER
==================================================

Add:

/admin/map-points

Admin should be able to manage:

- MAP earning rules
- MAP reward values
- Campaigns
- Loyalty levels
- Redemption rules
- Expiration rules
- User balances
- Transaction history
- Fraud monitoring
- Seller MAP campaigns

Dashboard KPIs:

Total MAP Issued
Total MAP Redeemed
Active MAP Balance
Expired MAP
MAP Liability
Active Campaigns
MAP Users

================================================== 15. ADMIN MAP TRANSACTION INSPECTION
==================================================

Admin must be able to inspect every MAP transaction.

Filters:

- User
- Seller
- Transaction type
- Date
- Amount
- Reference
- Campaign
- Status

Transaction types:

EARN
REDEEM
BONUS
REFERRAL
STORE_VISIT
REVIEW
PURCHASE
CAMPAIGN
ADJUSTMENT
EXPIRATION
REVERSAL

Manual adjustments must require:

- Reason
- Admin ID
- Timestamp
- Previous balance
- New balance

Every administrative adjustment must be written to AuditLogs.

================================================== 16. AGENT UI
==================================================

Agents can see MAP-related referral rewards.

Example:

MY RECRUITMENTS

Merchant:
ABC Hardware

Status:
Approved

MAP Reward:
+500 MAP

Status:
PAID

This should be connected to the existing agent recruitment system.

================================================== 17. NOTIFICATIONS
==================================================

Create MAP-specific notifications.

Examples:

"🎉 You earned 50 MAP from your completed order."

"You received 100 MAP from a successful referral."

"🔥 Double MAP Weekend has started."

"⚠️ 200 MAP will expire in 7 days."

"You redeemed 950 MAP for a ₱100 reward."

Notifications should work with the existing Socket.IO notification architecture.

================================================== 18. HOME SCREEN MAP WIDGET
==================================================

Add a compact MAP Points widget to the buyer home screen.

Example:

┌─────────────────────────────┐
│ MAP POINTS │
│ │
│ 1,250 MAP │
│ │
│ +50 MAP from last order │
│ │
│ [ Earn ] [ Rewards ] │
└─────────────────────────────┘

The widget should be visually attractive but not dominate the main MapAnytime map/discovery experience.

================================================== 19. MAP VISUAL IDENTITY
==================================================

Create a unique visual identity for MAP Points.

MAP should feel connected to the MapAnytime brand.

Use:

- Map-inspired visual elements
- Location/pin concepts
- Subtle map/grid patterns
- Clean modern cards
- Smooth micro-animations
- Premium reward presentation
- Consistent typography
- Consistent spacing
- Existing MapAnytime design system

Do NOT make it look like a generic cryptocurrency wallet.

The visual language should communicate:

LOCAL
DISCOVERY
REWARDS
COMMERCE
COMMUNITY

================================================== 20. SPECIAL MAP FEATURE — "DISCOVER & EARN"
==================================================

Add a special MapAnytime feature called:

DISCOVER & EARN

Users can discover nearby participating stores and earn MAP through eligible activities.

Example:

📍 Nearby Store

ABC Coffee

"Visit this store and earn 20 MAP"

[ Navigate ]

After a verified eligible interaction:

        +20 MAP

     DISCOVER & EARN

This feature should connect MAP Points directly to MapAnytime's biggest differentiator:

THE MAP.

The goal is to make MAP useful not only when purchasing, but also when exploring the local marketplace.

================================================== 21. SPECIAL MAP FEATURE — "MAP STREAK"
==================================================

Prepare a future loyalty feature:

MAP STREAK

Example:

🔥 4 DAY STREAK

Visit or purchase from participating local stores to maintain your streak.

Day 1 ✓
Day 2 ✓
Day 3 ✓
Day 4 ✓
Day 5 🔒

Rewards can increase with streak length.

Example:

3 Days → +30 MAP
7 Days → +100 MAP
14 Days → +250 MAP
30 Days → Special Reward

All values must be configurable from the backend.

================================================== 22. SPECIAL MAP FEATURE — "LOCAL HERO"
==================================================

Create a future achievement system.

Example:

🏆 LOCAL HERO

Support 10 local stores

Progress:

████████░░

8 / 10 Stores

Reward:

+500 MAP

This encourages users to discover and support more local merchants.

================================================== 23. BACKEND API
==================================================

Add appropriate endpoints such as:

GET /v1/map-points
GET /v1/map-points/balance
GET /v1/map-points/transactions
GET /v1/map-points/rewards
GET /v1/map-points/campaigns

POST /v1/map-points/redeem
POST /v1/map-points/referral
POST /v1/map-points/store-visit

Admin:

GET /v1/admin/map-points
POST /v1/admin/map-points/campaigns
POST /v1/admin/map-points/adjust
PATCH /v1/admin/map-points/rules

Seller:

GET /v1/seller/map-points
POST /v1/seller/map-points/campaigns
PATCH /v1/seller/map-points/campaigns/:id

Use the existing authentication, RBAC, permission middleware, Prisma, PostgreSQL, Redis, RabbitMQ, and Socket.IO architecture.

================================================== 24. SECURITY & ANTI-FRAUD
==================================================

MAP Points must never be treated as trusted client-side data.

The server must calculate:

- MAP earned
- MAP spent
- MAP balance
- Reward eligibility
- Campaign eligibility
- Store visit eligibility

Prevent:

- Duplicate rewards
- Replay attacks
- Duplicate order rewards
- Fake store visits
- Referral abuse
- Review farming
- Balance manipulation
- Unauthorized admin adjustments

Use idempotency keys/reference IDs where appropriate.

Example:

ORDER_COMPLETED:ORDER_12345

must only generate the corresponding MAP reward once.

================================================== 25. PHASE 1 — NO BLOCKCHAIN
==================================================

Do NOT implement:

- Cryptocurrency wallets
- Smart contracts
- Token transfers
- Blockchain transactions
- Exchange integration
- Gas fees
- Token trading

MAP Points are an internal MapAnytime reward system during Phase 1.

================================================== 26. FUTURE PHASE — OPTIONAL MAP TOKEN
==================================================

Only after MapAnytime has proven:

- Strong marketplace adoption
- Significant transaction volume
- Active sellers
- Active buyers
- Real MAP utility
- Sustainable reward economics

should the team evaluate whether MAP Points should eventually become a blockchain-based token.

The marketplace must remain the foundation.

==================================================
FINAL PRODUCT EXPERIENCE
==================================================

The final MAP experience should feel like:

MapAnytime + Local Discovery + Shopping + Rewards

NOT:

MapAnytime + Random Cryptocurrency

The user should naturally encounter MAP while using the platform:

Discover a store
↓
Shop
↓
Complete purchase
↓
Earn MAP
↓
Redeem rewards
↓
Discover another local store
↓
Earn more MAP
↓
Return to MapAnytime

This creates the core MapAnytime economic loop:

BUYERS
↓
DISCOVER LOCAL STORES
↓
PURCHASE
↓
EARN MAP
↓
REDEEM / SAVE
↓
RETURN TO MAPANYTIME
↓
MORE LOCAL COMMERCE
↓
SELLERS GET MORE CUSTOMERS
↓
SELLERS FUND MORE PROMOTIONS
↓
MORE DISCOVERY
↓
MORE BUYERS

FINAL DECISION:

Build MAP Points now.

Make the UI highly polished, interactive, rewarding, and tightly integrated with the MapAnytime map and marketplace.

Do not launch MAP as a cryptocurrency yet.

The MAP Points architecture should, however, be designed cleanly enough that a future blockchain/token layer can be introduced without rewriting the entire marketplace.
