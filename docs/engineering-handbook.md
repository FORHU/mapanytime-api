# 🏗️ Engineering Handbook

Architecture decisions, patterns, and standards for contributors and senior engineers.

---

## Design Philosophy

This template is built on three principles:

1. **Separation of concerns is non-negotiable.** HTTP, business logic, and data access must never bleed into each other.
2. **Async operations belong to the worker.** If it takes more than 200ms or the user doesn't need to wait for it, it goes to RabbitMQ.
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
        │  RabbitMQ app.events (topic) │
        └──────┬───────────────────────┘
               │ consumed by
        ┌──────▼───────────────────────┐
        │      Worker Process          │
        │  Consumers · Scheduler       │
        └──────────────────────────────┘
```

---

## Strict Layer Contracts

| Layer | Can call | Cannot call |
|---|---|---|
| Controller | Service | Repository, Prisma, Redis, RabbitMQ directly |
| Service | Repository, CacheUtil, rabbitmq.publish | Prisma directly |
| Repository | Prisma | Service, RabbitMQ, Redis |
| Consumer | Service, Repository | Controller |

Violating this contract creates hidden coupling that becomes unmaintainable at scale.

---

## Infrastructure Singletons

All external connections are managed as **singletons** in `src/infrastructure/`:

```
src/infrastructure/
├── rabbitmq/
│   ├── connection.ts   ← RabbitMQConnection class + rabbitConnection instance
│   ├── publisher.ts    ← publish() — injects event metadata
│   ├── consumer.ts     ← consume() — resumes correlation context
│   ├── exchanges.ts    ← exchange definitions
│   └── index.ts        ← public API: rabbitmq.connect(), .publish(), .consume()
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

4. rabbitmq.publish() reads context and injects into message headers:
   └─ { correlationId, requestId, eventId, eventType, timestamp, version }

5. Worker consumer reads headers:
   └─ asyncLocalStorage.run({ requestId, correlationId }) wraps the handler
   └─ All worker logs carry the same correlationId as the HTTP request
```

### Log Correlation Test

This is how you verify the system works end-to-end:

```bash
# Send a request
curl -X POST http://localhost:3002/api/v1/users \
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

## RabbitMQ Design

### Exchange Topology

```
Exchange: app.events (topic, durable)
  │
  ├─ user.created      → email.queue    → EmailConsumer
  │                    → audit.queue    → AuditConsumer
  │
  ├─ email.send.requested → email.queue
  │
  └─ ai.analysis.requested → ai.queue  → AiConsumer

Exchange: app.dlx (topic, durable)
  └─ * → *.dlq   (dead letter queues — permanent storage of failed messages)
```

### Retry Strategy

```
Message fails
   │
   ▼
Retry count < 3?
   ├─ YES → publish to {queue}.retry
   │         (messageTtl: 5000ms, then re-queued automatically)
   │
   └─ NO  → nack → moves to {queue}.dlq via app.dlx
                    (inspect in RabbitMQ UI: http://localhost:15672)
```

### Adding a New Consumer

1. Create `src/consumers/myfeature.consumer.ts`:

```typescript
import { rabbitmq } from "../infrastructure/rabbitmq";
import { ROUTING_KEYS } from "../events/routing-keys";
import logger from "../utils/logger";

export const startMyFeatureConsumer = async () => {
  await rabbitmq.consume<{ userId: string }>(
    "myfeature.queue",
    ROUTING_KEYS.SOME_EVENT,
    async (payload, metadata) => {
      logger.info(`[MyFeature] Processing event: ${metadata.eventId}`);
      // your logic here
    }
  );
};
```

2. Register in `src/worker.ts`:

```typescript
import { startMyFeatureConsumer } from "./consumers/myfeature.consumer";
await startMyFeatureConsumer();
```

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
await CacheUtil.delByPattern("user:*");
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
  res.status(500).json({ error: "Something went wrong" });
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
- Close RabbitMQ connection (in-flight messages are nacked automatically)

---

## Testing Strategy

### Unit Tests — `tests/unit/`

Test pure functions and utilities in isolation. No infrastructure, no mocking of modules.

```typescript
// Good unit test subject: helpers, utils, pure functions
it("should clamp limit to maxLimit", () => {
  const { limit } = parsePagination({ limit: "999" });
  expect(limit).toBe(100);
});
```

### Integration Tests — `tests/integration/`

Test HTTP endpoints using Supertest. Mock infrastructure (Prisma, Redis, RabbitMQ) at the module level.

```typescript
jest.mock("../../src/infrastructure/redis", () => ({
  redis: { ping: jest.fn().mockResolvedValue(true) }
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
   export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
   ```

3. Import in the module that needs it:
   ```typescript
   import { STRIPE_SECRET_KEY } from "../config";
   ```

**Never** use `process.env.ANYTHING` outside of `config.ts`. This gives you a single source of truth and makes it easy to find all config dependencies.

---

## Scheduled Jobs

All cron jobs are defined in `src/infrastructure/scheduler/index.ts`. The scheduler runs in the **Worker process**, not the API.

```typescript
// Runs daily at 2:00 AM
cron.schedule("0 2 * * *", async () => {
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
- [ ] Dead letter queues monitored (RabbitMQ management plugin or Datadog)
- [ ] Log aggregation configured (CloudWatch, Datadog, etc.)
- [ ] Rate limiting reviewed for your expected traffic volume
