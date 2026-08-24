# MapAnytime — Features & System Flows

Comprehensive architecture, feature breakdown, and end-to-end user journeys for the **MapAnytime** marketplace platform.

---

## 1. System Overview & Core Personas

MapAnytime is a map-first local commerce and property marketplace for the Philippines. It connects buyers, merchants, real estate sellers, agents, and platform administrators through a centralized backend API, web portal, and mobile application.

```
                                  ┌─────────────────────────────┐
                                  │      MapAnytime API         │
                                  │   (Express, Prisma, PG)     │
                                  └──────────────┬──────────────┘
                                                 │
          ┌──────────────────────┬───────────────┴───────────────┬──────────────────────┐
          │                      │                               │                      │
┌─────────▼───────────┐ ┌────────▼────────────┐       ┌──────────▼──────────┐ ┌─────────▼───────────┐
│   Mobile App        │ │   Web Marketplace   │       │   Seller Dashboard  │ │   Admin Portal      │
│ (Flutter / Buyer)   │ │  (Next.js / Buyer)  │       │  (Next.js / Seller) │ │(Next.js / Operations)│
└─────────────────────┘ └─────────────────────┘       └─────────────────────┘ └─────────────────────┘
```

### User Personas & Roles

| Persona                | Role Key                | Primary Responsibilities & Capabilities                                                                                                                                                                            |
| :--------------------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Buyer**              | `BUYER` / `USER`        | Geolocation discovery, storefront browsing, cart management, checkout & digital payments, pickup pass redemption, order & shipment tracking.                                                                       |
| **Seller / Merchant**  | `SELLER`                | Onboarding & verification, managing multiple stores/branches, product catalog & variant configuration, inventory management, merchant promotions & ads, order queue processing.                                    |
| **Real Estate Seller** | `SELLER`                | Listing properties (house-and-lot, raw land) with legal title docs, pricing structures, terrain metadata, and viewing dedicated property dashboards.                                                               |
| **Agent / Recruiter**  | `AGENT`                 | Onboarding and recruiting merchants/sellers, tracking onboarding progress and recruit pipelines.                                                                                                                   |
| **Administrator**      | `ADMIN` / `SUPER_ADMIN` | Store and property KYC approval queues, dynamic RBAC permission management, category tree administration, pricing engine fee rule configuration, platform analytics, mobile app release & force-update governance. |

---

## 2. Feature Matrix by Domain

### 2.1 Identity, Access & Governance (ID & ADM)

- **Multi-Method Auth**: Email/password registration and Google OAuth 2.0 integration.
- **Session & Token Management**: JWT-based access tokens with refresh token rotation and server-side invalidation on logout.
- **Dynamic RBAC**: Runtime role-to-permission resolution where administrators can configure fine-grained endpoint grants without redeploying code.
- **Account State Machine**: Account lifecycle management (`ACTIVE`, `SUSPENDED`, `PENDING_VERIFICATION`).
- **App Release Control**: Mobile version registry supporting min-version checks and mandatory forced-update gates for Flutter client releases.
- **Audit Logging**: Structured event logging for sensitive administrative actions.

### 2.2 Store & Merchant Management (STO)

- **Seller Capacity Declaration**: Support for `OWNER`, `BROKER`, and `PROXY` operating models.
- **KYC & Document Verification**: Submission of BIR registration certificates, government IDs, and operational permits.
- **Store Approval Workflow**: Multi-state approval pipeline (`PENDING`, `APPROVED`, `REJECTED`) with rejection reason tracking.
- **Multi-Store Tenancy**: A single merchant account can own, operate, and switch between multiple distinct physical store locations.
- **Store Profiles**: Configurable daily operating hours, GPS coordinates (latitude/longitude), contact numbers, branding banners, and logos.

### 2.3 Map & Discovery Engine (MAP & ADS)

- **Radius-Based Store Search**: Geolocation spatial querying (`GET /stores/nearby`) allowing buyers to discover active stores within configurable distance radiuses (1–50 km).
- **Interactive Storefront Pins**: Map pins displaying store distance, operating status (open/closed), and fast navigation into store catalogs.
- **Sponsored Proximity Ads**: Proximity-targeted merchant advertising pins highlighting deals and featured sellers within the buyer's vicinity.
- **Storefront Landing Pages**: Store-specific web and mobile landing pages featuring curated collections, operating hours, and verified badges.

### 2.4 Catalog & Inventory Management (CAT & INV)

- **Rich Product Catalog**: Multi-image galleries, hierarchical category mapping, tags, pricing, and stock visibility (`PUBLISHED`, `DRAFT`, `ARCHIVED`).
- **Options & Variants**: Matrix generation for product options (e.g., Size, Color) with distinct SKUs, prices, and variant-specific inventory.
- **AI-Assisted Listing Ingestion**: Background image-to-listing parsing queue (`/seller/ai-upload`) to extract listing metadata automatically.
- **Supplier Product Sourcing**: Linking supplier catalog items to merchant inventory for drop-shipping or distribution.
- **Concurrency-Safe Inventory**: Optimistic locking (`version` column) for stock adjustments and restocks.
- **Time-Bound Reservations**: Automatic 15-minute stock hold upon order placement, with background scheduled sweep releasing expired holds.

### 2.5 Real Estate & Property Listings (PROP)

- **Structured Real Estate Schema**: Specialized metadata fields for house-and-lot and raw-land properties (terrain type, furnishing, title classification, negotiability, tax declaration responsibilities).
- **Property Document Attachment**: Uploading and association of land titles, blueprints, and tax certifications.
- **Property Verification Lifecycle**: Two-stage approval (`DRAFT` → `PENDING_REVIEW` → `ACTIVE` / `REJECTED`).
- **Property Seller Dashboard**: Dedicated property-specific view tracking buyer inquiries, listing engagement, and status.

### 2.6 Cart & Pricing Engine (CART & FEE)

- **Single-Store Cart Isolation**: Guardrails ensuring items in a single cart session belong to one unique store.
- **Multi-Tiered Pricing Engine**:
  - Versioned and effective-dated pricing rules.
  - Granular fee components scoped by payment provider, payment method, product category, store tier, or seller subscription.
  - Platform commission calculated on goods subtotal (2.00%) — the platform's only revenue line.
  - **Per-method buyer transaction fee**: the contracted PayMongo rate for the method the buyer actually chose — GCash 2.23%, Maya 1.79%, domestic card 3.125% + ₱13.39, cash 0% — passed through in full. There is no platform margin on top; the fee is cost recovery, not revenue.
  - **Gross-up**: the fee is charged as `(amount × rate + fixed) / (1 − rate × buyerShare)`, because the gateway bills against the captured total rather than the goods total. Without it the platform is short by `fee × rate` on every transaction.
  - **Method availability**: `PaymentMethods.minOrderAmount` / `maxOrderAmount` gate a method by basket size. Cards carry a ₱500 floor — a ₱13.39 flat fee is 17% of a ₱100 order.
- **No Tax Handling**: MapAnytime is a marketplace intermediary and never takes title to the goods, so it charges, holds and remits no VAT — output VAT is the seller's own liability against their own BIR registration. Listed prices are seller-set and tax-inclusive.
- **Discount & Promotion Pipeline**: Item-level percentage discounts, BOGO (Buy One Get One), flash sales, and platform voucher calculations.

### 2.7 Checkout, Payments & Settlements (PAY & LED)

- **Dynamic Payment Provider Architecture**: Data-driven payment provider model supporting multiple gateways (PayMongo for GCash, Maya, Cards, and local banks).
- **Idempotent Webhook Processing**: Cryptographic signature validation, event deduplication, and transactional state transition on `payment.paid` webhooks.
- **Immutable Charge Ledger (`OrderCharges`)**: Detailed double-entry style charge lines capturing exact payer and beneficiary pairs (`BUYER` → `PLATFORM`, `BUYER` → `MERCHANT`, `MERCHANT` → `PLATFORM`).
- **Rate Freezing**: Snapshots of platform fee rates and payment provider rates frozen directly onto the order record at creation time.
- **Settlement & Payout Batching**: Aggregation of cleared order funds into merchant settlement batches with release eligibility dates.

### 2.8 Order Lifecycle & Fulfillment (ORD)

- **Fulfillment Modes**: Dual support for **Store Pickup** (with scheduled pickup windows) and **Delivery** (with shipping address snapshotting).
- **Order State Machine**: Strict status transitions (`PENDING_PAYMENT` → `PAID` → `CONFIRMED` → `PREPARING` → `READY_FOR_PICKUP` / `SHIPPED` → `COMPLETED` / `CANCELLED`).
- **Digital Pickup Pass**: Mobile/web QR and code-based verification pass shown by the buyer at the physical store counter.
- **Shipment Tracking**: Multi-stage shipment tracking with carrier names, tracking numbers, and delivery confirmation.

### 2.9 Real-Time Communications & Async Workers (NTF & PLT)

- **WebSocket Gateway**: Real-time push updates for instant payment confirmations, order status changes, and notifications.
- **Background Event Consumers**: RabbitMQ-backed asynchronous worker processing for email delivery, notifications, and analytics ingestion.
- **Scheduled Workers**: Cron engines for releasing expired inventory reservations, evaluating matured seller payouts, and auto-cancelling stale unpaid checkouts.

### 2.10 Tri-Domain Economic Architecture — Rewards, Incentives & Commissions (ECO)

- **Three Separate Economic Ledgers**:
  1. **Buyer Loyalty (`RewardWallet` + `RewardTransactions`)**: Customer reward points earned on purchases (₱100 = 1 pt), reviews, referrals, and store visits. Redeemable for checkout discounts (100 pts = ₱10, max 20% cap). 12-month rolling expiration. Not cash.
  2. **Seller Incentives (`SellerCampaigns` + `SellerCampaignTransactions`)**: Merchant-funded marketing budgets to distribute Reward Points to buyers (e.g. "Spend ₱500 get 50 pts") with ROI analytics (GMV generated, new vs repeat customers).
  3. **Agent Commissions (`AgentCommissionAccount` + `AgentCommissionTransactions` + `AgentPayouts`)**: Real Philippine Peso (₱) commission earned by Agents when recruited merchants complete sales (e.g. 0.05% of GMV). Held in pending during the refund window before maturing for withdrawal.
- **In-Transaction Multi-Ledger Settlement**: When an order reaches `ORDERSTATUS.COMPLETED`, the single atomic Prisma `$transaction` executes:
  - Updates Order status to `COMPLETED`
  - Creates Seller Settlement (platform owes merchant)
  - Credits Buyer Reward Points (`PURCHASE`, 12m expiry)
  - Credits Agent Commission to pending (`SALE_COMMISSION`, maturing in 7 days)
  - All-or-nothing rollback; zero RabbitMQ dependency for core financial ledgers.
- **Dynamic Administration**: `RewardConfigurations` and `AgentCommissionConfigurations` allow Admins to modify earning rates, redemption caps, and commission rates in real time without code redeployments.
- **Reconciliation & Auditing**: Scheduled crons verify wallet and commission account balances against ledger sums, logging alerts for any discrepancy.

---

## 3. Detailed End-to-End System Flows

### Flow 1: User Registration & Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User (Buyer/Seller/Agent)
    participant Client as Client (Web / Mobile)
    participant API as MapAnytime API
    participant DB as PostgreSQL DB
    participant Redis as Redis Cache

    User->>Client: Enters Email & Password / Google OAuth
    Client->>API: POST /v1/auth/login or /v1/auth/register
    API->>DB: Query User & Role Permissions
    API->>API: Verify Password Hash / OAuth Token
    API->>DB: Create Session record
    API->>Redis: Cache User Session & Active Tokens
    API-->>Client: Return Access Token (JWT), Refresh Token (HttpOnly Cookie) & User Profile
    Client-->>User: Navigate to Role Dashboard (Buyer Map / Seller Portal / Admin)
```

---

### Flow 2: Seller Onboarding & Store Verification Flow

```mermaid
sequenceDiagram
    autonumber
    actor Seller as Seller / Merchant
    participant Web as Seller Web Portal
    participant API as MapAnytime API
    participant S3 as Storage / Documents
    participant DB as PostgreSQL DB
    actor Admin as Platform Admin

    Seller->>Web: Fill Store Profile (Name, Coordinates, Hours, Capacity)
    Seller->>Web: Upload KYC Documents (BIR Certificate, Gov ID, Titles)
    Web->>API: POST /v1/stores (Create Store)
    API->>S3: Persist Uploaded Document Files
    API->>DB: Insert Store (status: PENDING) & Documents records
    API-->>Web: Store Created (Pending Approval state)

    Admin->>API: GET /v1/admin/approvals (Review queue)
    API->>DB: Fetch pending stores and attached KYC documents
    Admin->>API: PATCH /v1/admin/approvals/stores/:id (Approve / Reject)
    API->>DB: Update Store status to APPROVED (or REJECTED with reason)
    API-->>Seller: Realtime / Email notification of store verification status
```

---

### Flow 3: Buyer Map Discovery & Storefront Browsing Flow

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer
    participant App as Mobile App / Web
    participant API as MapAnytime API
    participant DB as PostgreSQL (Spatial Query)
    participant Ads as Ad Engine

    Buyer->>App: Opens Map View (Grants Location Access)
    App->>API: GET /v1/stores/nearby?lat=14.5995&lng=120.9842&radius=10
    App->>API: GET /v1/merchant-ads/nearby?lat=14.5995&lng=120.9842
    API->>DB: Execute spatial distance calculation for APPROVED stores
    API->>Ads: Fetch active promoted pins & sponsored campaigns
    API-->>App: Return nearby store pins + sponsored deal badges
    App-->>Buyer: Render interactive pins on map with distance & status
    Buyer->>App: Tap Store Pin -> Click "View Storefront"
    App->>API: GET /v1/stores/:id/catalog
    API-->>App: Return store info, categories, and published products
    App-->>Buyer: Render Storefront page with products & operating hours
```

---

### Flow 4: Product Listing & AI-Assisted Upload Flow

```mermaid
sequenceDiagram
    autonumber
    actor Seller as Seller
    participant Portal as Seller Portal
    participant API as MapAnytime API
    participant Rabbit as RabbitMQ Topic Exchange
    participant Worker as AI Consumer Worker
    participant DB as PostgreSQL DB

    alt Standard Manual Upload
        Seller->>Portal: Input Name, Description, Categories, Variants (Sizes/Colors), Prices, Stock
        Portal->>API: POST /v1/products (with variants & images)
        API->>DB: Create Product, Options, OptionValues, and Inventory records
        API-->>Portal: Product Created & Live
    else AI-Assisted Photo Upload
        Seller->>Portal: Upload Product Images & Receipt/Specs photo
        Portal->>API: POST /v1/seller/ai-upload
        API->>Rabbit: Publish 'ai.upload.requested' event
        API-->>Portal: Return Job ID (Processing)
        Worker->>Rabbit: Consume 'ai.upload.requested'
        Worker->>Worker: Parse images, detect title, brand, category, suggested pricing
        Worker->>DB: Save draft product listing
        Worker-->>Portal: Push WebSocket notification 'Job Completed'
        Seller->>Portal: Review AI-filled draft -> Click Publish
    end
```

---

### Flow 5: Cart, Stock Reservation & Pricing Preview Flow

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer
    participant Client as Web / Mobile Client
    participant API as MapAnytime API
    participant Engine as Pricing Engine
    participant DB as PostgreSQL DB

    Buyer->>Client: Add Product / Variant to Cart
    Client->>API: POST /v1/cart/items (Item, Quantity, StoreId)
    API->>DB: Verify Store isolation (Ensure items belong to single store)
    API->>DB: Check on-hand inventory availability
    API-->>Client: Updated Cart

    Buyer->>Client: Proceed to Checkout Preview
    Client->>API: POST /v1/cart/preview-pricing
    API->>Engine: Run PricingEngine
    Engine->>Engine: 1. Calculate Gross Item Subtotal
    Engine->>Engine: 2. Apply Item Discounts (BOGO, Flash sale, Promos)
    Engine->>Engine: 3. Compute Marketplace Commission
    Note over Engine: No tax step — the platform collects no VAT.<br/>No payment fee either: no method is chosen yet.
    API-->>Client: Goods breakdown (Subtotal, Discounts, Order total)

    Buyer->>Client: Choose how to pay
    Client->>API: GET /v1/payments/methods?amount=<order total>
    API->>Engine: Price each active method at its contracted rate
    API-->>Client: Per method — fee, buyer total, or why it is unavailable
    Note over Client: Methods outside their order-amount bounds are<br/>shown disabled with the reason, e.g. cards below P500
```

---

### Flow 6: Order Creation, PayMongo Payment & Webhook Execution Flow

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer
    participant App as Mobile / Web App
    participant API as MapAnytime API
    participant Gateway as PayMongo Gateway
    participant DB as PostgreSQL DB
    actor Seller as Merchant

    Buyer->>App: Click "Place Order & Pay"
    App->>API: POST /v1/orders (Cart, FulfillmentType, DeliveryAddress/PickupTime)

    rect rgb(240, 248, 255)
        note over API,DB: Transactional Order Creation & Inventory Lock
        API->>DB: Create Order (status: PENDING_PAYMENT)
        API->>DB: Create InventoryReservation (15-minute lock on reserved stock)
        API->>DB: Freeze Fee Rates & Snapshot Store Contact/Address
        API->>Gateway: Create Hosted Checkout Session / Payment Intent
        Gateway-->>API: Return Checkout URL & Payment Intent ID
    end

    API-->>App: Return Payment URL
    App-->>Buyer: Redirect to PayMongo Hosted Page (GCash / Maya / Card)
    Buyer->>Gateway: Authorizes & Completes Payment

    rect rgb(245, 255, 245)
        note over Gateway,API: Webhook Processing (Off Request Path)
        Gateway->>API: POST /v1/payments/webhook (Signature Header, event: payment.paid)
        API->>API: Verify Webhook HMAC Signature
        API->>DB: Check Webhook Idempotency (prevent double processing)
        API->>DB: Update Payment status to COMPLETED
        API->>DB: Transition Order to PAID
        API->>DB: Convert InventoryReservation to committed InventoryMovement
        API->>DB: Insert immutable OrderCharges rows (Buyer, Merchant, Platform, Gateway)
        API-->>Gateway: HTTP 200 OK
    end

    API-->>App: Push Realtime WebSocket event: 'order.paid'
    API-->>Seller: Push Realtime notification: 'New Order Received'
```

---

### Flow 7: Order Fulfillment — Pickup Pass vs. Delivery Shipping

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer
    actor Seller as Merchant
    participant App as Buyer App
    participant Portal as Seller Dashboard
    participant API as MapAnytime API
    participant DB as PostgreSQL DB

    alt Store Pickup Flow
        Seller->>Portal: Mark order as READY_FOR_PICKUP
        API-->>App: Send "Order ready for pickup" notification
        Buyer->>App: Open "Digital Pickup Pass" (Displays QR code & Pass code)
        Buyer->>Seller: Shows Pickup Pass at store counter
        Seller->>Portal: Enter/Scan Buyer Pickup Code
        Portal->>API: POST /v1/orders/:id/verify-pickup
        API->>DB: Update Order status to COMPLETED, record pickup timestamp
        API-->>Buyer: Order Completed confirmation
    else Delivery Flow
        Seller->>Portal: Mark order as PREPARING -> Create Shipment
        Portal->>API: POST /v1/shipments (Carrier, TrackingNumber, EstimatedArrival)
        API->>DB: Create Shipment record, transition Order to SHIPPED
        API-->>App: Notify Buyer with Live Tracking details
        Seller->>Portal: Mark Shipment as DELIVERED upon carrier drop-off
        Portal->>API: PATCH /v1/shipments/:id (status: DELIVERED)
        API->>DB: Update Order status to COMPLETED
    end
```

---

### Flow 8: Merchant Advertising & Attribution Flow

```mermaid
sequenceDiagram
    autonumber
    actor Seller as Merchant
    actor Buyer as Buyer
    participant Portal as Seller Portal
    participant App as Buyer App
    participant API as MapAnytime API
    participant Analytics as Analytics Engine
    participant DB as PostgreSQL DB

    Seller->>Portal: Create Ad Campaign (Budget, Proximity Radius, Schedule, Featured Products)
    Portal->>API: POST /v1/merchant-ads
    API->>DB: Persist Ad record & assign target coordinates

    Buyer->>App: Browses Map / Search in target area
    App->>API: GET /v1/merchant-ads/nearby
    API-->>App: Return Promoted Merchant Pin
    App->>API: POST /v1/analytics/events (event: AD_IMPRESSION, adId: XYZ)

    Buyer->>App: Clicks Promoted Pin & Store Banner
    App->>API: POST /v1/analytics/events (event: AD_CLICK, adId: XYZ)
    Buyer->>App: Purchases Featured Product from Ad

    API->>Analytics: Attribute Order revenue & conversion to Ad ID XYZ
    Analytics->>DB: Increment Ad stats (Impressions, Clicks, Attributed Revenue, ROAS)
    Seller->>Portal: View Realtime Campaign Analytics (ROAS, CPC, Conversions)
```

---

### Flow 9: Agent Recruitment & Merchant Onboarding Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Agent as Field Agent
    actor Merchant as New Merchant
    participant AgentApp as Agent Portal / App
    participant API as MapAnytime API
    participant DB as PostgreSQL DB

    Agent->>AgentApp: Click "Register New Merchant"
    Agent->>AgentApp: Enter Merchant Contact & Preliminary Business Details
    AgentApp->>API: POST /v1/agent/register-seller
    API->>DB: Create Merchant User & link agent recruiter ID
    API-->>Merchant: Send SMS / Email Invitation with Onboarding Link

    Merchant->>Merchant: Complete KYC & Store Setup
    Agent->>AgentApp: GET /v1/agent/recruits
    API->>DB: Query recruiter's merchant list and onboarding progress
    API-->>AgentApp: Display recruit status (Invited, Onboarding, Store Approved, First Sale Active)
```

---

### Flow 10: Financial Charge Ledger & Settlement Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant Order as Completed Order
    participant Ledger as OrderCharges Ledger
    participant Settlement as Settlement Service
    participant Bank as Payout Gateway / Bank
    actor Merchant as Merchant

    Order->>Ledger: Split Order Total into Immutable Charge Rows
    Note over Ledger: 1. PRODUCT (Buyer -> Merchant)<br/>2. BUYER_TRANSACTION_FEE (Buyer -> Platform, 2.23%)<br/>3. SELLER_MARKETPLACE_FEE (Merchant -> Platform, 2.00%)<br/>4. PAYMENT_PROCESSING_FEE (Platform -> Gateway)<br/>No TAX row — the platform collects no VAT

    Settlement->>Ledger: Aggregate Net Merchant Earnings (Goods - Commission - Fees)
    Settlement->>Settlement: Generate Settlement record (Eligible for release after holding period)

    Note over Settlement,Bank: Batch Release Schedule
    Settlement->>Bank: Dispatch Batch Payout for all RELEASED settlements
    Bank-->>Settlement: Payout Reference Number & Confirmation
    Settlement-->>Merchant: Merchant receives funds to registered Bank / e-Wallet account
```

---

### Flow 11: Multi-Ledger Settlement Lifecycle (Rewards, Seller Settlement & Agent Commission)

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer
    actor Seller as Seller (Recruited by Agent)
    actor Agent as Recruiter Agent
    participant Checkout as Checkout & Pricing
    participant Order as Orders & Settlements
    participant Rewards as Buyer Reward Ledger
    participant AgentLedger as Agent Commission Ledger

    %% 1. BUYER REDEMPTION AT CHECKOUT
    Note over Buyer,Rewards: 1. REWARD POINTS SPENT AT CHECKOUT
    Buyer->>Checkout: Select "Use Reward Points" (e.g. 500 pts)
    Checkout->>Rewards: Validate Balance & 20% Subtotal Cap
    Rewards-->>Checkout: Apply ₱50 discount to Order
    Buyer->>Order: Place Order with Points Discount
    Order->>Rewards: Atomic DB Transaction: Deduct 500 Reward Points, create REDEMPTION ledger row

    %% 2. ATOMIC MULTI-LEDGER SETTLEMENT UPON ORDER COMPLETION
    Note over Buyer,AgentLedger: 2. ATOMIC SETTLEMENT ON ORDER COMPLETION
    Seller->>Order: Mark order COMPLETED (Pickup verified)
    Note over Order,AgentLedger: Single Atomic DB $transaction (Order + Settlement + Buyer Reward + Agent Commission)
    Order->>Order: 1. Mark status = COMPLETED
    Order->>Order: 2. Create Seller Settlement (Platform owes Seller full net goods amount)
    Order->>Rewards: 3. Credit Buyer Reward Points (+10 pts, expires in 12m, ref: ORDER_COMPLETED:{id})
    Order->>AgentLedger: 4. Credit Agent Commission (0.05% GMV = ₱0.50 pending, matures in 7d, ref: AGENT_COMMISSION:{id})
    Order-->>Buyer: Notified: "Earned +10 Reward Points!"
    Order-->>Agent: Notified: "Pending Commission +₱0.50 from recruited store!"

    %% 3. SELLER PROMOTIONAL CAMPAIGN
    Note over Seller,Rewards: 3. SELLER-FUNDED BUYER CAMPAIGN
    Seller->>Rewards: Create Campaign ("Spend ₱500 get 50 Reward Points", Budget: 5,000 pts)
    Buyer->>Order: Buys ₱500 at Seller's Store
    Order->>Rewards: Award +50 Reward Points to Buyer (debited from Seller's campaign budget)
```

---

## 4. Key Data Entities & Relationship Map

```mermaid
erDiagram
    Users ||--o{ Sessions : has
    Users ||--o{ Stores : owns
    Users ||--o{ Orders : places
    Users ||--o{ Documents : submits
    Users ||--o| Buyers : registers
    Users ||--o| Sellers : registers

    Buyers ||--o| RewardWallet : owns
    RewardWallet ||--o{ RewardTransactions : logs

    Sellers ||--o{ SellerCampaigns : launches
    SellerCampaigns ||--o{ SellerCampaignTransactions : logs

    Users ||--o| AgentCommissionAccount : holds
    AgentCommissionAccount ||--o{ AgentCommissionTransactions : logs
    AgentCommissionAccount ||--o{ AgentPayouts : requests

    Stores ||--o{ StoreHours : configures
    Stores ||--o{ Products : offers
    Stores ||--o{ ProductProperties : lists
    Stores ||--o{ Orders : receives
    Stores ||--o{ MerchantAds : runs
    Stores ||--o{ Inventory : stocks

    Products ||--o{ ProductImages : contains
    Products ||--o{ ProductOptions : has
    Products ||--o{ ProductVariants : produces
    ProductVariants ||--o{ Inventory : tracks

    Orders ||--|{ OrderItems : contains
    Orders ||--o{ OrderCharges : ledgers
    Orders ||--o{ InventoryReservations : locks
    Orders ||--o{ Shipments : fulfills
    Orders ||--o{ Payments : pays
    Orders ||--o{ RewardTransactions : references
    Orders ||--o{ AgentCommissionTransactions : references

    RewardConfigurations ||--o{ RewardWallet : configures
    AgentCommissionConfigurations ||--o{ AgentCommissionAccount : configures
    PricingConfigurations ||--o{ PricingComponents : defines
    MerchantAds ||--o{ MerchantAdProducts : targets
    MerchantAds ||--o{ AdEvents : records
```

    Stores ||--o{ StoreHours : configures
    Stores ||--o{ Products : offers
    Stores ||--o{ ProductProperties : lists
    Stores ||--o{ Orders : receives
    Stores ||--o{ MerchantAds : runs
    Stores ||--o{ Inventory : stocks

    Products ||--o{ ProductImages : contains
    Products ||--o{ ProductOptions : has
    Products ||--o{ ProductVariants : produces
    ProductVariants ||--o{ Inventory : tracks

    Orders ||--|{ OrderItems : contains
    Orders ||--o{ OrderCharges : ledgers
    Orders ||--o{ InventoryReservations : locks
    Orders ||--o{ Shipments : fulfills
    Orders ||--o{ Payments : pays
    Orders ||--o{ RewardTransactions : references

    PricingConfigurations ||--o{ PricingComponents : defines
    MerchantAds ||--o{ MerchantAdProducts : targets
    MerchantAds ||--o{ AdEvents : records

```

---

## 5. Technology Stack Summary

| Layer | Technologies Used |
| :--- | :--- |
| **Backend API** | Node.js, Express, TypeScript, Prisma ORM, PostgreSQL (Spatial/PostGIS queries), Redis, RabbitMQ |
| **Payment Gateway** | PayMongo API (GCash, Maya, Credit/Debit Cards, QR Ph) |
| **Web Frontend** | Next.js (App Router), React, TypeScript, TailwindCSS, Zustand / React Query |
| **Mobile App** | Flutter (Dart), Google Maps Flutter / Mapbox, Provider / Riverpod |
| **Infrastructure & Ops** | Docker, Nginx, Linux (Ubuntu), PM2, GitHub Actions CI/CD |

---
*Generated: 2026-08-20 — Source of truth for MapAnytime Marketplace Features and System Flows.*
```
