# Stripe Payment Implementation Plan & Operational Specification

> **Status**: Authoritative Source of Truth  
> **Target Audience**: Backend Developers (Junior Developer Implementation, Senior Reviewer Validation)  
> **Scope**: Stripe PaymentIntents, Webhook Handlers, Automated Refunds, Payment Reconciliation, and Financial Idempotency.

---

## 1. Executive Overview & System Architecture

MapAnytime Marketplace uses a **modular monolith architecture** backed by PostgreSQL, Redis, RabbitMQ, and background worker jobs. Payment operations interface with external payment gateways using an adapter pattern (`PaymentProviderAdapter`).

This document details the end-to-end design and implementation rules for integrating **Stripe** as a core payment provider, ensuring financial correctness even under partial network outages, delayed webhooks, API timeouts, and concurrent operations.

### High-Level Topology

```text
  [ Client (Web / Flutter) ]
               │
               ▼
  [ API Cluster (Express) ] ──────────────► [ Stripe API ]
         │          │                              │
         │          │ (Raw Webhook Buffer)         │ (Webhook Events)
         │          ▼                              ▼
         │   [ POST /webhooks/stripe ] ◄───────────┘
         │          │
         ▼          ▼
   [ PostgreSQL (Prisma) ]  ◄── (Periodic Reconciliation Sweeper)
   • Payments
   • Orders
   • Ledger Transactions
   • WebhookEvent Records
```

---

## 2. Payment Lifecycle & State Machine

Every payment transaction must transition strictly through deterministic states.

```text
[ INITIALIZED ]
       │  (createCheckoutSession / PaymentIntent)
       ▼
   [ PENDING ]
       │
       ├────────────────────────┬────────────────────────┐
       │ (Webhook / Recon)      │ (Payment Failed)       │ (Expired / Timeout)
       ▼                        ▼                        ▼
  [ COMPLETED ]              [ FAILED ]              [ EXPIRED ]
       │
       │ (Customer Return Approved)
       ▼
 [ REFUND_PROCESSING ]
       │
       ▼
   [ REFUNDED ]
```

### State Transition Invariants

| From State          | Allowed Target State | Trigger                                                | Invariants                                                       |
| :------------------ | :------------------- | :----------------------------------------------------- | :--------------------------------------------------------------- |
| `PENDING`           | `COMPLETED`          | Webhook (`payment_intent.succeeded`) or Reconciliation | Must atomically consume inventory hold and credit seller ledger. |
| `PENDING`           | `FAILED`             | Webhook (`payment_intent.payment_failed`)              | Must release inventory hold back to stock.                       |
| `PENDING`           | `EXPIRED`            | Reconciliation / Sweeper (15m hold expiration)         | Must release inventory hold.                                     |
| `COMPLETED`         | `REFUND_PROCESSING`  | Return approved (`return.service.ts`)                  | Provider refund call dispatched with idempotency key.            |
| `REFUND_PROCESSING` | `REFUNDED`           | Webhook (`charge.refunded`) or Direct Confirmation     | Reverses settlement ledger entry, restocks inventory.            |
| `COMPLETED`         | `FAILED`             | **FORBIDDEN**                                          | Terminal state cannot regress to failure.                        |
| `REFUNDED`          | Any                  | **FORBIDDEN**                                          | Terminal state.                                                  |

---

## 3. Stripe PaymentIntent Flow

```text
Client (Web / Flutter)            API Server                      Stripe API
         │                             │                              │
         │ 1. POST /payments/checkout  │                              │
         ├────────────────────────────►│                              │
         │                             │ 2. Create PaymentIntent      │
         │                             │    Idempotency-Key:          │
         │                             │    payment:order:{orderId}   │
         │                             ├─────────────────────────────►│
         │                             │◄─────────────────────────────┤
         │                             │ 3. Return client_secret      │
         │ 4. client_secret & intentId │                              │
         │◄────────────────────────────┤                              │
         │                                                            │
         │ 5. Confirm Payment (Stripe SDK Elements / Mobile Sheet)     │
         ├───────────────────────────────────────────────────────────►│
```

1. **Order Validation**: The order total, currency (`PHP`), and buyer ID must be retrieved strictly from the database. **Never trust client-supplied amounts.**
2. **Idempotency Key**: Every call to `stripe.paymentIntents.create()` must pass `{ idempotencyKey: `payment:order:${order.id}` }`.
3. **Metadata Enrichment**: Attach metadata for traceability:
   ```json
   {
     "orderId": "ord_123",
     "buyerId": "usr_456",
     "storeId": "str_789"
   }
   ```

---

## 4. Webhook Architecture & Signature Security

### Raw Request Body Buffer Requirement

> **CRITICAL**: Stripe signature verification (`stripe.webhooks.constructEvent()`) calculates an HMAC-SHA256 signature against the **exact, unparsed raw bytes** of the HTTP payload.
>
> If the Express server runs `app.use(express.json())` globally, the body will already be deserialized, corrupting signature verification and producing `Error: No signatures found matching the expected signature for payload`.

### Webhook Route Implementation Spec

The Stripe webhook route must be mounted with `express.raw({ type: 'application/json' })` **before** any global JSON parsers:

```typescript
// Example: src/modules/payments/stripe-webhook.route.ts
import express, { Router } from 'express';
import { handleStripeWebhook } from './stripe-webhook.controller';

const router = Router();

// Ensure raw body buffer is preserved
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

export default router;
```

### Signature Verification Logic

```typescript
const sig = req.headers['stripe-signature'];
let event: Stripe.Event;

try {
  event = stripe.webhooks.constructEvent(
    req.body, // Buffer
    sig as string,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
} catch (err: any) {
  logger.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
  return res.status(400).send(`Webhook Error: ${err.message}`);
}
```

---

## 5. Webhook Idempotency & Deduplication

Stripe guarantees **at-least-once** event delivery. Retries and duplicate deliveries are common.

```text
Stripe Webhook Event
         │
         ▼
  Verify Signature
         │
         ▼
  Check webhook_events Table for (event.id)
         │
   ┌─────┴─────┐
   ▼           ▼
[ Exists ]   [ Does Not Exist ]
   │           │
   │ (Log &    ├─► Atomically INSERT INTO webhook_events(id, type, created_at)
   │  Ack 200) ├─► Process Event (State Transitions, Inventory, Ledger)
   │           └─► Return HTTP 200 OK
   ▼
 Return HTTP 200
```

1. Maintain a dedicated table or unique constraint on `processed_webhook_events(event_id)`.
2. Insert the `event_id` within the **same database transaction** that processes the payment or record it before dispatching worker tasks.
3. If `event_id` is already present, log `[Stripe Webhook] Duplicate event ${event.id} skipped` and immediately respond with `HTTP 200 OK`.

---

## 6. Financial Idempotency Standards

Every money-moving operation must have a deterministic idempotency key.

### Key Naming Conventions

| Domain                  | Key Pattern                             | Purpose                                                          |
| :---------------------- | :-------------------------------------- | :--------------------------------------------------------------- |
| **Payment Creation**    | `payment:order:{orderId}`               | Prevents duplicate PaymentIntents for the same order.            |
| **Payment Capture**     | `capture:payment:{paymentId}`           | Prevents double capture if manual capture is used.               |
| **Refund Processing**   | `refund:return:{returnId}`              | Guarantees only one Stripe refund is created per return request. |
| **Merchant Settlement** | `settle:merchant:{merchantId}:{period}` | Prevents duplicate journal entries during settlement batches.    |

---

## 7. Atomic Database State Transitions (Concurrency Guards)

Never write read-then-write code:

```typescript
// ❌ WRONG: VULNERABLE TO RACE CONDITIONS
const payment = await prisma.payment.findUnique({ where: { id } });
if (payment.status === 'PENDING') {
  await prisma.payment.update({ where: { id }, data: { status: 'COMPLETED' } });
  await creditMerchantLedger();
}
```

Always use conditional atomic updates with Prisma count verification:

```typescript
// ✅ CORRECT: ATOMIC CONDITIONAL TRANSITION
const result = await prisma.$transaction(async (tx) => {
  const updated = await tx.payment.updateMany({
    where: {
      id: paymentId,
      status: 'PENDING', // Precondition guard
    },
    data: {
      status: 'COMPLETED',
      providerPaymentId: stripePaymentIntentId,
      completedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    // Another concurrent process (webhook or reconciliation) already completed it
    logger.info(`[Payment] Idempotent skip: Payment ${paymentId} already resolved.`);
    return { alreadyProcessed: true };
  }

  // Atomically fulfill order, consume holds, and create ledger entry
  await orderService.completeOrderInternal(orderId, tx);
  return { alreadyProcessed: false };
});
```

---

## 8. Stripe Refund Lifecycle

Refunds must reverse both external money and internal ledger accounting.

```text
Return Request Approved
         │
         ▼
Call stripe.refunds.create({
  payment_intent: payment.providerPaymentId,
  amount: refundAmountInCents,
}, {
  idempotencyKey: `refund:return:${return.id}`
})
         │
         ▼
Persist Stripe Refund ID (re_xxx) on Return / Payment record
         │
         ▼
Atomically Adjust Internal Ledger:
1. Reverse seller pending balance
2. Debit platform account
3. Restock inventory (if goods were returned to inventory)
```

---

## 9. Background Reconciliation Sweeper

Webhooks are not 100% reliable (network timeouts, DNS issues, maintenance windows). A background worker must periodically reconcile unresolved payments.

### Reconciliation Workflow

```text
[ Cron / Worker: Every 5 Minutes ]
         │
         ▼
Query payments WHERE status = 'PENDING' AND createdAt <= (NOW() - 10 minutes)
         │
         ▼
For each pending payment:
         │
         ├─► Call Stripe API: stripe.paymentIntents.retrieve(paymentIntentId)
         │
         ├─► If status === 'succeeded':
         │      Trigger idempotent completePayment()
         │
         ├─► If status === 'canceled' or requires_payment_method > 30m:
         │      Trigger idempotent failPayment() & release inventory hold
         │
         └─► If status === 'processing':
                Leave in PENDING, re-evaluate next cycle.
```

The reconciliation logic must use the **exact same atomic transition methods** as the webhook handler.

---

## 10. Failure Scenarios & Self-Healing Matrix

| Failure Event                                 | System Behavior & Self-Healing Mechanism                                                                                                    |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| **Duplicate Webhook Delivered**               | Webhook deduplication detects `event.id` or atomic `updateMany` returns `count: 0`. Returns `200 OK` without duplicate side effects.        |
| **Webhook Lost / Never Arrives**              | Payment reconciliation job detects `PENDING` payment after 10m, polls Stripe, and finishes order completion.                                |
| **Concurrent Webhook & Reconciliation**       | Handled atomically via database precondition `WHERE status = 'PENDING'`. First caller wins; second caller gets `count: 0` and exits safely. |
| **Stripe API Timeout on Intent Create**       | Safe retry using identical `idempotencyKey: payment:order:{orderId}`. Stripe returns existing PaymentIntent rather than charging again.     |
| **Duplicate Refund Request**                  | Stripe idempotency key `refund:return:{returnId}` prevents duplicate card credit; returns existing refund object.                           |
| **Worker / Container Crashes Mid-Processing** | Next reconciliation poll or webhook retry recovers the transaction using database transactions (`prisma.$transaction`).                     |
| **Redis Outage**                              | Rate limit middleware falls back to emergency in-memory limits for auth routes (`Math.min(limit, 5)`) with structured security alerts.      |

---

## 11. Testing Requirements

### 1. Unit Tests

- `stripe.provider.test.ts`: Verify `createCheckoutSession`, `refundPayment`, and `verifyWebhookSignature` mock calls and error transformations.
- `paymentReconciliation.job.test.ts`: Verify sweeper handles succeeded, canceled, and pending intents correctly.

### 2. Integration / Failure-Oriented Tests

- **Duplicate Webhook Test**: Send identical `payment_intent.succeeded` event twice in parallel; assert exactly 1 completed payment and 1 ledger entry.
- **Race Condition Test**: Fire webhook handler and reconciliation job simultaneously on the same pending order; assert exactly 1 completion and zero inventory drift.
- **Lost Webhook Recovery Test**: Seed a `PENDING` payment with a succeeded Stripe intent; run reconciliation worker; assert order transitions to `COMPLETED`.
- **Duplicate Refund Test**: Call `refundPayment` twice with the same return ID; assert only one Stripe refund API call succeeds and returns cached response.

---

## 12. Junior Developer Implementation Scope

The junior developer is responsible for implementing the following components strictly against the architecture:

1. **`StripeProvider`**:
   - Location: `src/modules/payments/providers/stripe.provider.ts`
   - Implement `PaymentProviderAdapter` interface methods (`createCheckoutSession`, `refundPayment`, `verifyWebhookSignature`).
2. **Stripe Webhook Route & Controller**:
   - Location: `src/modules/payments/stripe-webhook.route.ts` & `stripe-webhook.controller.ts`
   - Ensure `express.raw()` body parser is configured.
3. **Webhook Deduplication**:
   - Record and check processed `event.id` records.
4. **Reconciliation Job**:
   - Location: `src/modules/payments/jobs/payment-reconciliation.job.ts`
   - Periodic sweeper for stale pending payments.
5. **Unit & Integration Tests**:
   - Write tests covering all failure scenarios listed in Section 11.

---

## 13. Senior Review Checklist (PR Verification)

Before approving any Stripe pull request into `main`, verify:

- [ ] **No Client-Side Amounts**: Is the charge amount calculated from database order lines, never from the client request?
- [ ] **Raw Body Buffer**: Is the webhook route mounted using `express.raw({ type: 'application/json' })`?
- [ ] **Webhook Signature**: Is `stripe.webhooks.constructEvent()` strictly verified?
- [ ] **Idempotency Keys**: Are all `paymentIntents.create` and `refunds.create` calls backed by deterministic idempotency keys?
- [ ] **Atomic SQL Transitions**: Are state transitions guarded by `WHERE status = 'PENDING'` (or equivalent atomic condition)?
- [ ] **Inventory Restocking on Refund**: Does a confirmed refund correctly handle return inventory restocking and settlement ledger reversal?
- [ ] **No Regression in Existing Suites**: Do all 82 existing test suites pass cleanly?

---

## 14. Definition of Done (DoD)

1. Stripe provider implemented with PaymentIntents and Refunds.
2. Webhook endpoint deployed with signature verification and event deduplication.
3. Payment reconciliation job running periodically.
4. All 4 failure-oriented integration tests passing.
5. All existing test suites (980+ tests) pass with zero errors.
6. Documentation updated and signed off by senior engineer.
