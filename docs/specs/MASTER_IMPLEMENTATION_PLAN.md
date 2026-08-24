# MAPANYTIME — MASTER IMPLEMENTATION PLAN
# Complete Codebase Implementation, Hardening & Feature Roadmap

DATE: 2026-08-24
LOCATION: `mapanytime-api/docs/specs/MASTER_IMPLEMENTATION_PLAN.md`
STATUS: ACTIVE MASTER INSTRUCTION

============================================================
1. PURPOSE
============================================================

This document is the master implementation instruction for the MapAnytime
codebase.

Use this together with:

- REQUIREMENTS.md
- FLAGS.md
- MASTER_EXECUTION_PLAN.md
- NEXT-SESSION.md
- prisma/schema.prisma
- existing API routes
- existing services/repositories
- mapanytime-market-web
- mapanytime-market-app
- mapanytime-market-admin

The objective is NOT to rewrite MapAnytime.

The objective is to:

1. Preserve the existing architecture.
2. Complete missing requirements.
3. Remove obsolete/duplicate financial logic.
4. Harden financial correctness.
5. Complete payment/refund/settlement flows.
6. Build the three-domain economic system.
7. Complete analytics foundations.
8. Build rule-based recommendations.
9. Complete remaining admin/platform functionality.
10. Ensure every financial transaction can be reconciled.
11. Maintain strict architectural boundaries.
12. Keep all clients synchronized with the API contracts.

IMPORTANT:

Do not blindly implement every item immediately.

Follow the implementation order in this document.

Do not introduce duplicate business logic when an existing service already
owns the responsibility.

Do not create a second pricing engine, tax engine, settlement engine,
payment engine, reward engine, or commission engine.

============================================================
2. CURRENT CODEBASE VERDICT
============================================================

MapAnytime does NOT need a rewrite.

The existing codebase already has a strong foundation:

- PostgreSQL
- Prisma
- Redis
- RabbitMQ
- Socket.IO
- REST API
- Flutter buyer application
- Next.js web application
- Admin functionality
- RBAC
- Payment abstraction
- Pricing engine
- Inventory reservations
- Seller settlement
- Merchant advertising
- Analytics ingestion
- Notifications
- Audit infrastructure
- Correlation IDs
- Background workers
- Automated tests

The architecture should continue to follow:

Route
  ↓
Controller
  ↓
Service
  ↓
Repository
  ↓
Database

Routes must not contain business logic.

Controllers must remain thin.

Financial decisions must be made server-side.

Clients must never calculate authoritative:

- fees
- commissions
- discounts
- settlement amounts
- rewards
- agent commissions
- refunds

The server is always authoritative.

============================================================
3. NON-NEGOTIABLE ARCHITECTURAL RULES
============================================================

RULE 1 — ONE PRICING ENGINE

PricingEngineService is the only pricing authority.

Do not create another pricing engine.

All of the following must resolve through the same pricing architecture:

- goods subtotal
- item discounts
- marketplace commission
- buyer transaction fee
- provider fee
- promotional discounts
- seller-funded promotions
- platform-funded promotions
- future reward discounts

Every calculated financial component must be represented consistently.

------------------------------------------------------------

RULE 2 — IMMUTABLE FINANCIAL RECORDS

Once an order becomes financially active:

Do not mutate historical financial facts.

Freeze onto the order/payment/ledger where appropriate:

- applied rate
- provider
- payment method
- fee amount
- commission rate
- commission amount
- discount amount
- settlement amount
- refund amount

Corrections must be represented as new ledger transactions.

Never silently overwrite historical financial values.

------------------------------------------------------------

RULE 3 — IDEMPOTENCY

Payment, refund, settlement, reward and commission operations must be
idempotent.

Repeated:

- webhook
- payment callback
- refund request
- settlement execution
- reward credit
- commission credit

must never duplicate money or points.

------------------------------------------------------------

RULE 4 — ATOMIC FINANCIAL TRANSACTIONS

Where multiple financial ledgers must change together, use a single
database transaction.

Example:

Order completion:

Order completion
+ Seller settlement
+ Buyer rewards
+ Agent commission

must either all succeed or all fail.

------------------------------------------------------------

RULE 5 — PROVIDER ABSTRACTION

Payment business logic must not depend directly on PayMongo-specific
implementation.

Use:

PaymentProviderAdapter

Example:

PayMongoProvider
XenditProvider
MockProvider

The PaymentService selects the provider.

Provider-specific implementation stays inside the provider adapter.

------------------------------------------------------------

RULE 6 — NO CLIENT-SIDE AUTHORITY

The mobile and web clients may display calculated values.

They must never be trusted for:

- final amount
- fee
- commission
- discount
- refund amount
- reward amount
- agent commission

The API recalculates and validates everything.

------------------------------------------------------------

RULE 7 — NO VAT ENGINE

The previous platform VAT implementation has been retired.

MapAnytime does NOT:

- charge platform VAT
- create TAX charge rows
- hold collected VAT
- remit platform VAT

Seller-set prices are treated as seller pricing.

The seller's own tax obligations remain separate.

Do not reintroduce:

- TAX pricing components
- platform VAT calculations
- taxation service
- VAT settlement logic

BIR certificate/document handling remains part of seller onboarding/KYC.

============================================================
4. PHASE 1 — FINANCIAL FOUNDATION
============================================================

This is the highest priority phase.

Do this before implementing Rewards, Seller Campaigns, or Agent Commissions.

------------------------------------------------------------
4.1 PAYMENT PROVIDER RATES
------------------------------------------------------------

Resolve the real contracted rates for:

- QRPH
- GRAB_PAY

Do not assume the universal 2% fallback is correct.

Once the commercial rates are confirmed:

1. Add them to PricingComponents.
2. Mark them ACTIVE.
3. Apply the correct provider/method scope.
4. Add effective dates.
5. Add tests.
6. Verify checkout preview.
7. Verify payment method selection.
8. Verify order charges.
9. Verify settlement.

The fallback should only be used where intentionally permitted.

It must never silently undercharge.

------------------------------------------------------------
4.2 COMMISSIONRULES CLEANUP
------------------------------------------------------------

CommissionRules is now orphaned because the taxation engine was removed.

Before deleting it:

1. Inspect production/database data.
2. Determine whether live rates exist.
3. If rates exist:
   migrate them into PricingComponents.
4. Use:
   SELLER_MARKETPLACE_FEE
5. Preserve:
   category scope
   rate
   effective dates
   priority
   minimum/maximum constraints
6. Verify all migrated rates.
7. Add migration tests.
8. Only then drop CommissionRules.

Never drop the table before verifying that no production data is needed.

------------------------------------------------------------
4.3 REMOVE Orders.taxAmount
------------------------------------------------------------

VAT was retired.

No service should write taxAmount.

Confirm:

- no API depends on it
- no client depends on it
- no reports depend on it
- no tests depend on it

Then:

1. Remove Prisma field.
2. Create migration.
3. Update serializers/types.
4. Update tests.
5. Remove obsolete documentation.
6. Run prisma validate.
7. Run full test suite.

------------------------------------------------------------
4.4 HTTP CORS HARDENING
------------------------------------------------------------

WebSocket origin checking is already hardened.

HTTP CORS must use the same explicit allowlist philosophy.

Do NOT:

reflect arbitrary Origin headers while credentials are enabled.

Implement:

ALLOWED_ORIGINS

with explicit environments.

Example concept:

Development:
- localhost web
- localhost mobile tooling where needed

Staging:
- staging domains only

Production:
- production domains only

Verify:

- credentials
- OPTIONS requests
- allowed origin
- rejected origin
- cookies/tokens
- Socket.IO compatibility

Add automated tests.

------------------------------------------------------------
4.5 PAYMENT RECONCILIATION
------------------------------------------------------------

Implement provider reconciliation.

The system must be able to compare:

MapAnytime payment records
against
provider payment records/statements.

At minimum detect:

- missing provider payment
- missing local payment
- amount mismatch
- status mismatch
- duplicated payment
- duplicated webhook
- unexpected refund
- missing refund
- settlement mismatch

Do NOT automatically modify financial records when a mismatch is found.

Create:

RECONCILIATION_REQUIRED

or equivalent administrative state.

Record:

- provider
- provider reference
- local reference
- expected amount
- actual amount
- discrepancy
- timestamp
- resolution status

Provide admin visibility.

============================================================
5. PHASE 2 — COMPLETE REFUND SYSTEM
============================================================

Refunds are a financial priority and must be completed BEFORE Rewards and
Agent Commissions.

Current return logic calculates refundAmount but does not complete the
provider refund.

Implement the complete refund lifecycle.

------------------------------------------------------------
5.1 REFUND REQUEST
------------------------------------------------------------

Buyer can request a return/refund for an eligible order.

Request must contain:

- order ID
- reason
- requested amount where applicable
- items/quantities where applicable
- supporting information if required

The server determines the maximum refundable amount.

Never trust buyer-provided refund amount.

------------------------------------------------------------
5.2 REFUND ELIGIBILITY
------------------------------------------------------------

Validate:

- order belongs to buyer
- order state permits return
- payment is actually completed
- item/order has not already been fully refunded
- requested amount does not exceed refundable amount
- previous refund requests are respected
- return window is respected
- cancellation rules are respected

The exact return window must be configurable.

------------------------------------------------------------
5.3 REFUND APPROVAL
------------------------------------------------------------

Depending on business rules:

Buyer
  ↓
Refund request
  ↓
Seller review / Admin review
  ↓
Approved
  ↓
Provider refund
  ↓
Provider confirmation
  ↓
Local refund completion

Do not mark a refund as completed merely because the buyer requested it.

------------------------------------------------------------
5.4 REFUND STATES
------------------------------------------------------------

Implement explicit states such as:

REFUND_REQUESTED
REFUND_APPROVED
REFUND_PENDING
REFUNDED
PARTIALLY_REFUNDED
REFUND_FAILED
REFUND_REJECTED

Use the existing payment state architecture where appropriate.

Do not introduce conflicting payment/refund state machines.

------------------------------------------------------------
5.5 PROVIDER REFUND ADAPTER
------------------------------------------------------------

Payment provider interface must expose refund functionality.

Concept:

refundPayment(paymentReference, amount, idempotencyKey)

PayMongoProvider implements it.

Future XenditProvider implements it.

MockProvider implements it for tests.

Do NOT place provider-specific refund HTTP calls inside RefundService.

------------------------------------------------------------
5.6 REFUND IDEMPOTENCY
------------------------------------------------------------

Every refund must have a unique idempotency reference.

Example:

refund:{orderId}:{refundId}

Repeated attempts must not create duplicate provider refunds.

------------------------------------------------------------
5.7 PROVIDER WEBHOOK CONFIRMATION
------------------------------------------------------------

Provider refund webhooks must be:

- signature verified
- deduplicated
- correlated
- idempotent

Provider confirmation updates the local refund state.

Never assume a provider refund succeeded simply because an API request
returned successfully.

------------------------------------------------------------
5.8 REFUND LEDGER
------------------------------------------------------------

Refunds must produce immutable financial records.

Do not delete the original order charge.

Instead create reversal/refund entries.

Example:

Original:
BUYER → SELLER
₱1,000

Refund:
SELLER → BUYER
₱1,000

For partial refunds:

Refund:
SELLER → BUYER
₱400

The ledger must clearly identify:

- original order
- original charge
- refund
- payer
- beneficiary
- amount
- provider reference
- timestamp

------------------------------------------------------------
5.9 SETTLEMENT IMPACT
------------------------------------------------------------

Refunds must correctly affect seller settlement.

If settlement has not yet been released:

reduce the settlement.

If already released:

create the appropriate negative adjustment/receivable.

Never silently modify an already-paid settlement.

------------------------------------------------------------
5.10 REWARD / COMMISSION IMPACT
------------------------------------------------------------

This becomes critical when Rewards and Agent Commissions are implemented.

Refunded orders must reverse:

- buyer reward points
- seller campaign benefits where applicable
- agent commission

The reversal must be proportional.

Example:

Original eligible subtotal:
₱1,000

Reward:
10 points

50% refund:

Reward reversal:
-5 points

Agent commission must be reversed proportionally.

============================================================
6. PHASE 3 — PAYMENT PROVIDER EXPANSION
============================================================

After the existing PayMongo flow is financially stable:

Implement additional providers only when commercially required.

The architecture should support:

PaymentService
  ↓
PaymentProviderAdapter
  ├── PayMongoProvider
  ├── XenditProvider
  └── MockProvider

Adding a provider must NOT require changes to:

- checkout UI
- OrderService
- PricingEngineService
- SettlementService

unless the provider has genuinely different requirements.

Each provider must support:

- create checkout/payment
- payment status
- refund
- webhook verification
- webhook normalization

Provider-specific data stays provider-specific.

============================================================
7. PHASE 4 — SELLER SETTLEMENT & PAYOUT
============================================================

Complete the financial chain:

ORDER
 ↓
PAYMENT
 ↓
ORDER CHARGES
 ↓
SETTLEMENT
 ↓
RELEASE
 ↓
PAYOUT

------------------------------------------------------------
7.1 SETTLEMENT CREATION
------------------------------------------------------------

A paid/completed order must create the appropriate seller settlement.

Settlement must contain:

- order reference
- seller
- store
- gross amount
- marketplace commission
- payment/provider fees
- discounts where relevant
- refunds/adjustments
- net seller amount
- release eligible date
- status

------------------------------------------------------------
7.2 HOLD PERIOD
------------------------------------------------------------

Current default:

SETTLEMENT_HOLD_DAYS = 7

This is a working default, not a permanent business decision.

Make it configurable.

Do not hardcode it throughout the codebase.

------------------------------------------------------------
7.3 CASH COMMISSION NETTING
------------------------------------------------------------

Existing cash commission netting may create a negative settlement.

Keep it.

However, handle the edge case:

Seller only accepts cash.

If the seller never receives gateway-funded payouts, negative balances can
continue indefinitely.

Implement a future receivable/balance mechanism or clearly flag it for
admin collection.

Do not silently lose the platform's commission.

============================================================
8. PHASE 5 — BUYER REWARDS
============================================================

Implement the Buyer Reward ledger.

Models:

RewardWallet
RewardTransactions
RewardConfigurations

------------------------------------------------------------
8.1 EARNING
------------------------------------------------------------

Default business rule:

1 Reward Point per ₱100 eligible product subtotal.

Exclude:

- buyer transaction fees
- payment processing fees
- taxes
- non-eligible charges

Example:

Eligible subtotal = ₱1,000

Reward = 10 points.

Make earn rate configurable.

------------------------------------------------------------
8.2 REDEMPTION
------------------------------------------------------------

Default:

100 points = ₱10

Therefore:

1 point = ₱0.10

Maximum redemption:

20% of eligible order subtotal.

Server validates all redemption calculations.

------------------------------------------------------------
8.3 EXPIRATION
------------------------------------------------------------

Points expire on a rolling 12-month basis.

Expiration must create an explicit ledger transaction:

-EXPIRATION

Never simply delete expired points.

------------------------------------------------------------
8.4 SPENDING SAFETY
------------------------------------------------------------

Point spending must be concurrency-safe.

Never allow:

balance < 0

Use transactional locking or atomic conditional updates.

Two simultaneous checkouts must not spend the same points.

------------------------------------------------------------
8.5 REWARD REVERSAL
------------------------------------------------------------

Cancelled/refunded orders must reverse earned rewards.

Create:

-REVERSAL

entries.

Do not delete the original earning transaction.

============================================================
9. PHASE 6 — SELLER CAMPAIGNS
============================================================

Implement:

SellerCampaigns
SellerCampaignTransactions

Purpose:

Allow sellers to fund promotional reward campaigns.

Examples:

- Buy from this seller and receive bonus points.
- Double reward points.
- Category-specific reward campaign.
- Product-specific reward campaign.

Every campaign must specify:

- seller
- store where applicable
- products/categories
- start/end
- budget
- reward rule
- funding source
- status

Seller-funded campaigns must be distinguishable from platform-funded
promotions.

============================================================
10. PHASE 7 — AGENT COMMISSIONS
============================================================

Implement:

AgentCommissionAccount
AgentCommissionTransactions
AgentPayouts
AgentCommissionConfigurations

------------------------------------------------------------
10.1 COMMISSION
------------------------------------------------------------

Default working rate:

0.05% of GMV

This must be configurable.

Do not hardcode the percentage.

------------------------------------------------------------
10.2 HOLDING PERIOD
------------------------------------------------------------

Commission should not immediately become withdrawable.

Use a maturity/holding period to account for:

- cancellation
- return
- refund
- fraud review

States may include:

PENDING
MATURED
REVERSED
PAID

------------------------------------------------------------
10.3 AGENT PAYOUT
------------------------------------------------------------

Agent requests payout when:

available commission >= configured minimum threshold.

Supported payout destinations may include:

- bank
- GCash

where operationally available.

Admin approval may be required.

============================================================
11. PHASE 8 — ATOMIC TRI-DOMAIN ECONOMIC TRANSACTION
============================================================

OrderService.completeOrder() becomes the atomic financial boundary.

Concept:

transaction {

    complete order

    create/update seller settlement

    calculate buyer rewards

    create RewardTransaction

    calculate agent commission

    create AgentCommissionTransaction

}

All succeed together.

All rollback together.

Do NOT publish irreversible external financial events inside a database
transaction without an outbox/event strategy.

Use the existing RabbitMQ/event architecture where necessary.

============================================================
12. PHASE 9 — ANALYTICS FOUNDATION
============================================================

Implement Phase 2 analytics only.

Do NOT prematurely build complex AI recommendations.

------------------------------------------------------------
12.1 SESSION ID
------------------------------------------------------------

Web and mobile clients must generate a sessionId.

The client sends it with analytics events.

Do not use user ID as the only identity because anonymous buyers must also
be measurable.

------------------------------------------------------------
12.2 VIEW DEDUPLICATION
------------------------------------------------------------

Repeated views of the same product by the same session within the configured
window should not inflate the view count.

Example:

Session A
Product X
20 page opens
within deduplication window

Count:

1 view

not:

20 views.

------------------------------------------------------------
12.3 BATCH INGESTION
------------------------------------------------------------

Continue using asynchronous analytics ingestion.

Do not make analytics processing block checkout or core transactions.

------------------------------------------------------------
12.4 FUTURE ANALYTICS
------------------------------------------------------------

Deferred until real traffic exists:

- daily rollups
- popularity ranking
- trending
- recommendation ranking
- advanced personalization

============================================================
13. PHASE 10 — RECOMMENDATION SYSTEM
============================================================

Recommendations should start RULE-BASED.

Do NOT start with an expensive AI/ML recommendation engine.

The first version should use actual marketplace signals.

Build:

Most Viewed
Trending
Most Engaged
Best Selling
Best Converting

------------------------------------------------------------
13.1 MOST VIEWED
------------------------------------------------------------

Rank by deduplicated product views.

Signals:

- views
- unique sessions
- time window

------------------------------------------------------------
13.2 TRENDING
------------------------------------------------------------

Use velocity rather than absolute lifetime totals.

Example:

Product A:
100 views last month
10 views today

Product B:
20 views last month
50 views today

Product B should trend higher.

------------------------------------------------------------
13.3 MOST ENGAGED
------------------------------------------------------------

Signals:

- product views
- product detail opens
- cart additions
- wishlist additions
- purchases

Use weighted scoring.

------------------------------------------------------------
13.4 BEST SELLING
------------------------------------------------------------

Signals:

- completed units
- completed orders
- eligible GMV

Do not count cancelled/refunded orders as successful sales.

------------------------------------------------------------
13.5 BEST CONVERTING
------------------------------------------------------------

Conversion:

completed purchases / qualified product views

Protect against small-sample distortion.

Require minimum observations.

------------------------------------------------------------
13.6 PERSONALIZED RECOMMENDATIONS
------------------------------------------------------------

Later phase.

Possible signals:

- viewed categories
- purchased categories
- stores visited
- search behavior
- price range
- geographic proximity
- interaction history

Start rule-based.

Machine learning is optional later.

============================================================
14. PHASE 11 — MAP DISCOVERY COMPLETION
============================================================

Complete:

MAP-2

Tapping a map pin must show:

- store name
- distance
- store status
- sponsored indicator if applicable
- storefront entry

MAP-3:

Ensure sponsored ads are actually consumed by the client.

Sponsored pins must:

- respect radius
- respect campaign schedule
- respect budget
- be clearly labeled sponsored

Do not disguise advertising as organic discovery.

============================================================
15. PHASE 12 — REVIEWS & WISHLISTS
============================================================

Implement missing APIs for:

StoreReviews
ProductReviews
Wishlists
WishlistItems

Rules:

Only eligible buyers can review purchased products.

Prevent duplicate reviews unless explicitly allowing edits.

Reviews must be tied to actual purchase history.

Wishlist operations must be authenticated.

============================================================
16. PHASE 13 — NOTIFICATIONS
============================================================

Complete notification feed API.

Users must be able to:

- list notifications
- mark one read
- mark all read
- retrieve unread count

Keep notification generation asynchronous where possible.

Implement push notifications after the core financial system is stable.

Do not make push delivery a prerequisite for completing a payment.

============================================================
17. PHASE 14 — ADMIN COMPLETION
============================================================

Complete:

ID-5:
Admin invite endpoint.

Admin invitations require:

- token
- expiry
- status
- invited email
- role
- acceptance timestamp

ADM-3:

Wire category management UI to the real API.

ADM-4:

Complete audit logging for privileged actions.

ADM-6:

Decide on the final admin architecture.

Do not maintain two competing admin applications indefinitely.

Choose:

- web admin as the primary admin
OR
- dedicated admin application

Then deprecate the unused one.

============================================================
18. PHASE 15 — PRODUCTION HARDENING
============================================================

Complete:

PLT-10:

Staging must be isolated from production.

Do not share:

- container names
- ports
- networks
- production database
- production Redis
- production RabbitMQ
- production secrets

PLT-11:

Complete product image serving.

Ensure:

- real product images
- CDN/object storage where appropriate
- Next.js image configuration
- secure image URLs
- correct caching

============================================================
19. AUDIT & SECURITY
============================================================

Review:

Authentication
Authorization
RBAC
CORS
Rate limiting
Webhook verification
Payment access
Order access
Seller ownership
Admin privileges
File uploads
Image uploads
Secrets
JWT/session invalidation
Correlation IDs
Audit logging

Every privileged financial action must be auditable.

============================================================
20. TESTING REQUIREMENTS
============================================================

Every implementation must add or update tests.

Minimum categories:

UNIT TESTS

- pricing
- discounts
- fees
- refunds
- settlements
- rewards
- agent commissions
- permissions

INTEGRATION TESTS

- checkout
- payment
- webhook
- refund
- settlement
- payout

CONCURRENCY TESTS

- inventory reservation
- inventory adjustment
- reward redemption
- duplicate webhook
- duplicate refund
- duplicate commission

FINANCIAL TESTS

Verify:

order total
=
goods
+ fees
- discounts

And:

seller settlement
+
platform fees
+
provider costs
+
refund adjustments
=
financially explainable order result

No unexplained money may appear or disappear.

============================================================
21. FINANCIAL INVARIANTS
============================================================

These must always hold.

1. Payment cannot exceed the authoritative order total unless explicitly
   represented as an overpayment/refund state.

2. Refund cannot exceed captured payment.

3. Total refunds cannot exceed captured amount.

4. Seller settlement cannot exceed the seller's eligible proceeds.

5. Marketplace commission is calculated from the defined eligible goods
   subtotal.

6. Buyer transaction fee follows the configured provider/method rate.

7. Reward points cannot become negative.

8. Agent commission cannot become negative because of duplicate processing.

9. Repeated provider webhooks cannot duplicate financial records.

10. Repeated completion calls cannot duplicate settlement/reward/commission.

11. Historical financial rates cannot change after an order has been priced.

12. Tax/VAT must not reappear as a platform charge.

============================================================
22. DOCUMENTATION CLEANUP
============================================================

Fix stale documentation.

Remove references to:

- nonexistent payments-rework-review.md
- nonexistent TODO-NEXT API document
- nonexistent connection-audit.md

Correct stale statements:

- "There is no payment gateway"
- RBAC still being TODO
- old nearby-store endpoint questions
- duplicate CORS findings

Requirements documentation must describe:

WHAT THE SYSTEM SHOULD DO.

FLAGS.md must describe:

WHAT IS CURRENTLY WRONG.

Do not mix those responsibilities.

============================================================
23. DATABASE MIGRATION RULES
============================================================

Never make destructive migrations casually.

Before dropping:

- CommissionRules
- Orders.taxAmount
- obsolete fields
- obsolete tables

perform:

1. Search all source references.
2. Search all tests.
3. Search all clients.
4. Inspect production data.
5. Export/backup if necessary.
6. Migrate useful data.
7. Run migration in staging.
8. Validate.
9. Only then production.

============================================================
24. CLIENT SYNCHRONIZATION
============================================================

Whenever an API contract changes:

Update:

- Flutter datasource
- Flutter models
- Flutter providers
- Flutter UI
- Web API client
- Web hooks
- Web UI
- Admin UI where applicable

Do not leave dead client APIs.

Remove dead code when the corresponding backend capability is removed.

============================================================
25. IMPLEMENTATION ORDER
============================================================

FOLLOW THIS ORDER.

P0 — FINANCIAL FOUNDATION

1. Confirm QRPH rate.
2. Confirm GrabPay rate.
3. Seed contracted rates.
4. Migrate CommissionRules.
5. Remove Orders.taxAmount.
6. Harden HTTP CORS.
7. Verify settlement creation.
8. Verify payout chain.
9. Implement payment reconciliation.

P0 — REFUNDS

10. Refund state machine.
11. Refund request.
12. Refund approval.
13. Provider refund adapter.
14. PayMongo refund implementation.
15. Refund webhook handling.
16. Refund ledger entries.
17. Settlement adjustment.
18. Refund idempotency.
19. Refund tests.

P1 — PAYMENT EXPANSION

20. Provider abstraction review.
21. Xendit adapter only if commercially required.
22. Xendit payment flow.
23. Xendit webhook.
24. Xendit refund.
25. Provider reconciliation.

P1 — ECONOMIC SYSTEM

26. RewardWallet.
27. RewardTransactions.
28. RewardConfigurations.
29. Reward earning.
30. Reward redemption.
31. Reward expiration.
32. Reward reversal.
33. SellerCampaigns.
34. SellerCampaignTransactions.
35. AgentCommissionAccount.
36. AgentCommissionTransactions.
37. AgentPayouts.
38. AgentCommissionConfigurations.
39. Atomic completion transaction.
40. Economic reconciliation.

P1 — CORE MARKETPLACE COMPLETION

41. Store reviews.
42. Product reviews.
43. Wishlists.
44. Notification feed.
45. Admin invitations.
46. Admin category UI.
47. Audit logging.

P2 — ANALYTICS

48. sessionId.
49. event session tracking.
50. view deduplication.
51. analytics tests.

P2 — RECOMMENDATIONS

52. Most viewed.
53. Trending.
54. Most engaged.
55. Best selling.
56. Best converting.
57. Rule-based recommendation API.
58. Recommendation UI.

P3 — ADVANCED

59. Daily rollups.
60. Personalized recommendations.
61. Push notifications.
62. Advanced recommendation models.
63. Advanced seller intelligence.

P0/P1 — PRODUCTION HARDENING

64. Staging isolation.
65. Image pipeline.
66. Security audit.
67. Financial reconciliation dashboard.
68. Final end-to-end tests.

============================================================
26. DEFINITION OF DONE
============================================================

A feature is NOT DONE merely because:

- the database model exists
- the service exists
- an API exists
- a screen exists
- a test exists

A feature is DONE when:

DATABASE
✓ Schema is correct
✓ Migration exists
✓ Data integrity is preserved

BACKEND
✓ Route exists
✓ Controller exists
✓ Service exists
✓ Repository exists where required
✓ Authorization exists
✓ Validation exists
✓ Error handling exists
✓ Idempotency exists where required

CLIENT
✓ API contract is consumed
✓ Loading state
✓ Error state
✓ Empty state
✓ Success state
✓ Correct financial display

TESTING
✓ Unit tests
✓ Integration tests
✓ Failure tests
✓ Concurrency tests where relevant

OPERATIONS
✓ Logs
✓ Correlation ID
✓ Audit trail where relevant
✓ Monitoring/reconciliation where financial

DOCUMENTATION
✓ Requirements updated
✓ Flags updated
✓ Obsolete documentation removed

============================================================
27. IMPORTANT IMPLEMENTATION BEHAVIOR
============================================================

When implementing any task:

FIRST:

Inspect the current code.

SECOND:

Identify existing services, repositories, models, routes and tests.

THIRD:

Reuse existing architecture.

FOURTH:

Make the smallest safe change.

FIFTH:

Add tests.

SIXTH:

Run:

- Prisma validation
- TypeScript
- ESLint
- API tests
- Flutter analyze/tests where affected
- Next build where affected

SEVENTH:

Only after everything passes, update documentation.

Do not rewrite functioning systems simply to make them look different.

============================================================
28. FINAL ARCHITECTURAL TARGET
============================================================

The final MapAnytime architecture should conceptually be:

                    BUYER
                      |
              Web / Flutter
                      |
                      v
                 API Gateway
                      |
       +--------------+--------------+
       |              |              |
     Orders        Payments       Catalog
       |              |              |
       v              v              v
   PricingEngine  ProviderAdapter  Inventory
       |              |
       |       +------+------+
       |       |             |
       |    PayMongo       Xendit
       |
       v
 Financial Transaction
       |
       +-----------------------------+
       |             |               |
       v             v               v
  Settlement      Rewards       Agent Commission
       |             |               |
       v             v               v
     Payout       Reward Wallet   Agent Wallet
       
       |
       v
 Immutable Financial Records

And asynchronously:

RabbitMQ
   |
   +--> Notifications
   +--> Email
   +--> Analytics
   +--> Reconciliation
   +--> Background Jobs

Discovery:

Map
 |
 +--> Nearby Stores
 +--> Sponsored Ads
 +--> Products
 +--> Analytics Signals
 +--> Recommendations

============================================================
29. FINAL RECOMMENDATION
============================================================

Do NOT rewrite MapAnytime.

Do NOT add another architecture layer unless there is a real requirement.

Do NOT add AI recommendations before analytics data is reliable.

Do NOT implement Rewards before refunds and reversals are correct.

Do NOT implement Agent Commissions before settlement/reconciliation is
financially reliable.

Do NOT add another pricing engine.

Do NOT reintroduce VAT.

Do NOT trust client-side financial calculations.

Do NOT delete financial tables until their production data has been reviewed.

The priority is:

FINANCIAL CORRECTNESS
        ↓
PAYMENT + REFUND RELIABILITY
        ↓
SETTLEMENT + RECONCILIATION
        ↓
BUYER REWARDS
        ↓
SELLER CAMPAIGNS
        ↓
AGENT COMMISSIONS
        ↓
ANALYTICS
        ↓
RULE-BASED RECOMMENDATIONS
        ↓
ADVANCED FEATURES

The existing MapAnytime foundation is strong enough to continue development.

The goal now is not more architecture.

The goal is COMPLETION, FINANCIAL CORRECTNESS, RECONCILIATION,
SECURITY, AND PRODUCTION READINESS.

============================================================
30. MASTER SUCCESS CRITERIA
============================================================

MapAnytime should ultimately be able to explain every peso.

For every completed order, the system must be able to answer:

1. What did the buyer purchase?
2. What was the goods subtotal?
3. What discounts were applied?
4. Who funded each discount?
5. What payment method was used?
6. What provider processed it?
7. What provider fee was charged?
8. What buyer transaction fee was charged?
9. What marketplace commission was charged?
10. What amount belongs to the seller?
11. When does the seller become eligible for settlement?
12. Was a refund requested?
13. Was a refund approved?
14. Was money actually refunded by the provider?
15. How much was refunded?
16. Was the seller settlement adjusted?
17. Did the buyer receive reward points?
18. Were reward points later reversed?
19. Did an agent receive commission?
20. Was agent commission reversed after a refund?
21. Was the seller paid?
22. What payout reference was used?
23. Can all of this be reconciled against the payment provider?

If the answer to all of these can be obtained from the system's records,
MapAnytime has a proper financial foundation.

END OF MASTER IMPLEMENTATION PLAN
