# MapAnytime — Complete System Architecture, Features, Full Dashboard Guides (Seller, Admin, Agent), Roles, Permissions, Database Schema, Background Workers & Real-Time Manual

---

## 1. System Architecture & Three-Tier Component Interaction

**MapAnytime** operates as a distributed tripartite system connecting mobile consumers, web-based merchant managers / administrators, and a centralized REST/real-time backend API.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                MAPANYTIME PLATFORM                                     │
└────────────────────────────────────────────────────────────────────────────────────────┘

  📱 FLUTTER MOBILE APP                   💻 NEXT.JS WEB PORTAL                  
  (mapanytime-market-app)                 (mapanytime-market-web)                
  • Hyperlocal Map & Proximity Filter     • Seller Dashboard (Multi-store & POS) 
  • Store Discovery & Pin Clustering      • Admin Control Center (KYC & Releases)
  • Cart & Reservation Checkout           • Agent Console (Recruitment & Support)
  • Real-time Order Tracking              • Promotions & Hyperlocal Ad Wizard    
  • In-app Reviews & Notifications        • Financial Settlements & Payouts      
  • OTA App Update Verification           • Platform Analytics & Category Trees  
             │                                       │                           
             │ HTTP / JSON REST + Multipart Upload   │ HTTP / JSON REST + SSR / Cookies
             │ Bearer JWT (Access + Refresh)         │ Bearer JWT (Access + Refresh)
             │ Socket.IO (Viewport grid + Notifs)    │ Socket.IO (Shared Tab Ref-Count)
             └───────────────────┬───────────────────┘                           
                                 │                                               
                                 ▼                                               
                 ┌───────────────────────────────┐                               
                 │      NODE.JS / EXPRESS        │                               
                 │       (mapanytime-api)        │                               
                 │ • Unified REST Routing (/v1)  │                               
                 │ • Socket.IO Spatial Gateway   │                               
                 │ • RBAC & Permission Matrix    │                               
                 │ • Pricing & Commission Engine │                               
                 │ • Geolocation & Store Math    │                               
                 │ • Atomic Inventory Holds (TTL)│                               
                 │ • Payment Gateway Integrations│                               
                 └───────────────┬───────────────┘                               
                                 │                                               
                 ┌───────────────┴───────────────┐                               
                 ▼                               ▼                               
  ┌─────────────────────────────┐ ┌─────────────────────────────┐                
  │     POSTGRESQL (Prisma)     │ │     RABBITMQ & REDIS QUEUES │                
  │ • 9 Core Feature Domains    │ │ • Rate Limiting & Sessions  │                
  │ • Geocoded Spatial Indexes  │ │ • Live Shopping Cart State  │                
  │ • Double-entry Ledger Data  │ │   (session-scoped, 7d TTL)  │                
  │                             │ │ • Analytics Consumer Stream │                
  │                             │ │ • Background Workers/Cron   │                
  └─────────────────────────────┘ └─────────────────────────────┘                
```

---

## 2. Exhaustive Web Dashboard Breakdown (Seller, Admin, Agent)

The web client (`mapanytime-market-web`) provides three isolated, specialized role-based workspaces:

### 🏪 A. Seller Portal & Merchant Backoffice (`/seller/*`)

Built for merchants managing physical storefronts, branch networks, product inventories, and local marketing.

1. **`/seller/dashboard` (Store Overview & Live Metrics)**:
   - **Executive KPI Cards**: Real-time sales volume, today's Gross Merchandise Value (GMV), active pickup orders, completed transactions, and low-inventory alert counters.
   - **Store Status Controls**: Quick-toggle between `Active`, `Busy`, and `Vacation Mode`.
   - **Interactive Performance Chart**: Recharts area chart plotting revenue and order velocity over time.
   - **Quick Action Bar**: One-click shortcuts to Add New Product, Create Promo Campaign, and View Incoming Orders.

2. **`/seller/manage-stores` & `/seller/all-stores` (Multi-Store Branch Manager)**:
   - **Multi-Branch Operations**: Single merchant account managing multiple physical storefronts with independent catalogs, locations, and staff.
   - **Operating Hours Scheduler**: Granular daily schedule picker storing opening and closing times in minutes-since-midnight (e.g. 480 = 8:00 AM, 1020 = 5:00 PM) with closed-day toggles.
   - **Spatial Location Pinning**: Interactive map pin dropper setting `latitude` and `longitude`, auto-filling street, city, province, and postal code.
   - **Branding & Policies**: Custom store logo and banner image uploads, return policies, shipping/pickup instructions, and social profile links.

3. **`/seller/products` (Catalog & Variant Matrix)**:
   - **Multi-Tier Variant Generator**: Define custom options (e.g., Size, Color, Flavor, Material) to dynamically generate unique SKUs with individual retail prices and cost prices.
   - **Category Tagging**: Hierarchical marketplace category assignment and search tag associations.
   - **Media Management**: Drag-and-drop multi-image galleries with primary display image selector.
   - **Product Lifecycle Controls**: Publish, draft, archive, or temporarily hide products.

4. **`/seller/inventory` (Live Stock & Movements Audit)**:
   - **Stock Count Grid**: Real-time tracking of `quantityOnHand` (physical shelf stock) and `quantityReserved` (active shopper checkout holds).
   - **Stock Adjustments & Restocking**: Quick delta modifier for incoming inventory restocks.
   - **Audit Movement Ledger**: Complete chronological ledger of stock changes (`RESTOCK`, `SALE`, `RETURN`, `TRANSFER`, `ADJUSTMENT`) with user IDs and reference order IDs.

5. **`/seller/orders` & `/seller/fulfillment` (Live Kanban Board & Pickup Terminal)**:
   - **Real-Time Kanban Board**: Connected directly to Socket.IO (`useOrdersPipeline.ts`), moving orders live across columns (`New Order` ➔ `Preparing` ➔ `Ready for Pickup` ➔ `Completed`).
   - **Barcode / QR Pickup Verification**: Scan buyer's mobile pickup barcode to verify identity and mark order as completed.
   - **Order Details Drawer**: Itemized lines, variant options, buyer contact snapshot, applied promo discounts, and pickup scheduled time.
   - **Slip Printing**: Automated printable packing/pickup receipt formatting.

6. **`/seller/promotions` (Hyperlocal Ads Wizard & ROI Analytics)**:
   - **4-Step Ad Builder**:
     - *Step 1: Campaign Objective*: Select `STORE_VISITS`, `IMPRESSIONS`, or `PURCHASES`.
     - *Step 2: Ad Format*: Choose `MAP_FLOATING_CARD`, `PROMOTED_PIN`, `DISCOVERY_CAROUSEL`, or `SPONSORED_SEARCH`.
     - *Step 3: Geofence & Budget*: Set GPS target center, proximity radius (1–20 km), and daily/total budget limits.
     - *Step 4: Discount & Products*: Configure `BOGO` (Buy X Get Y), percentage discount, or fixed amount off, and link product SKUs.
   - **Real-Time ROI Dashboard**: Track ad spend, impressions, map pin clicks, conversions, and exact attributed revenue.

7. **`/seller/properties` (Real Estate Broker & Property Portal)**:
   - **Property Types**: House & Lot and Raw Land listing wizard.
   - **Deed & Legal Verification**: Upload government property titles (`TCT` Transfer Certificate of Title, `OCT` Original Certificate of Title, or `Tax Declaration`) for administrative verification.
   - **Property Specifications**: Terrain (`FLAT`, `SLOPING`, `ROLLING`, `MOUNTAINOUS`), Furnishing (`BARE`, `SEMI_FURNISHED`, `FULLY_FURNISHED`), HOA dues, lot area, floor area, bedrooms, bathrooms, and parking spaces.
   - **Legal Capacity**: Declare seller capacity as `OWNER`, `BROKER`, or `PROXY`.

8. **`/seller/finance` (Settlements & Bank Payouts)**:
   - **Escrow Settlement Tracker**: Monitor order revenue held in escrow and eligible release dates.
   - **Itemized Financial Ledger**: Transparent breakdown of marketplace commissions, tax deductions, payment gateway fees, and seller net payouts.
   - **Payout Requests**: Initiate batch bank payouts and monitor processing status (`PENDING` ➔ `PROCESSING` ➔ `COMPLETED`).

9. **`/seller/analytics` & `/seller/reviews`**:
   - **Store Performance Metrics**: Visual charts for unique visitors, conversion rate, repeat buyer rate, and top-performing products.
   - **Review Management**: Monitor verified customer star ratings (1–5 stars) and feedback comments.

10. **`/seller/settings` (Business KYC & Verification)**:
    - Upload business credentials (`TIN_ID`, `GOV_ID`, `DTI_CERTIFICATE`, `MAYORS_PERMIT`, `BIR_CERTIFICATE`, `SEC_CERTIFICATE`) with moderation status tracking.

---

### 🛡️ B. Admin Command Center (`/admin/*`)

Built for platform administrators and super administrators to manage global governance, verify merchants, configure commissions, and publish app updates.

1. **`/admin` (Platform Command Center)**:
   - **Macro KPI Metric Cards**: Total Platform Revenue (PHP), Verified Stores Count, Active Users (Buyers & Sellers), Pending Store Approvals Queue, and Completed Orders.
   - **Live Revenue Trend Visualizer**: Interactive chart plotting monthly gross revenue against order volume.
   - **Actionable Moderation Queue**: Table of newly submitted merchant stores awaiting KYC inspection.
   - **Recent Transactions Stream**: Global feed of completed, processing, or disputed platform transactions.

2. **`/admin/stores` (Store & KYC Approvals Console)**:
   - **KYC Verification Studio**: Side-by-side inspection of merchant business certificates (`DTI`, `Mayor's Permit`, `TIN`, `SEC`, `BIR`) and property deeds (`TCT`/`OCT`).
   - **Moderation Decision Actions**: One-click `Approve Store` (triggers automatic active store listing and emits socket notification), `Reject Store`, or `Request Revision` (`NEED_REVISSION`) with rejection reason notes.

3. **`/admin/users` (User Database & Account Moderation)**:
   - **Global User Directory**: Filter and search across all users by email, phone, name, or role.
   - **Account Lifecycle Enforcement**: Change account statuses (`ACTIVE`, `SUSPENDED`, `UNDER_REVIEW`, `NEED_REVISSION`, `BANNED`, `DEACTIVATED`).
   - **Profile Deep-Dive**: Inspect associated store branches, buyer order histories, and verified KYC documents.

4. **`/admin/permissions` (RBAC & Permission Matrix Manager)**:
   - **Role Assignment**: Assign or revoke system roles (`SUPER_ADMIN`, `DEVELOPER`, `ADMIN`, `SUPPORT_AGENT`, `SELLER`, `BUYER`).
   - **Granular Permissions Matrix**: Configure capability code assignments (`stores.approve`, `stores.manage`, `categories.manage`, `users.manage`, `users.roles`, `orders.view`, `analytics.view`).
   - **Administrator Invites**: Send secure, time-limited invitation tokens to onboard new administrative personnel.

5. **`/admin/categories` (Taxonomy & Commission Governance)**:
   - **Hierarchical Category Tree**: Create, edit, and re-order nested parent-child categories.
   - **Commission Rule Engine**: Set category-specific marketplace commission percentages and fixed fees.

6. **`/admin/orders` (Platform-Wide Order Oversight)**:
   - **Global Order Audit Ledger**: Search and inspect any order across all merchant stores.
   - **Dispute & Return Resolution**: Inspect return requests, reason codes, item receipt confirmations, and authorize refunds.
   - **`OrderCharges` Double-Entry Inspection**: View the complete itemized ledger of platform fee revenue, tax, and seller net distributions.

7. **`/admin/app-releases` (Mobile OTA Release Manager)**:
   - **APK Publisher**: Upload and register new Android APK builds specifying version string, integer build number, distribution channel, and APK direct download URL.
   - **Integrity & Security**: Generate and record SHA-256 binary checksums.
   - **Rollout Controls**: Toggle mandatory `forceUpdate` flags to prompt outdated Flutter clients to upgrade, manage rollback build targets, and publish `whatsNew` release notes.

---

### 🎧 C. Agent Support & Field Console (`/agent/*`)

Built for customer service representatives and field agents onboarding brick-and-mortar merchants.

1. **`/agent` (Agent Support Console)**:
   - **Support Overview**: Centralized portal for handling merchant inquiries, resolving store setup issues, and reviewing customer disputes.
   - **Quick Action Cards**: Dedicated modules for Order Oversight and Store Support.

2. **`/agent/registerSeller` (Field Merchant Onboarding Wizard)**:
   - **Assisted Registration**: Guided step-by-step workflow designed for field agents helping non-technical local store owners register their physical shops.
   - **Instant KYC Capture**: Upload store photos, take scans of Mayor's Permits and DTI certificates directly from mobile/tablet.
   - **GPS Pin Dropper**: Pin exact physical store coordinates on-site.

3. **`/agent/recruited` (Recruited Merchants Portfolio)**:
   - **Agent Referral Tracking**: Monitor all merchant stores onboarded by the agent.
   - **Onboarding Pipeline**: Track verification progress (Pending Admin Review, Need Revision, Approved & Live) and referral commission rewards.

---

## 3. Flutter Mobile App (`mapanytime-market-app`) Features & UI Flows

The mobile client is built in **Flutter** using **Riverpod** state management, clean architecture (Presentation, Domain, Data), and auto-reconnecting **Socket.IO** streams.

| Feature Module | Directory Path | Core Capabilities & UI User Flow |
| :--- | :--- | :--- |
| **1. World Map (`worldMap`)** | `lib/features/worldMap/` | **Interactive Map Discovery Flow**:<br>• GPS location initialization & bounding viewport tracking.<br>• Spatial clustering of nearby stores with live open/closed indicators.<br>• Promoted pins & floating merchant cards triggered by hyperlocal ad campaigns.<br>• Filter by category, distance radius (km), and operating hours.<br>• Real-time map marker updates via Socket.IO `subscribe` grid cells. |
| **2. Home & Discovery (`home`)** | `lib/features/home/` | **Feed & Spotlight Flow**:<br>• Discovery carousel of trending local merchants and featured items.<br>• Proximity-based recommendations & recent store visits.<br>• Quick-search bar with autocomplete by store name, product tag, or brand. |
| **3. Store & Product Detail (`store`)** | `lib/features/store/` | **Catalog & Storefront Browsing Flow**:<br>• Store header with banner, verified badges, rating, and operating schedule.<br>• Product gallery with variant selectors (sizes, colors, custom attributes).<br>• Real-time stock availability check.<br>• Store reviews tab with verified buyer ratings. |
| **4. Cart & Reservations (`cart`)** | `lib/features/cart/` | **Shopping Cart & Hold Flow**:<br>• Multi-store cart management with itemized price snapshots.<br>• Subtotal calculation including applicable discounts and promos.<br>• Initiation of atomic stock reservation before entering payment. |
| **5. Payments & Checkout (`payments`)** | `lib/features/payments/` | **Pickup Checkout Flow**:<br>• Selection of payment provider (Cards, E-Wallets, Maya, GCash, Cash on Pickup).<br>• Display of itemized breakdown (Subtotal, Platform Fee, Tax).<br>• Payment Intent authorization and 3D Secure webview authentication. |
| **6. Order Tracking (`orders`)** | `lib/features/orders/` | **Live Order Pipeline Flow**:<br>• Real-time visual stepper: `PENDING` ➔ `PROCESSING` ➔ `READY_FOR_PICKUP` ➔ `COMPLETED`.<br>• Live updates over Socket.IO (`notification:new`) without pull-to-refresh.<br>• Order pickup barcode / QR code and digital receipt.<br>• Return & refund request submission workflow. |
| **7. Recommendations (`recommendations`)** | `lib/features/recommendations/` | **Smart Suggestions Flow**:<br>• Personalized product suggestions based on user shopping history and search patterns. |
| **8. Wishlist (`wishlist`)** | `lib/features/wishlist/` | **Saved Items Flow**:<br>• Bookmark favorite products and stores for quick access and price drop monitoring. |
| **9. Notifications (`notifications`)** | `lib/features/notifications/` | **Alerts & Toasts Flow**:<br>• Centralized inbox for order milestones, merchant promotions, and account alerts.<br>• Real-time foreground banner alerts driven by the user's private notification socket. |
| **10. Profile & Settings (`profile`)** | `lib/features/profile/` | **Account Management Flow**:<br>• Address book (`HOME`, `OFFICE`, `BILLING`), phone verification, password reset, and referral link sharing. |
| **11. Auth & Onboarding (`auth`, `onboarding`)** | `lib/features/auth/`, `lib/features/onboarding/` | **Authentication Flow**:<br>• Welcome walkthrough, Email/Password login, OTP verification, and JWT session persistence in secure storage. |

---

## 4. Background Workers, Schedulers & Asynchronous Event Queues

The platform employs a dedicated background worker process (`mapanytime-api/src/worker.ts`) decoupled from the REST API to handle asynchronous event streams and cron jobs:

### ⚙️ Asynchronous Consumer Services (RabbitMQ / Redis)
1. **`EmailConsumer` (`src/consumers/email.consumer.ts`)**:
   - Asynchronous dispatch of transactional emails (Welcome verification OTPs, password reset codes, store approval confirmations, and order receipts).
   - Prevents slow SMTP / Mailer handshakes from blocking API request cycles.
2. **`AnalyticsConsumer` (`src/consumers/analytics.consumer.ts`)**:
   - Ingests high-volume user interaction events (`PAGE_VIEW`, `STORE_VIEW`, `PRODUCT_VIEW`, `SEARCH`, `ADD_TO_CART`, `ORDER_COMPLETED`) from message queues.
   - Batch writes into the append-only `AnalyticsEvents` table.

### ⏰ Scheduled Cron Jobs (`src/infrastructure/scheduler/index.ts`)
1. **Inventory TTL Expiration Sweep (`* * * * *` — Every 1 Minute)**:
   - Sweeps `InventoryReservations` table for reservations whose `expiresAt < now()` and status is `RESERVED`.
   - Automatically releases reserved stock back to `quantityOnHand` and marks reservation as `EXPIRED`.
2. **Settlement Escrow Maturation (`0 * * * *` — Hourly)**:
   - Sweeps `Settlements` table where `releaseEligibleAt <= now()` and status is `PENDING`.
   - Flips status to `RELEASED`, enabling the funds to be swept into batch seller bank payouts.
3. **Database Maintenance & Cleanup (`0 2 * * *` — Daily at 2:00 AM)**:
   - Removes expired password reset tokens, old unverified sessions, and rotates audit logs.
4. **Stale Cache Flush (`*/5 * * * *` — Every 5 Minutes)**:
   - Flushes expired Redis cache keys and worker health metric snapshots.

---

## 5. Real-Time Socket.IO Architecture & Event Matrix

MapAnytime incorporates a centralized **Socket.IO gateway** (`mapanytime-api/src/infrastructure/socket/index.ts`):

- **Server Mount**: Mounted directly on the Express HTTP server process.
- **Transports Supported**: `polling` (handshake) upgraded seamlessly to `websocket`.
- **Client Strategy**:
  - **Flutter App**: Managed by `StoreSocketDataSource` and `NotificationSocketDataSource` with auto-reconnection and Stream subscriptions.
  - **Next.js Web**: Managed by a single reference-counted socket per tab (`acquireSocket()` / `releaseSocket()`) avoiding duplicate connections and rate-limit violations.

### 📡 Real-Time Socket Event Matrix

| Feature Domain | Client Event (Emit) | Server Event (Broadcast) | Room / Channel Key Pattern | Engineering Mechanism & Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Hyperlocal Map Viewport Grid** | `subscribe` `{ north, south, east, west }` | `store:upserted`<br>`store:removed` | `cell:{latIndex}:{lngIndex}`<br>*(~0.1° ≈ 11km grid cells)* | **Spatial Room Partitioning**: Prevents global broadcast storms. As a user pans the map, the client joins only the grid cells covering the visible bounding box (max 400 cells). When a store updates hours or stock, the server broadcasts exclusively to that specific grid cell room. |
| **Real-Time User Notifications** | `subscribe_notifications` `{ userId }`<br>`send_notification` *(admin)* | `notification:new` | `notifications:user:{userId}` | **Targeted Private User Channels**: On login, clients join their user notification room. Whenever an order status changes or a KYC document is approved, the server emits `notification:new` to display instant toast alerts. |
| **Orders Pipeline Live Tracking** | *(Triggered via `subscribe_notifications`)* | `notification:new`<br>*(with order payload)* | `notifications:user:{userId}` | **Live Order Board Syncer**: Used in `useOrdersPipeline.ts` (Web) and `orders_controller.dart` (Mobile). Status changes (`PENDING` ➔ `PROCESSING` ➔ `READY_FOR_PICKUP` ➔ `COMPLETED`) instantly invalidate React Query caches without polling. |
| **Buyer-Merchant Live Chat** | `join_chat_room` *(roomId)*<br>`leave_chat_room` *(roomId)*<br>`send_chat_message` | `chat:message` | `chat:room:{roomId}` | **Multi-Party Chat Rooms**: Allows buyers and merchants to communicate in real time regarding custom order pickups, delivery notes, or real estate property inquiries. |

---

## 6. All User Types & Domain Profiles

Users in MapAnytime have a base `Users` entity and can assume one or more specialized domain profiles:

| User Type / Profile | Underlying Database Model | Description & Key Responsibilities |
| :--- | :--- | :--- |
| **Consumer / Buyer** | `Buyers` | Discovers local stores on interactive maps, creates carts, reserves inventory, places pickup orders, writes store & product reviews, manages delivery/billing addresses, and tracks order status. |
| **Merchant / Seller** | `Sellers` & `Stores` | Operates one or multiple physical/virtual storefronts, uploads business documents, manages catalogs/variants/inventory, runs geo-targeted merchant ads, views sales analytics, and requests payouts. |
| **Property Seller / Broker** | `ProductProperties` (`PropertiesProducts`) | Sellers with capacity as `OWNER`, `BROKER`, or `PROXY` listing real estate properties (House & Lot, Raw Land) with GPS coordinates, title verification files (TCT/OCT/Tax Dec), and specs. |
| **Supplier** | `SupplierProducts` | Provides wholesale stock, minimum order quantities (MOQ), supply lead times, and B2B pricing to merchant stores. |
| **Support Agent** | `Users` | Customer support staff handling inquiries, returns, dispute resolution, and store inspection. |
| **Platform Administrator** | `Users` | Moderates store onboarding, approves real estate and seller KYC documents, manages categories, commission rules, and app releases. |
| **Developer / Engineer** | `Users` | Technical administrator with access to API logs, webhook configurations, system health, and developer tooling. |
| **Super Admin** | `Users` | Root administrator with total platform authority, including RBAC permission matrices, admin invitations, financial settlements, and user suspensions. |

---

## 7. System Roles & Hierarchy

Defined in `mapanytime-api/src/constants/roles.constant.ts`:

```
┌──────────────────────────────────────────────────────────┐
│                      SUPER_ADMIN                         │ (Full system bypass & RBAC control)
└────────────┬─────────────────────────────┬───────────────┘
             │                             │
┌────────────▼────────────┐   ┌────────────▼───────────────┐
│        DEVELOPER        │   │           ADMIN            │ (Stores/KYC approvals, categories)
└─────────────────────────┘   └────────────┬───────────────┘
                                           │
                              ┌────────────▼───────────────┐
                              │       SUPPORT_AGENT        │ (Store review, order monitoring)
                              └────────────┬───────────────┘
                                           │
                 ┌─────────────────────────┴─────────────────────────┐
                 │                                                   │
    ┌────────────▼────────────┐                         ┌────────────▼────────────┐
    │         SELLER          │                         │          BUYER          │
    │ (Store/Inventory/Ads)   │                         │  (Browse, Cart, Order)  │
    └─────────────────────────┘                         └─────────────────────────┘
```

### Role Breakdown

1. **`SUPER_ADMIN`**: Platform super administrator with unrestricted system control, RBAC authority, commission rates, and invite privileges.
2. **`DEVELOPER`**: Software engineer with access to system API logs, webhooks, performance monitoring, and developer tooling.
3. **`ADMIN`**: Platform administrator for KYC document moderation, category tree structure, real estate approval, and merchant onboarding.
4. **`SUPPORT_AGENT`**: Customer support agent for reviewing order logs, return requests, and store inquiries.
5. **`SELLER`**: Merchant seller account for managing storefronts, branches, variant catalogs, inventory, local ads, and payouts.
6. **`BUYER`**: Consumer account for proximity discovery on maps, reservation checkout, reviews, and pickup order tracking.

---

## 8. Granular Permission Matrix

Managed in `mapanytime-api/src/constants/permissions.constant.ts` and enforced via `permission.middleware.ts`:

| Permission Code | Permission Name | Description | Assigned Default Roles |
| :--- | :--- | :--- | :--- |
| `stores.approve` | **Approve Merchant Stores** | Can review and verify pending seller store requests and KYC documents. | `SUPER_ADMIN`, `DEVELOPER`, `ADMIN` |
| `stores.manage` | **Manage Store Listings** | Can create, edit, toggle vacation mode, or suspend merchant stores. | `SUPER_ADMIN`, `DEVELOPER`, `ADMIN`, `SELLER`, `SUPPORT_AGENT` |
| `categories.manage` | **Manage Categories** | Can create, edit, and toggle marketplace categories & commission bindings. | `SUPER_ADMIN`, `DEVELOPER`, `ADMIN` |
| `users.manage` | **Manage Users** | Can view, edit, ban, deactivate, or review user account statuses. | `SUPER_ADMIN`, `DEVELOPER`, `ADMIN` |
| `users.roles` | **Manage Roles & RBAC** | Can assign roles and modify permission matrices. | `SUPER_ADMIN`, `DEVELOPER`, `ADMIN` |
| `orders.view` | **View System Orders** | Can monitor platform-wide buyer orders, delivery statuses, and pickup schedules. | `SUPER_ADMIN`, `DEVELOPER`, `ADMIN`, `SELLER`, `SUPPORT_AGENT` |
| `analytics.view` | **View Platform Analytics** | Can access gross merchandise volume (GMV), store visits, and revenue charts. | `SUPER_ADMIN`, `DEVELOPER`, `ADMIN`, `SELLER` |

*Note: All roles in `ADMIN_ROLES` (`SUPER_ADMIN`, `DEVELOPER`, `ADMIN`) bypass individual permission checks with full implicit access.*

---

## 9. Complete Database Schema & Models Breakdown (9 Domains)

PostgreSQL schema partitioned into **9 core feature domains** containing 35+ models:

### 👤 Domain 1: Users, Auth, Security & RBAC
1. **`Users`**: Primary identity table (`id`, `email`, `passwordHash`, `accountStatus`, `isEmailVerified`, `countryCode`, `userReferralId`).
2. **`Roles`**: Master system role definitions (`roleName`, `description`).
3. **`Permissions`**: Granular action codes (`code`, `name`, `description`).
4. **`RolePermissions`**: Composite PK (`roleId`, `permissionId`) mapping roles to capabilities.
5. **`PasswordResetTokens`**: Hashed 4-digit OTP codes with expiration.
6. **`Session`**: Active login sessions with refresh tokens, OAuth scopes, and provider IDs.
7. **`AdminInvites`**: One-time secure tokens for onboarding platform administrators.
8. **`Files`**: Central S3/local file registry tracking MIME types, sizes, paths, and checksums.

### 🏪 Domain 2: Stores, Sellers & KYC Verification
9. **`Sellers`**: Merchant business profiles (`userId`, `applicationStatus`, `sellerPlan`, `onboardingStep`).
10. **`Stores`**: Storefronts (`sellerId`, `storeName`, `slug`, `ratingAverage`, `ratingCount`, `vacationMode`, `isActive`, `approvalStatus`).
11. **`StoreLocations`**: Physical store coordinates (`latitude`, `longitude`, address). Indexed by `[latitude, longitude]`.
12. **`StoreHours`**: Daily schedules (`dayOfWeek`, `openMinutes`, `closeMinutes`, `isClosed`).
13. **`DocumentVerifications`**: Verification bundle linking uploaded business credentials to a seller and store.
14. **`Documents`**: Individual uploaded KYC files (`TIN_ID`, `GOV_ID`, `DTI_CERTIFICATE`, `MAYORS_PERMIT`, `BIR_CERTIFICATE`, `SEC_CERTIFICATE`).
15. **`StoreReviews`**: Verified buyer feedback for storefronts.

### 🏡 Domain 3: Real Estate Property Listings
16. **`ProductProperties` (`PropertiesProducts`)**: Real estate catalog (`propertyType`: `HOUSE_LOT`, `RAW_LAND`; `sellerCapacity`: `OWNER`, `BROKER`, `PROXY`; terrain, furnishings, HOA dues, lot/floor area, price).
17. **`PropertiesFiles`**: Property deed attachments (`titleType`: `TCT`, `OCT`, `TAX_DECLARATION`).

### 📦 Domain 4: Product Catalog, Multi-Variants & B2B Supply
18. **`Products`**: Core merchandise items (`storeId`, `categoryId`, `name`, `brand`, `price`, `status`, `totalSold`, `isActive`).
19. **`ProductVariants`**: Specific SKU variations (Size, Color) with specific pricing, cost price, and stock levels.
20. **`ProductOptions` & `ProductOptionValues`**: Attribute structures (e.g. Size -> S, M, L).
21. **`ProductVariantToOptionValue`**: Composite join table mapping variant SKUs to option values.
22. **`ProductImages`**: Image galleries with `isPrimary` flags and sort orders.
23. **`Categories`**: Nested tree hierarchy (`parentId` self-reference) with category commission rules.
24. **`Tags` & `ProductTags`**: Tagging system for product search.
25. **`SupplierProducts`**: B2B supply chain listings with `supplierSku`, `costPrice`, `minimumOrderQty`, and `supplyLeadDays`.

### 📢 Domain 5: Hyperlocal Merchant Ads & Promotions
26. **`MerchantAds`**: Location-targeted promotional campaigns (`kind`: `PROMO`, `JOB`, `EVENT`; `format`: `MAP_FLOATING_CARD`, `PROMOTED_PIN`; `radiusKm`, `dailyBudget`, `impressionsCount`, `clicksCount`, `attributedRevenue`).
27. **`MerchantAdProducts`**: Associates ad campaigns with specific product variants.
28. **`AdEvents`**: Event stream logging `IMPRESSION`, `CLICK`, and `CONVERSION` events.

### 🛒 Domain 6: Shopping Cart & Race-Condition-Free Inventory
29. **`Carts` & `CartItems`**: Defined in the schema, but **not read or written by the live API** (`src/modules/cart/cart.service.ts` has zero Prisma calls) — only `prisma/seeders/marketplace_data.seeder.ts` populates them, purely as demo data. The real shopping cart is **Redis-backed and ephemeral**: `CartService` stores the whole cart (storeId + line items with price/quantity snapshots) as a single JSON blob at key `cart:{userId}`, with a 604800s (7-day) TTL refreshed on every write. This means a cart with no activity for 7 days — or a Redis instance without persistent storage that gets flushed — loses its contents outright, with no Postgres fallback.
30. **`Wishlists` & `WishlistItems`**: Shopper wishlists.
31. **`Inventory`**: Per-store stock tracking (`quantityOnHand`, `quantityReserved`, `version`). Composite unique constraint on `[storeId, productId, variantId]`.
32. **`InventoryReservations`**: TTL stock holds preventing double-selling during checkout.
33. **`InventoryMovements`**: Stock audit ledger recording `movementType` (`RESTOCK`, `SALE`, `RETURN`, `TRANSFER`, `ADJUSTMENT`).

### 💳 Domain 7: Orders, Pricing Engine & Financial Ledger
34. **`Orders`**: Checkout orders (`totalAmount`, `subtotalAmount`, `discountAmount`, `taxAmount`, `marketplaceFeeAmount`, `sellerNetAmount`, `status`).
35. **`OrderItems`**: Item lines with snapshots of product names, variants, SKUs, images, and applied promo ads.
36. **`OrderCharges`**: Itemized double-entry financial audit ledger tracking every charge line.
37. **`PricingConfigurations` & `PricingComponents`**: Versioned dynamic commission and fee calculation engine.
38. **`PaymentProviders` & `PaymentMethods`**: Payment gateway registry (PayMongo, Cards, GCash, Maya, Bank, QR, Cash).
39. **`Payments`**: Payment intent transactions tracking checkout session IDs, gateway reference numbers, and refunds.
40. **`PaymentWebhookEvents`**: Raw webhook payload log ensuring idempotent transaction verification.
41. **`Settlements`**: Escrow holds (`subtotalAmount`, `commissionAmount`, `sellerNetAmount`, `releaseEligibleAt`).
42. **`SellerPayouts` & `SellerPayoutItems`**: Batch payout records transferring cleared funds to merchant bank accounts.

### 🔄 Domain 8: Returns & Customer Experience
43. **`ReturnRequests`**: Order return management (`status`: `PENDING`, `APPROVED`, `ITEM_RECEIVED`, `REFUNDED`).
44. **`ProductReviews`**: Verified product ratings and comments.
45. **`BuyerAddresses`**: User address book (`HOME`, `OFFICE`, `BILLING`, `isDefault`).
46. **`Notifications`**: In-app notifications with `readAt` timestamps and JSON metadata payloads.
47. **`AuditLogs`**: Platform-wide administrative audit trail.

### 📱 Domain 9: Mobile Releases & Platform Analytics
48. **`AppRelease`**: OTA / APK build distribution registry (`version`, `buildNumber`, `channel`, `apkUrl`, `sha256`, `forceUpdate`, `whatsNew` JSON).
49. **`AnalyticsEvents`**: High-performance append-only interaction stream (`PAGE_VIEW`, `STORE_VIEW`, `PRODUCT_VIEW`, `SEARCH`, `ADD_TO_CART`, `ORDER_COMPLETED`) without foreign key locks.

---

## 10. Complete REST API Route Registry (`/v1`)

| Route Prefix | Module Name | Primary Responsibilities | Auth & Protection |
| :--- | :--- | :--- | :--- |
| `/v1/auth` | `auth` | Register, login, refresh token, password reset OTPs, email verify. | Public / Bearer Token |
| `/v1/users` | `users` | User profile, avatar update, address book, account status. | Authenticated |
| `/v1/file-uploads` | `fileUpload` | Multipart S3 uploads for KYC docs, logos, deeds, and product images. | Authenticated |
| `/v1/files` | `files` | Direct file retrieval, metadata inspection, and deletion. | Authenticated |
| `/v1/products` | `products` | Product creation, multi-variant updates, gallery management, and tag links. | Public / Merchant |
| `/v1/supplier-products` | `supplierProducts` | Wholesale supply catalog, lead times, and B2B pricing. | Merchant / Supplier |
| `/v1/stores` | `stores` | Store creation, operating hours, spatial GPS bounding search, vacation mode. | Public / Merchant |
| `/v1/merchant-ads` | `merchantAds` | Campaign creation, geofencing radius, ad budgets, and performance stats. | Merchant |
| `/v1/pricing` | `pricing` | Versioned pricing configurations, fee rules, commission rates. | Admin (`stores.manage`) |
| `/v1/categories` | `categories` | Hierarchical category CRUD, parent-child nesting, category commission. | Public / Admin (`categories.manage`) |
| `/v1/orders` | `orders` | Order creation, pickup status transitions, order charges inspection. | Buyer / Merchant / Support (`orders.view`) |
| `/v1/inventory` | `inventory` | Real-time stock counts, movements audit, atomic checkout reservations. | Merchant / Internal |
| `/v1/cart` | `cart` | Shopper cart items, price snapshots, item quantity management. | Buyer |
| `/v1/payments` | `payments` | Checkout intent creation, webhook processing, gateway reconciliation. | Buyer / Webhooks |
| `/v1/returns` | `returns` | Return request submission, seller review, item receipt, and refunds. | Buyer / Merchant / Support |
| `/v1/settlements` | `settlements` | Escrow clearance tracking, revenue splits, hold/release controls. | Admin / Merchant |
| `/v1/payouts` | `payouts` | Bank transfer batch generation and payout processing. | Admin / Merchant |
| `/v1/rbac` | `rbac` | Role definitions, permissions catalogue, role-to-permission mapping. | Admin (`users.roles`) |
| `/v1/agent` | `agent` | Support & AI-assisted operational endpoints. | Authenticated |
| `/v1/app` | `publicAppRelease` | Public APK build lookup, update checking, release notes. | Public |
| `/v1/admin/app-releases` | `adminAppRelease` | APK publish wizard, rollback target, force-update controls. | Admin / Developer |
| `/v1/admin/approvals` | `adminApprovals` | KYC document moderation, store approvals, property review. | Admin (`stores.approve`) |
| `/v1/properties` | `properties` | Real estate property catalog, deed verification uploads, specs. | Public / Seller |
| `/v1/analytics` | `analytics` | Ingestion stream and aggregation for GMV, visits, conversions. | Authenticated / Admin (`analytics.view`) |
| `/v1/reviews` | `reviews` | Store and product ratings, verified buyer review management. | Buyer / Public |
| `/v1/wishlist` | `wishlists` | User wishlists and favorite items. | Buyer |
| `/v1/notifications` | `notifications` | Fetch user alerts, mark as read, unread count queries. | Authenticated |
| `/health` | `health` | Uptime check, database connection, Redis heartbeat. | Public |

---

## 11. Default Seed Accounts (For Local Development & Testing)

From `mapanytime-api/prisma/seeders/users.seeder.ts`:

| Email | Full Name | Roles | Default Password | Status |
| :--- | :--- | :--- | :--- | :--- |
| `superadmin@example.com` | Super Admin | `SUPER_ADMIN` | `Super123` | Active & Verified |
| `dev@example.com` | Lead Developer | `DEVELOPER` | `Dev123` | Active & Verified |
| `admin@example.com` | System Admin | `ADMIN` | `Password123` | Active & Verified |
| `support@mapanytime.test` | Maria Artesano | `SUPPORT_AGENT` | `Support123` | Active & Verified |
| `seller@example.com` | Grace Piatos | `SELLER` | `Seller123` | Active & Verified |
| `seller.electrical@mapanytime.test` | Jose Electrico | `SELLER` | `Seller123` | Active & Verified |
| `seller.hardware@mapanytime.test` | Ramon Construccion | `SELLER` | `Seller123` | Active & Verified |
| `buyer@example.com` | Sara Smith | `BUYER` | `Buyer123` | Active & Verified |
| `dual@example.com` | Alex Mercer | `BUYER`, `SELLER` | `Dual123` | Active & Verified |
| `seller.multistore@mapanytime.test` | Marco Cordillera | `SELLER`, `BUYER` | `Seller123` | Active & Verified |
