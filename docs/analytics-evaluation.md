# Architectural Evaluation: Marketplace Analytics and Recommendation System

This document evaluates the proposed event-based analytics and recommendation architecture for the MapAnytime marketplace.

> **Overall Verdict:** Highly Recommended.
> The proposed architecture is a mature, scalable approach that mirrors best practices from tier-1 e-commerce platforms. It avoids common performance pitfalls associated with simple database counters and provides a rich data foundation for future machine learning and personalization efforts.

## Strengths of the Proposal

### 1. Performance and Scalability (Avoiding N+1 Writes)

The most critical advantage of the event-based approach over adding a `viewCount` column is database performance.

- **The Anti-Pattern:** A `viewCount` field requires executing an `UPDATE products SET viewCount = viewCount + 1` for every page load. In a busy marketplace, this leads to massive row-level locking, deadlocks, and write-contention in PostgreSQL.
- **The Proposed Solution:** By moving to an event-based system (`STORE_VIEW`, `PRODUCT_VIEW`), writes become append-only. This is incredibly efficient for relational databases.

### 2. Utilizing Existing Infrastructure

The MapAnytime API environment already includes **RabbitMQ** (via `RABBITMQ_URL` and `INGESTION_QUEUE_NAME`). This existing infrastructure is perfectly suited for this proposal.

- The API can quickly push an event to the RabbitMQ exchange and return a `200 OK` to the frontend without blocking the HTTP request.
- A background worker process can then consume these events and batch-insert them into the database, providing massive throughput capabilities.

### 3. Data Richness and Future-Proofing

A simple integer (`viewCount: 1540`) cannot answer business-critical questions like:

- "How many views did this get _this week_?"
- "What is the conversion rate from view to purchase?"
- "Is this product trending up or down?"

The event log inherently captures the dimension of time, allowing for the precise aggregations mentioned in **Phase 3 (Daily Analytics Aggregation)**.

### 4. Pragmatic Rollout Strategy

The recommendation explicitly advises against jumping straight into Machine Learning (**Phase 6 & 7**). Starting with a rule-based weighted ranking system is exactly the right move. It provides immediate value (better search/sorting) using basic math, while quietly building the historical dataset that an ML model will eventually require to train on.

## Technical Considerations & Recommendations for Implementation

If MapAnytime proceeds with this architecture, here are a few technical considerations to keep in mind:

### Event Ingestion and Storage

- **RabbitMQ Batching:** The background worker consuming `ingestion_jobs` should batch events (e.g., insert 100-500 events at a time) rather than performing single inserts. This maximizes Postgres write performance.
- **Table Partitioning:** The `AnalyticsEvent` table will grow rapidly. Plan to use PostgreSQL native table partitioning (e.g., partition by `date` or `month`) from the beginning so that old events can be dropped or archived to S3 without expensive `DELETE` queries.

### Session Deduplication (Phase 2)

- **Anonymous Sessions:** To distinguish raw events from unique visitors, the `mapanytime-market-web` frontend should generate a UUID on the first visit and store it in `localStorage` or a first-party cookie as an `anonymous_session_id`. This ID must be included in all analytics API payloads.
- **Deduplication Logic:** Deduplication shouldn't happen during ingestion. Store all raw events, but calculate "Unique Views" during the **Phase 3 Aggregation** process (e.g., using `COUNT(DISTINCT session_id)` grouped by day).

### Aggregation Mechanics (Phase 3)

- **Materialized Views vs. Cron Jobs:** You can use PostgreSQL `MATERIALIZED VIEWS` to handle the daily aggregations, or run a nightly background job that calculates the stats and writes them to a dedicated `DailyProductStats` table. The nightly job approach is usually more resilient and easier to monitor.

## Conclusion

The recommendation to avoid a simplistic `viewCount` in favor of an event-driven architecture is sound. It leverages the existing RabbitMQ infrastructure, protects the primary database from write-lock exhaustion, and establishes the exact data foundation needed for future ML-based personalization.

**Recommendation:** Proceed with Phase 1 and 2 of this plan as written.

# Recommendation: Marketplace Analytics and Recommendation System

I recommend implementing an **event-based marketplace analytics and recommendation system** rather than simply adding `viewCount` fields to Stores and Products.

The existing schema already contains the core marketplace relationships between stores, products, carts, wishlists, and orders.

## 1. Event-Based Analytics

Create a centralized analytics event system that records meaningful user interactions.

Initial events should include:

- `STORE_VIEW`
- `PRODUCT_VIEW`
- `PRODUCT_CLICK`
- `SEARCH`
- `ADD_TO_CART`
- `ADD_TO_WISHLIST`
- `CHECKOUT_STARTED`
- `ORDER_COMPLETED`

Each event should record information such as:

- Event type
- User ID when authenticated
- Anonymous session ID when unauthenticated
- Store ID when applicable
- Product ID when applicable
- Category ID when applicable
- Metadata when necessary
- Timestamp

The analytics event table should become the source of truth instead of maintaining simple lifetime view counters.

## 2. Deduplicated Views

A view should not necessarily mean every HTTP request or every time a page is opened.

For example, repeatedly opening the same store within a short period should not artificially inflate its popularity.

Use a session/time-based deduplication mechanism so that the system can distinguish:

- Raw events
- Meaningful views
- Unique visitors
- Returning visitors

This will make store and product rankings significantly more reliable.

## 3. Daily Analytics Aggregation

Do not calculate marketplace rankings directly from millions of raw events.

Use an aggregation process that produces daily statistics such as:

### Store Analytics

- Views
- Unique visitors
- Product views
- Cart additions
- Wishlist additions
- Orders
- Revenue
- Conversion rate

### Product Analytics

- Views
- Unique visitors
- Cart additions
- Wishlist additions
- Orders
- Revenue
- Conversion rate

This provides fast queries for dashboards, rankings, and marketplace discovery.

## 4. Separate Popularity From Performance

The marketplace should have several different ranking concepts.

### Most Viewed

Answers:

> What are users looking at the most?

### Trending

Answers:

> What is becoming popular recently?

Recent activity should have greater weight than lifetime activity.

### Most Engaged

Answers:

> What products/stores generate the most user interaction?

### Best Selling

Answers:

> What products/stores generate actual purchases?

### Best Converting

Answers:

> Which products/stores turn views into purchases?

These should not be treated as the same ranking.

## 5. Use Analytics for Search Recommendations

When a user searches for something, the system should not simply return keyword matches.

The recommended ranking pipeline should eventually be:

**User Search → Search Relevance → Candidate Products → Ranking → Personalized Recommendations**

The ranking can consider:

1. Search relevance
2. Product popularity
3. Recent trending activity
4. User's previous interactions
5. Location/proximity
6. Product/store ratings
7. Purchase conversion
8. Inventory availability

For example, if a user searches for:

> "running shoes"

the system can prioritize products that:

- Match the search query
- Are currently in stock
- Are popular
- Are trending
- Are frequently purchased
- Come from nearby stores
- Match the user's previous interests

## 6. Start With Rule-Based Ranking

Do **not** immediately implement machine learning.

Initially use a weighted ranking system such as:

**Recommendation Score =**

`Search Relevance + Popularity + Recent Trend + Engagement + Conversion + Personalization + Location + Availability`

The exact weights can be adjusted as real marketplace data becomes available.

Once MapAnytime has enough real behavioral data, the same event history can become the foundation for a more advanced recommendation/ML system.

## 7. Recommended Architecture

```text
User Activity
      ↓
Analytics Events
      ↓
Event Processing
      ↓
Daily/Hourly Aggregations
      ↓
┌───────────────────────────────────────┐
│ Marketplace Intelligence              │
│                                       │
│ • Most Viewed                         │
│ • Trending                            │
│ • Most Engaged                        │
│ • Best Selling                        │
│ • Best Converting                     │
│ • Personalized Recommendations        │
└───────────────────────────────────────┘
      ↓
Search & Discovery
      ↓
Recommended Stores / Products
```

## Final Recommendation

Implement the analytics system now, but keep the first version simple.

The recommended progression is:

**Phase 1:** Event tracking
**Phase 2:** View/session deduplication
**Phase 3:** Daily/hourly aggregation
**Phase 4:** Trending and popularity rankings
**Phase 5:** Search ranking using behavioral signals
**Phase 6:** Personalized recommendations
**Phase 7:** Advanced ML recommendation engine when sufficient data is available

This approach prevents the system from becoming unnecessarily complex while ensuring that MapAnytime collects the right behavioral data from the beginning.

The key principle is:

> **Do not build analytics only to display view counts. Build the event foundation so the same data can power marketplace rankings, search relevance, personalization, seller analytics, and future recommendation intelligence.**
