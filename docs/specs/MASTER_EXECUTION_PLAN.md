# MapAnytime — Master Engineering & Product Execution Plan

**Document Type:** Master Requirements, Architecture Decisions & Execution Plan  
**Project:** MapAnytime  
**Date:** 2026-08-24  
**Location:** `mapanytime-api/docs/specs/MASTER_EXECUTION_PLAN.md`  
**Status:** ACTIVE PRIMARY EXECUTION REFERENCE

---

# 1. PURPOSE

This document consolidates:

- Product requirements
- Current implementation status
- Outstanding engineering work
- Business rules
- Financial architecture
- Payment architecture
- Seller settlement
- Buyer rewards
- Seller incentives
- Agent commissions
- Analytics
- Notifications
- Admin functionality
- Infrastructure hardening
- Technical cleanup

The goal is to prevent the team from implementing isolated features without considering their effect on the complete transaction lifecycle.

This document is the primary execution reference.

---

# 2. CURRENT PRODUCT DEFINITION

MapAnytime is a map-first local marketplace for the Philippines.

The platform connects:

- Buyers
- Sellers
- Stores
- Agents
- Administrators

A buyer can:

1. Open the map
2. Discover nearby stores
3. View products and promotions
4. Add products to a cart
5. Checkout
6. Select a payment method
7. Pay through a payment gateway
8. Receive a pickup pass or delivery fulfillment
9. Complete the transaction
10. Earn rewards when eligible

A seller can:

1. Register
2. Submit verification documents
3. Wait for admin approval
4. Manage one or multiple stores
5. Manage inventory
6. Publish products
7. Create promotions
8. Run advertisements
9. Process orders
10. Receive settlement payouts

An agent can:

1. Register sellers
2. Track recruited sellers
3. Earn commissions from qualified sales
4. Request payouts

An administrator can:

1. Approve sellers/stores
2. Approve properties
3. Manage users
4. Manage roles and permissions
5. Manage categories
6. Manage pricing
7. Manage financial operations
8. Review analytics
9. Manage releases
10. Audit privileged activity

---

# 3. MOST IMPORTANT ARCHITECTURAL PRINCIPLE

## One transaction must have one source of truth.

The following chain must remain consistent:

Buyer
↓
Cart
↓
Pricing Preview
↓
Order
↓
Payment
↓
Order Completion
↓
Seller Settlement
↓
Buyer Rewards
↓
Agent Commission
↓
Payout
↓
Reconciliation

No separate subsystem should independently calculate the financial result of an order.

The server-side pricing engine must remain the authority for:

- Product subtotal
- Discounts
- Marketplace commission
- Payment provider fee
- Buyer transaction fee
- Seller net amount
- Applicable incentives
- Applicable rewards

---

# 4. IMPLEMENTATION STATUS

Current overall state:

- Core identity: largely complete
- Seller onboarding: largely complete
- Store management: largely complete
- Map discovery: largely complete
- Catalog: largely complete
- Property listings: largely complete
- Cart: complete
- Inventory: complete
- Order lifecycle: largely complete
- Payment gateway: operational
- Pricing engine: operational
- Charge ledger: operational
- Seller settlement: now operational
- Advertising: largely complete
- Analytics ingestion: operational
- Admin: partially wired
- Notifications: partially wired
- Buyer rewards: not built
- Seller incentives: not built
- Agent commissions: not built
- Reconciliation: incomplete
- Push notifications: not built

---

# 5. PRIORITY ORDER

Do NOT implement all remaining requirements simultaneously.

Recommended priority:

## PHASE 1 — Financial correctness

1. Verify seller settlement
2. Verify payment reconciliation
3. Confirm contracted payment-provider rates
4. Remove obsolete tax fields
5. Resolve orphaned CommissionRules
6. Confirm settlement hold period
7. Complete pricing administration

## PHASE 2 — Buyer transaction completion

8. Finish buyer checkout on all required clients
9. Finish returns/refunds
10. Complete payment refund/void states
11. Verify pickup/delivery lifecycle
12. Complete buyer notification feed

## PHASE 3 — Marketplace quality

13. Map pin → storefront flow
14. Sponsored map pins
15. Product reviews
16. Store reviews
17. Wishlists
18. Product imagery pipeline

## PHASE 4 — Analytics

19. Client session ID
20. Analytics deduplication
21. Daily rollups
22. Popularity ranking
23. Search ranking
24. Recommendations

## PHASE 5 — Economic ecosystem

25. Buyer rewards
26. Seller campaigns
27. Agent commissions
28. Multi-ledger completion
29. Reversals
30. Reconciliation

## PHASE 6 — Operational hardening

31. Admin invitation endpoint
32. Push notifications
33. Audit logging
34. CORS hardening
35. Environment isolation
36. Scheduled-job cleanup
37. Image pipeline
38. CI/CD hardening

---

# 6. PHASE 1 — FINANCIAL CORRECTNESS

Financial correctness must be treated as the highest priority.

The platform should not scale transactions before proving that:

Order
→ Payment
→ Charges
→ Settlement
→ Payout

always reconcile.

---

## 6.1 Payment provider rates

Current concern:

QRPH and GRAB_PAY are using the fallback rate.

This must NOT remain permanently.

### Required:

Obtain the actual contracted rates for:

- QRPH
- GrabPay
- Cards
- Other enabled payment methods

Then store them in:

`PricingComponents`

The pricing engine must resolve provider/method rates from configuration.

Do not hardcode payment rates.

---

# 7. PRICING ENGINE

`PricingEngineService` must remain the only pricing engine.

Do not introduce another pricing engine.

Every financial calculation must flow through it.

---

## 7.1 Pricing responsibility

The pricing engine calculates:

- Goods subtotal
- Item discounts
- Seller marketplace commission
- Buyer transaction fee
- Payment provider fee
- Applicable promotional adjustments
- Final buyer total
- Seller financial obligation

---

## 7.2 Fee payer

Fee payer must always be resolved server-side.

Supported:

- BUYER
- SELLER
- PLATFORM
- SHARED

The client must never decide who pays a fee.

---

## 7.3 Pricing snapshot

When an order is created, freeze the rates used.

The order should retain:

- Marketplace fee rate
- Payment provider fee rate
- Applicable pricing configuration
- Fee amounts
- Discount amounts
- Final totals

This prevents future pricing changes from modifying historical transactions.

---

# 8. COMMISSION RULES CLEANUP

`CommissionRules` is currently orphaned.

Before deleting it:

1. Inspect existing data.
2. Determine whether any production/live rates exist.
3. Migrate required category-specific rates into:

`PricingComponents`

using:

`SELLER_MARKETPLACE_FEE`

with the appropriate `categoryId`.

4. Verify pricing tests.
5. Only then remove `CommissionRules`.

Never drop the table before confirming that it contains no required historical/business data.

---

# 9. TAX / VAT DECISION

VAT is RETIRED from the MapAnytime platform financial model.

MapAnytime does not:

- Collect platform VAT
- Ledger platform VAT
- Remit platform VAT
- Treat itself as the seller of marketplace goods

Seller prices are treated as seller-controlled prices.

Seller tax obligations remain the seller's responsibility.

The `BIR_CERTIFICATE` remains relevant only as seller onboarding/KYC documentation.

---

## 9.1 Remove obsolete tax fields

`Orders.taxAmount` is now obsolete.

Recommended:

1. Confirm no code reads/writes it.
2. Confirm no reports depend on it.
3. Confirm migration history.
4. Remove the field through a migration.
5. Remove related obsolete code/tests/comments.

Do not leave obsolete tax fields in the schema because they create future confusion.

---

# 10. SELLER SETTLEMENT

Seller settlement is one of the most important financial requirements.

The lifecycle should be:

Order completed
→ Payment confirmed
→ Charges finalized
→ Seller settlement created
→ Settlement enters holding period
→ Settlement becomes RELEASED
→ Payout batch created
→ Seller receives payout

---

## 10.1 Settlement must be immutable

Once a settlement is created:

Do not recalculate historical amounts using today's pricing configuration.

The settlement should reference the financial snapshot generated for the order.

---

## 10.2 Settlement hold period

Current default:

`SETTLEMENT_HOLD_DAYS = 7`

This is currently an engineering assumption.

It should be explicitly confirmed as a business rule.

Recommended initial policy:

**7 days**

Reason:

- Allows time for returns
- Reduces payout risk
- Gives the platform time to handle payment disputes
- Creates a reasonable operational buffer

However, make the period configurable rather than hardcoded.

---

# 11. PAYMENT RECONCILIATION

Payment-provider reconciliation should be treated as a separate financial control.

The platform should eventually compare:

MapAnytime payment records
vs
Payment provider records

For each transaction:

- Order ID
- Payment ID
- Provider transaction ID
- Expected amount
- Captured amount
- Provider status
- MapAnytime status
- Fee
- Refund amount
- Timestamp

The reconciliation system should identify:

- Missing payments
- Duplicate payments
- Incorrect amounts
- Uncaptured payments
- Unexpected refunds
- Failed webhook processing
- Provider/platform status mismatches

---

# 12. REFUNDS AND RETURNS

Current return flow calculates the refund but does not complete the provider operation.

Required lifecycle:

Buyer requests return
→ Seller/admin review
→ Return approved
→ Refund amount calculated
→ Provider refund requested
→ Provider confirms
→ Payment marked refunded/partially refunded
→ Order financial records updated
→ Seller settlement adjusted if necessary
→ Rewards reversed if applicable
→ Agent commission reversed if applicable

Do not mark a payment as refunded merely because a refund request was created.

Provider confirmation should drive final state.

---

# 13. PAYMENT STATES

The system should support:

- PENDING
- PROCESSING
- COMPLETED
- FAILED
- CANCELLED
- REFUND_PENDING
- PARTIALLY_REFUNDED
- REFUNDED

`COMPLETED` remains terminal for the original payment transaction.

Refunds should be represented as separate financial events/state transitions rather than pretending the original payment never happened.

---

# 14. CART AND CHECKOUT

Cart currently supports one store per cart.

Keep this model for now.

Do NOT introduce multi-store payment yet.

Recommended:

Cart
→ One store
→ One checkout
→ One order
→ One payment

This keeps:

- Inventory reservation
- Seller settlement
- Payment
- Refunds
- Delivery
- Pickup

much simpler.

Multi-store combined checkout should only be introduced after the single-store financial lifecycle is completely stable.

---

# 15. BUYER CHECKOUT

Checkout must show the buyer:

- Products
- Quantity
- Subtotal
- Discounts
- Payment method
- Payment processing fee
- Final amount

The amount displayed immediately before payment should match the amount sent to the payment gateway.

The client must never independently calculate the final amount.

---

# 16. MAP DISCOVERY

MapAnytime's core differentiator is the map.

The primary flow should be:

Location
→ Nearby stores
→ Map pins
→ Tap pin
→ Store preview
→ Storefront
→ Product
→ Cart
→ Checkout

---

## 16.1 Map pin behavior

When a buyer taps a pin, show:

- Store name
- Distance
- Store image
- Open/closed status
- Key promotion if available
- Entry point to storefront

This should be treated as a high-priority UX requirement.

---

# 17. SPONSORED ADS

Sponsored placements should appear as promoted map pins.

The system already has:

- Ad campaigns
- Goals
- Formats
- Budgets
- Scheduling
- Attached products
- Impressions
- Clicks
- Attributed orders
- ROAS
- Proximity search

Remaining major requirement:

### Advertising wallet

A merchant should eventually fund advertising from a marketing wallet.

Recommended lifecycle:

Seller deposits funds
→ Marketing wallet balance
→ Campaign consumes balance
→ Ad event generates billable usage
→ Wallet ledger records deduction
→ Campaign stops when budget/wallet threshold is reached

Do not charge advertising directly from order settlement unless explicitly designed that way.

---

# 18. REVIEWS

Two review systems are currently missing:

## Store reviews

Buyer can review a store after a qualifying purchase.

## Product reviews

Buyer can review a product they purchased.

Important:

A buyer should only be allowed to review something they actually purchased.

Recommended fields:

- Rating
- Comment
- Order reference
- Product/store reference
- Buyer
- Created date
- Moderation status

Prevent duplicate reviews for the same qualifying purchase unless editing is explicitly supported.

---

# 19. WISHLIST

Wishlist can be implemented after core checkout.

Buyer can:

- Add product
- Remove product
- View wishlist
- Move product to cart

Do not allow deleted/unpublished products to break wishlist screens.

---

# 20. ANALYTICS

Analytics should be implemented in phases.

## Phase 1

Implement session identification.

Every client should generate a stable session ID.

Every analytics event should contain:

- sessionId
- userId if authenticated
- event type
- product/store reference
- timestamp
- metadata

---

## Phase 2

Deduplicate views.

Example:

One session views Product A 20 times.

Do not count all 20 as 20 unique product views.

Use a defined deduplication window.

---

## Phase 3

Only after real traffic exists:

- Daily rollups
- Trending
- Most viewed
- Most engaged
- Best selling
- Best converting
- Search ranking
- Recommendations

Do not over-engineer recommendation algorithms before enough real marketplace data exists.

Start rule-based.

---

# 21. NOTIFICATIONS

Current notification architecture supports in-app notifications and email.

Complete:

- Notification feed endpoint
- Mark as read
- Mark all as read
- Notification preferences

Later:

- Push notifications

Push notifications should not block the core marketplace launch.

---

# 22. ADMIN

Admin should eventually have one authoritative experience.

Recommended direction:

Use:

`mapanytime-market-web/src/app/admin`

as the primary admin application.

The separate admin project should either:

1. Be fully adopted and made authoritative, OR
2. Be deprecated and removed.

Do not maintain two competing admin applications indefinitely.

---

# 23. ADMIN INVITATIONS

Implement:

Admin creates invitation
→ Email sent
→ Invitation expires
→ Admin accepts
→ Account created/activated
→ Invitation marked used

Invitation should include:

- Token
- Expiration
- Status
- Invited email
- Inviting admin
- Created timestamp
- Accepted timestamp

No public admin registration.

---

# 24. RBAC

RBAC is already implemented.

Keep:

Role
→ Permission
→ Resource/action
→ Runtime authorization

Do not replace this with hardcoded role checks.

Admin should be able to modify permissions without redeploying the application.

---

# 25. AUDIT LOGGING

Privileged actions should produce audit records.

Examples:

- Approve seller
- Reject seller
- Approve property
- Suspend account
- Change permissions
- Change pricing
- Activate pricing configuration
- Create payout
- Approve payout
- Refund payment
- Modify financial configuration

Audit records should include:

- Actor
- Action
- Target
- Timestamp
- Correlation ID
- Relevant metadata

---

# 26. TRI-DOMAIN ECONOMIC SYSTEM

This should be implemented only after the core order → payment → settlement flow is stable.

The three economic domains are:

1. Buyer Rewards
2. Seller Incentives
3. Agent Commissions

These must remain separate ledgers.

Do NOT combine them into one generic wallet.

---

# 27. BUYER REWARDS

Recommended initial rule:

**1 Reward Point per ₱100 eligible product subtotal**

Exclude:

- Buyer transaction fee
- Payment processing fee
- Taxes
- Other non-product charges

---

## Redemption

Recommended:

100 points = ₱10

Therefore:

1 point = ₱0.10

Maximum redemption:

20% of eligible product subtotal.

Example:

Eligible subtotal = ₱1,000

Maximum discount = ₱200

Maximum redeemable points = 2,000 points.

---

# 28. REWARD EXPIRATION

Points should expire after:

**12 months**

Use explicit ledger entries.

Do not silently modify wallet balances.

Example:

+100 EARN
-100 EXPIRATION

This keeps the ledger auditable.

---

# 29. REWARD SPENDING

Reward spending must be concurrency-safe.

Never allow:

Balance = 100

Two simultaneous requests each spend 100.

Both must not succeed.

Use transactional/atomic validation.

The balance must never become negative.

---

# 30. SELLER INCENTIVES

Seller campaigns should be separate from the marketplace commission system.

Seller campaigns can fund:

- Bonus reward points
- Promotional incentives
- Campaign-specific buyer rewards

The seller should have a marketing budget.

Every campaign transaction should be ledgered.

---

# 31. AGENT COMMISSIONS

Agents should receive real-money commission from qualified sales.

Recommended initial model:

**0.05% GMV**

But this must remain configurable.

Commission configuration should support:

- Rate
- Base
- Effective date
- Holding period
- Minimum payout
- Status

---

# 32. AGENT COMMISSION LIFECYCLE

Recommended:

Sale completed
→ Commission calculated
→ Commission PENDING
→ Holding period
→ Commission MATURED
→ Available balance
→ Agent requests payout
→ Admin approves
→ Payout completed

Do not make commissions immediately withdrawable.

This protects against:

- Refunds
- Returns
- Chargebacks
- Cancelled orders

---

# 33. ATOMIC MULTI-LEDGER COMPLETION

Eventually `OrderService.completeOrder()` should perform a single transactional operation covering:

1. Complete order
2. Create/finalize seller settlement
3. Create buyer reward transaction
4. Create seller campaign transaction if applicable
5. Create agent commission transaction if applicable

All must succeed together.

If any operation fails:

The transaction should roll back.

Never allow:

Order = completed
Seller settlement = created
Buyer reward = missing
Agent commission = missing

That creates financial inconsistencies.

---

# 34. REVERSALS

Cancelled/refunded transactions must reverse economic benefits.

Example:

Order earns:

+100 buyer points
+₱5 agent commission

Later refunded:

-100 buyer points
-₱5 agent commission

Use explicit ledger entries:

`-REVERSAL`

and:

`-COMMISSION_REVERSAL`

Do not delete the original earning record.

---

# 35. LEDGER PRINCIPLE

Every financial or economic balance must be explainable from transactions.

Do not rely only on:

`wallet.balance`

The source of truth should be:

`SUM(transactions)`

The stored balance can be treated as a performance optimization/cache, but it must be reconcilable against the ledger.

---

# 36. RECONCILIATION JOBS

Scheduled reconciliation should check:

Buyer reward wallets
Seller settlements
Agent commission accounts
Payment records
Payout records

Example:

Expected balance:

SUM(RewardTransactions)

vs

Stored RewardWallet.balance

If mismatch:

- Flag discrepancy
- Do not silently repair
- Record audit event
- Alert administrators

---

# 37. INVENTORY

Inventory architecture is already strong.

Maintain:

- On-hand
- Reserved
- Available
- Version
- Movement history

Reservation:

15 minutes

Expired reservations should automatically release.

Do not decrement final stock twice.

Order completion must reconcile reserved stock correctly.

---

# 38. ORDER LIFECYCLE

Recommended canonical lifecycle:

CREATED
→ PAYMENT_PENDING
→ PAID
→ PROCESSING
→ READY_FOR_PICKUP / SHIPPED
→ COMPLETED

With explicit branches for:

- CANCELLED
- RETURN_REQUESTED
- RETURN_APPROVED
- REFUNDED

Do not allow arbitrary status changes.

All transitions should be validated by the order state machine.

---

# 39. PICKUP

Pickup flow:

Buyer pays
→ Order confirmed
→ Seller prepares order
→ Buyer receives pickup pass
→ Seller scans/verifies QR
→ Seller hands over order
→ Order completed

Pickup QR:

`MAPANYTIME-ORDER-{orderId}`

Keep this stable.

---

# 40. DELIVERY

Delivery should maintain shipment state separately from the order state.

Shipment:

CREATED
→ PICKED_UP
→ IN_TRANSIT
→ OUT_FOR_DELIVERY
→ DELIVERED

Order completion should occur based on the appropriate fulfillment business rule.

---

# 41. SECURITY

High-priority security tasks:

## CORS

HTTP currently reflects origins.

Fix this.

Only allow:

- Production web origin
- Production mobile/web clients where applicable
- Explicit staging origins

Never:

`Access-Control-Allow-Origin: *`

when credentials are enabled.

---

# 42. ENVIRONMENT ISOLATION

Staging and production must not share:

- Container names
- Ports
- Environment files
- Docker networks
- Databases
- Redis
- RabbitMQ resources

Recommended:

Production:

`mapanytime-prod-*`

Staging:

`mapanytime-staging-*`

Separate credentials and infrastructure wherever practical.

---

# 43. IMAGE PIPELINE

Product imagery should eventually use a proper image pipeline.

Requirements:

- Upload
- Validation
- Compression
- Resizing
- CDN/object storage
- Secure URLs
- Responsive delivery

The client should not depend on local filesystem paths.

---

# 44. SCHEDULED JOBS

Keep real scheduled jobs:

- Inventory reservation expiration
- Settlement release
- Reward expiration
- Reconciliation
- Cleanup
- Notification processing

Remove empty cron shells or implement them.

A scheduled job should either perform a real operation or not exist.

---

# 45. CI/CD

Every merge should verify:

- Prisma schema
- Migrations
- TypeScript
- ESLint
- Unit tests
- Integration tests
- Build
- Flutter analysis/tests where applicable

Production deployment should require successful CI.

---

# 46. REPOSITORY HYGIENE

Each repository should contain:

`.gitattributes`

This should be added to:

`mapanytime-market-web`

Also remove obsolete documentation references.

---

# 47. DOCUMENTATION CLEANUP

Fix stale references including:

- Deleted payment review documents
- Non-existent TODO-NEXT references
- Removed connection-audit references
- Old "no payment gateway" statements
- Duplicate CORS findings
- Old RBAC roadmap entries
- Old nearby-store questions

Documentation should describe the current system, not historical assumptions.

---

# 48. DO NOT IMPLEMENT YET

Avoid premature implementation of:

- Multi-store combined payment
- Complex AI recommendations
- Machine-learning ranking
- Advanced loyalty tiers
- Large-scale push infrastructure
- Complicated delivery integrations
- Overly complex seller incentive rules

First prove the core transaction.

---

# 49. DEFINITION OF FINANCIAL COMPLETION

MapAnytime's financial architecture should not be considered complete until this test passes:

## Example

Buyer purchases:

Product subtotal: ₱1,000

Discount: ₱100

Eligible subtotal:

₱900

Then:

Marketplace commission

- Payment provider fee
- Buyer transaction fee
- Seller settlement
- Any applicable reward
- Any applicable agent commission

must all be explainable.

At the end:

Buyer paid amount
=

Goods +
Buyer charges

Provider captured amount
=

MapAnytime payment amount

Seller settlement
=

Seller's entitled amount

Platform ledger
=

Platform's entitled amount

Agent ledger
=

Agent's entitled amount

Reward ledger
=

Buyer reward entitlement

Everything must reconcile.

---

# 50. RECOMMENDED IMMEDIATE TASK LIST

## P0 — Do these first

[ ] Confirm actual QRPH contracted rate

[ ] Confirm actual GrabPay contracted rate

[ ] Inspect CommissionRules data

[ ] Migrate required CommissionRules into PricingComponents

[ ] Remove CommissionRules after migration verification

[ ] Verify Orders.taxAmount has no dependencies

[ ] Remove Orders.taxAmount

[ ] Confirm SETTLEMENT_HOLD_DAYS = 7 with business owner

[ ] Verify order → payment → settlement → payout reconciliation

[ ] Implement provider payment reconciliation

[ ] Complete refund provider integration

[ ] Complete refund/void payment states

---

# 51. P1 — Buyer Experience

[ ] Finish map pin → storefront experience

[ ] Finish buyer checkout on all required clients

[ ] Finish notification feed API

[ ] Implement store reviews

[ ] Implement product reviews

[ ] Implement wishlist

[ ] Verify pickup QR flow end-to-end

[ ] Verify delivery lifecycle

---

# 52. P2 — Analytics

[ ] Generate client sessionId

[ ] Attach sessionId to analytics events

[ ] Implement view deduplication

[ ] Validate analytics traffic

[ ] Implement daily rollups

[ ] Implement popularity ranking

[ ] Implement search ranking

[ ] Implement rule-based recommendations

---

# 53. P3 — Economic System

[ ] Create RewardWallet

[ ] Create RewardTransactions

[ ] Create RewardConfigurations

[ ] Implement reward earning

[ ] Implement reward redemption

[ ] Implement 20% redemption cap

[ ] Implement 12-month expiration

[ ] Create SellerCampaigns

[ ] Create SellerCampaignTransactions

[ ] Create AgentCommissionAccount

[ ] Create AgentCommissionTransactions

[ ] Create AgentPayouts

[ ] Create AgentCommissionConfigurations

[ ] Implement agent commission holding period

[ ] Implement agent payout threshold

[ ] Implement atomic multi-ledger settlement

[ ] Implement reward reversal

[ ] Implement commission reversal

[ ] Implement economic reconciliation

---

# 54. P4 — Administration & Operations

[ ] Admin invitation endpoint

[ ] Pricing configuration update endpoint

[ ] Pricing configuration validation

[ ] Pricing configuration activation

[ ] Audit logging consumer

[ ] Admin financial reporting

[ ] Payment reconciliation dashboard

[ ] Settlement dashboard

[ ] Payout dashboard

[ ] Push notifications

[ ] Environment isolation

[ ] CORS hardening

[ ] Image pipeline

---

# 55. BUSINESS RULES THAT MUST NOT CHANGE CASUALLY

The following should be treated as architectural/business decisions:

1. VAT is not charged by MapAnytime.
2. Seller tax obligations remain the seller's responsibility.
3. One pricing engine calculates platform pricing.
4. Client applications cannot determine fee payer.
5. Historical order rates are frozen.
6. Inventory reservations expire after 15 minutes.
7. Cart is currently one-store-per-checkout.
8. Payment provider webhooks are authoritative for payment completion.
9. Refunds require provider-side confirmation.
10. Financial ledgers are append-only.
11. Rewards and commissions use separate ledgers.
12. Economic reversals create negative ledger entries.
13. Seller settlement must exist before payout.
14. Payout must only use releasable settlements.
15. Admin permissions are runtime-configurable.
16. Privileged actions must eventually be auditable.

---

# 56. ARCHITECTURAL RULES FOR DEVELOPERS

## Rule 1

Do not put business logic in controllers.

Use:

Route
→ Controller
→ Service
→ Repository

---

## Rule 2

Do not calculate financial totals in clients.

The client displays server-calculated values.

---

## Rule 3

Do not duplicate pricing logic.

Use `PricingEngineService`.

---

## Rule 4

Do not delete financial records.

Use immutable ledger entries and reversal transactions.

---

## Rule 5

Do not bypass state machines.

Orders, payments, refunds, settlements and payouts must transition through validated states.

---

## Rule 6

Do not introduce a feature without its financial consequences being considered.

For example:

Promotion
→ affects order total
→ affects commission
→ may affect rewards
→ may affect agent commission
→ may affect settlement

---

# 57. FINAL RECOMMENDATION

The biggest risk for MapAnytime is no longer basic feature development.

The core marketplace infrastructure is already substantially built.

The next stage should focus on:

**FINANCIAL CORRECTNESS → TRANSACTION RELIABILITY → BUYER EXPERIENCE → ANALYTICS → ECONOMIC ECOSYSTEM → SCALE**

Do not rush into adding more features before proving that a single ₱1,000 transaction can travel through the entire system correctly.

The ideal target transaction is:

Buyer
→ discovers store
→ selects product
→ receives accurate pricing
→ pays
→ provider confirms payment
→ inventory is finalized
→ order completes
→ seller settlement is created
→ seller becomes eligible for payout
→ buyer receives rewards
→ agent receives commission if applicable
→ every ledger reconciles
→ admin can audit the entire transaction

If that flow is reliable, MapAnytime has a strong foundation for scaling.

---

# 58. IMMEDIATE NEXT SESSION

Start with this exact sequence:

1. Inspect current branch/state.
2. Run all tests.
3. Verify migrations.
4. Verify database schema.
5. Inspect `CommissionRules` data.
6. Confirm QRPH and GrabPay commercial rates.
7. Fix pricing configuration.
8. Remove obsolete `taxAmount`.
9. Verify seller settlement.
10. Build payment-provider reconciliation.
11. Complete refunds.
12. Run full financial transaction tests.
13. Only after financial correctness passes, move to buyer UX and analytics.

Do not start ECO-1 through ECO-11 until the core financial chain is verified.

---

# 59. SUCCESS CRITERIA

MapAnytime should be considered ready for serious transaction growth when:

- [ ] Pricing has one authoritative engine
- [ ] Payment provider rates are correct
- [ ] Checkout total matches gateway capture
- [ ] Inventory reservation is reliable
- [ ] Payment webhooks are reliable
- [ ] Refunds are provider-backed
- [ ] Seller settlements are created
- [ ] Settlements release correctly
- [ ] Payouts reconcile
- [ ] Payment-provider reconciliation works
- [ ] Buyer checkout is complete
- [ ] Store/product reviews work
- [ ] Notification feed works
- [ ] Analytics is deduplicated
- [ ] CORS is locked down
- [ ] Staging is isolated from production
- [ ] Financial actions are auditable
- [ ] Buyer rewards are ledger-based
- [ ] Agent commissions are ledger-based
- [ ] Reversals are implemented
- [ ] Economic balances reconcile

---

# 60. MASTER PRINCIPLE

**Build the transaction before building the ecosystem.**

MapAnytime's strongest foundation is not the number of features.

It is the ability to prove:

**ONE ORDER → ONE PAYMENT → ONE FINANCIAL TRUTH**

Everything else — rewards, commissions, advertising, analytics, recommendations and growth — should build on top of that foundation.
