# 🏗️ Engineering Handbook

Architecture decisions, patterns, and standards for contributors and senior engineers.

---

## Design Philosophy

This template is built on three principles:

1. **Separation of concerns is non-negotiable.** HTTP, business logic, and data access must never bleed into each other.
2. **Async operations belong to the worker.** If it takes more than 200ms or the user doesn't need to wait for it, it goes on the event bus.
3. **Observability is structural, not optional.** Correlation IDs, structured logs, and health checks are built into the foundation — not added later.

---

## Layer Architecture

```
┌─────────────────────────────────────────────────┐
│                  HTTP Layer                      │
│  Correlation Middleware → Routes → Controllers   │
└───────────────────┬─────────────────────────────┘
                    │ calls
┌───────────────────▼─────────────────────────────┐
│                Service Layer                     │
│  Business rules · Orchestration · Event publish  │
└───────────────────┬─────────────────────────────┘
                    │ calls
┌───────────────────▼─────────────────────────────┐
│               Repository Layer                   │
│  Prisma queries only. Zero business logic.       │
└───────────────────┬─────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│               Data Layer                         │
│  PostgreSQL · Redis (via CacheUtil)              │
└─────────────────────────────────────────────────┘

        ┌──────────────────────────────┐
        │         Event Bus            │
        │  SNS topic → SQS per consumer│
        └──────┬───────────────────────┘
               │ consumed by
        ┌──────▼───────────────────────┐
        │      Worker Process          │
        │  Consumers · Scheduler       │
        └──────────────────────────────┘
```

---

## Strict Layer Contracts

| Layer      | Can call                                | Cannot call                                   |
| ---------- | --------------------------------------- | --------------------------------------------- |
| Controller | Service                                 | Repository, Prisma, Redis, event bus directly |
| Service    | Repository, CacheUtil, eventBus.publish | Prisma directly                               |
| Repository | Prisma                                  | Service, event bus, Redis                     |
| Consumer   | Service, Repository                     | Controller                                    |

Violating this contract creates hidden coupling that becomes unmaintainable at scale.

---

## Infrastructure Singletons

All external connections are managed as **singletons** in `src/infrastructure/`:

```
src/infrastructure/
├── event-bus/
│   ├── clients.ts         ← SNS + SQS clients (LocalStack endpoint locally)
│   ├── publisher.ts       ← publish() — injects event metadata, SNS Publish
│   ├── consumer.ts        ← consume() — long poll, heartbeat, resumes correlation context
│   ├── batch-consumer.ts  ← consumeBatch() — buffered, for analytics ingestion
│   └── index.ts           ← public API: eventBus.publish(), .publishMany(), .consume(), .consumeBatch(), .ping()
├── redis/
│   ├── connection.ts   ← RedisConnection class + redisConnection instance
│   └── index.ts        ← public API: redis.connect(), .ping(), .close()
└── scheduler/
    └── index.ts        ← startScheduler() — all cron jobs
```

**Rule**: Only infrastructure modules may instantiate connections. Services import from `infrastructure/`, never from `node_modules` directly.

---

## Observability Architecture

### How Correlation IDs Flow

```
1. Request arrives
   └─ correlationMiddleware creates:
      ├─ requestId   = always fresh UUID
      └─ correlationId = x-correlation-id header OR requestId

2. asyncLocalStorage.run({ requestId, correlationId }) wraps the request
   └─ All code in this request's call stack can read the context

3. Logger reads context automatically:
   └─ Every logger.info() call includes both IDs — no manual passing

4. eventBus.publish() reads context and injects it into the event metadata:
   └─ { correlationId, requestId, eventId, eventType, timestamp, version }

5. Worker consumer reads the metadata:
   └─ asyncLocalStorage.run({ requestId, correlationId }) wraps the handler
   └─ All worker logs carry the same correlationId as the HTTP request
```

### Log Correlation Test

This is how you verify the system works end-to-end:

```bash
# Send a request
curl -X POST http://localhost:4002/api/v1/users \
  -H "x-correlation-id: test-trace-001" \
  -H "Content-Type: application/json" \
  -d '{ "email": "test@example.com", "password": "Test1234!" }'

# In your API logs:
# 10:00:00 info [corr:test-trace-001]: User created successfully

# In your Worker logs (different process):
# 10:00:00 info [corr:test-trace-001]: Sending welcome email
```

Same `correlationId` in both processes = full distributed trace.

---

## Event Bus Design

Decided in #127: SNS + SQS replaced RabbitMQ. Locally it is LocalStack, created
by `docker/localstack/init-events.sh`; deployed, `infra/event-bus-setup.sh`.

### Topology

```
SNS topic: <env>-mapanytime-events      (mapanytime-events locally)
  │  every event carries a message attribute eventType = its routing key
  │
  ├─ filter eventType = email.send.requested     → email-send       → EmailConsumer
  │
  └─ filter eventType = analytics.event.recorded → analytics-events → AnalyticsConsumer (batched)

Each queue: a <queue>-dlq twin through a redrive policy (maxReceiveCount 4).
Subscriptions use raw message delivery, so the queue body is the published JSON.
An event with no matching subscription (user.created, today) goes nowhere.
```

### Retry Strategy

```
Handler throws
   │
   ▼
Message is not deleted. Its visibility is set to retryDelaySeconds (30s default)
   │
   ▼
Received again. After 4 receives, SQS moves it to <queue>-dlq instead.

Inspect a DLQ locally (visibility 0 leaves the messages there):
  docker compose exec localstack awslocal sqs receive-message \
    --queue-url http://localhost:4566/000000000000/email-send-dlq \
    --visibility-timeout 0 --max-number-of-messages 10
```

Unparseable messages are logged and deleted: retrying can never fix them.
Delivery is at least once, so every handler must be safe to run twice.

### Adding a New Consumer

Give every consumer its own queue. SQS cannot route by message type, so two
consumers on one queue take each other's messages at random.

1. Add the queue and its event type to `docker/localstack/init-events.sh` **and**
   `infra/event-bus-setup.sh`.
2. Add `MY_FEATURE_QUEUE_URL` to `src/config.ts`, `.env.example`, the compose
   `app`/`worker` environment, and both deploy workflows.
3. Create `src/consumers/myfeature.consumer.ts`:

```typescript
import { eventBus } from '../infrastructure/event-bus';
import { MY_FEATURE_QUEUE_URL } from '../config';
import logger from '../utils/logger';

export const startMyFeatureConsumer = () =>
  eventBus.consume<{ userId: string }>(MY_FEATURE_QUEUE_URL, async (payload, metadata) => {
    logger.info(`[MyFeature] Processing event: ${metadata.eventId}`);
    // your logic here — idempotent
  });
```

4. Add it to the `consumers` list in `src/worker.ts`, so shutdown stops it.
5. Recreate the local queues: `docker compose restart localstack && docker compose up -d --wait localstack`.
6. Run `infra/event-bus-setup.sh` for each environment and set the new variable there before merging.

---

## Redis Usage Patterns

### 1. Cache-Aside (most common)

```typescript
const user = await CacheUtil.remember(`user:${id}`, 300, () => UserRepository.findById(id));
```

### 2. Manual get/set

```typescript
await CacheUtil.set(`session:${token}`, sessionData, 3600);
const session = await CacheUtil.get<SessionData>(`session:${token}`);
```

### 3. Invalidation

```typescript
// Delete single key
await CacheUtil.del(`user:${id}`);

// Delete by pattern (e.g., invalidate all user caches)
await CacheUtil.delByPattern('user:*');
```

### 4. Rate Limiting (built-in)

```typescript
// From the Redis infrastructure (simple fixed-window)
const limited = await redis.getClient().incr(`ratelimit:${ip}`);
```

---

## Error Handling Architecture

### The Chain

```
Service throws throwResponse(404, "Not found")
    ↓
Controller catches via next(error)
    ↓
Global errorHandler middleware (src/middleware/error.middleware.ts)
    ↓
Formats as { status: "error", statusCode, message } JSON response
```

### Never do this in a Controller

```typescript
// ❌ Don't catch and swallow errors
try {
  await UserService.doSomething();
} catch (err) {
  res.status(500).json({ error: 'Something went wrong' });
}
```

```typescript
// ✅ Always pass to next()
try {
  const result = await UserService.doSomething();
  return responseSuccess(res, 200, result);
} catch (err) {
  next(err); // error middleware handles formatting
}
```

---

## Graceful Shutdown

Both `server.ts` and `worker.ts` handle `SIGTERM` and `SIGINT`:

```
SIGTERM received (Docker stop, Kubernetes pod eviction)
   │
   ▼
Stop accepting new HTTP connections (server.close())
   │
   ▼
Drain active requests (10s timeout)
   │
   ▼
Close Redis connection
   │
   ▼
Disconnect Prisma
   │
   ▼
process.exit(0)
```

**Worker adds:**

- Set `isReady = false` (health probe returns 503 immediately)
- Stop WorkerMetrics interval
- Stop every consumer: no new polls, in-flight messages finish and are deleted,
  messages received during shutdown are handed back. Can take up to 20s (an open
  long poll) plus the longest job; a second signal exits at once

---

## Testing Strategy

### Unit Tests — `tests/unit/`

Test pure functions and utilities in isolation. No infrastructure, no mocking of modules.

```typescript
// Good unit test subject: helpers, utils, pure functions
it('should clamp limit to maxLimit', () => {
  const { limit } = parsePagination({ limit: '999' });
  expect(limit).toBe(100);
});
```

### Integration Tests — `tests/integration/`

Test HTTP endpoints using Supertest. Mock infrastructure (Prisma, Redis, the event bus) at the module level.

```typescript
jest.mock('../../src/infrastructure/redis', () => ({
  redis: { ping: jest.fn().mockResolvedValue(true) },
}));
```

### What Not to Test

- Prisma queries — they're tested by Prisma itself
- Third-party SDK behaviour
- Implementation details of infrastructure

---

## Adding a New Environment Variable

1. Add to `.env.example` with a descriptive comment:

   ```env
   STRIPE_SECRET_KEY=""  # Stripe API key for payment processing
   ```

2. Export from `src/config.ts`:

   ```typescript
   export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
   ```

3. Import in the module that needs it:
   ```typescript
   import { STRIPE_SECRET_KEY } from '../config';
   ```

**Never** use `process.env.ANYTHING` outside of `config.ts`. This gives you a single source of truth and makes it easy to find all config dependencies.

---

## Scheduled Jobs

All cron jobs are defined in `src/infrastructure/scheduler/index.ts`. The scheduler runs in the **Worker process**, not the API.

```typescript
// Runs daily at 2:00 AM
cron.schedule('0 2 * * *', async () => {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
});
```

Use the [cron expression generator](https://crontab.guru) to build expressions.

---

## CI/CD Pipeline

```yaml
Push to main/develop
│
▼
.github/workflows/ci.yml
│
├─ TypeScript type check (npx tsc --noEmit)
├─ ESLint (npm run lint)
├─ Unit tests (npm run test:unit)
└─ Integration tests (npm run test:integration)
```

All checks must pass before merging to `main`.

---

## Production Checklist

Before deploying to production:

- [ ] All environment variables set (check against `.env.example`)
- [ ] `REDIS_TLS=true` if using managed Redis (ElastiCache, Upstash)
- [ ] `NODE_ENV=production` (disables Swagger UI, enables JSON logging)
- [ ] Health probes configured in Kubernetes/ECS (`/api/health/live`, `/api/health/ready`)
- [ ] Worker health probe configured (`WORKER_HEALTH_PORT/health`)
- [ ] Dead letter queues monitored (CloudWatch alarm on `ApproximateNumberOfMessagesVisible` of each `-dlq`)
- [ ] Log aggregation configured (CloudWatch, Datadog, etc.)
- [ ] Rate limiting reviewed for your expected traffic volume
