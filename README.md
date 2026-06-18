<div align="center">
  <img src="https://nodejs.org/static/images/logo.svg" alt="Node.js Logo" width="120" height="120" />
  <h1>Node.js Enterprise Backend Template</h1>
  <p>A production-ready backend platform foundation with Event-Driven Architecture, full Observability, and automated testing.</p>

  <div>
    <img src="https://img.shields.io/badge/Coverage-95%25-brightgreen?style=flat-square" alt="Coverage" />
    <img src="https://img.shields.io/badge/Build-Passing-brightgreen?style=flat-square" alt="Build" />
    <img src="https://img.shields.io/badge/OpenAPI-Enabled-85EA2D?style=flat-square" alt="OpenAPI" />
    <img src="https://img.shields.io/badge/EDA-RabbitMQ-FF6600?style=flat-square" alt="EDA" />
  </div>
  <br />
  <div>
    <img src="https://img.shields.io/badge/Node.js-20.x-339933?style=flat-square&logo=nodedotjs" alt="Node.js" />
    <img src="https://img.shields.io/badge/Express.js-4.x-000000?style=flat-square&logo=express" alt="Express" />
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Prisma-6.x-2D3748?style=flat-square&logo=prisma" alt="Prisma" />
    <img src="https://img.shields.io/badge/PostgreSQL-15.x-4169E1?style=flat-square&logo=postgresql" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/RabbitMQ-3.x-FF6600?style=flat-square&logo=rabbitmq" alt="RabbitMQ" />
    <img src="https://img.shields.io/badge/Redis-7.x-DC382D?style=flat-square&logo=redis" alt="Redis" />
    <img src="https://img.shields.io/badge/Docker-Enabled-2496ED?style=flat-square&logo=docker" alt="Docker" />
    <img src="https://img.shields.io/badge/Jest-Tested-C21325?style=flat-square&logo=jest" alt="Jest" />
  </div>
</div>

<hr />

## ⚡ Infrastructure Stack

| Layer | Technology |
|---|---|
| **API Framework** | Express.js + TypeScript |
| **Database** | PostgreSQL via Prisma ORM |
| **Message Broker** | RabbitMQ (Topic Exchange, DLQ, Retries) |
| **Cache / State** | Redis (TLS-ready, cache-aside pattern) |
| **Authentication** | JWT (Access + Refresh tokens) |
| **Validation** | Joi |
| **Email** | Nodemailer + Handlebars templates (Ethereal for dev) |
| **Scheduling** | node-cron |
| **Logging** | Winston (JSON in prod / colorized in dev) |
| **Security** | Helmet, CORS, express-rate-limit |
| **API Docs** | Swagger / OpenAPI (dev only) |
| **Testing** | Jest + ts-jest + Supertest |
| **CI/CD** | GitHub Actions |
| **Containers** | Docker + Docker Compose |

---

## 🗺️ Architecture Overview

```mermaid
graph TD
    subgraph CLIENT ["Client"]
        C[Web / Mobile]
    end

    subgraph API ["Express Server · API Process"]
        MW[Correlation Middleware\nrequestId + correlationId]
        R[Router]
        CTR[Controllers]
        SVC[Services]
        REPO[Repositories]
    end

    subgraph WORKERS ["Background Worker Process"]
        CONS[Consumers]
        SCHED[Scheduler\nnode-cron]
    end

    subgraph DATA ["Data Layer"]
        DB[(PostgreSQL)]
        RED[(Redis)]
        RMQ[(RabbitMQ)]
    end

    C -->|HTTP| MW --> R --> CTR --> SVC
    SVC -->|Read/Write| REPO --> DB
    SVC -.->|Cache-aside| RED
    SVC -->|Publish Event| RMQ

    RMQ -->|Consume| CONS
    CONS -.->|Background Work| DB
    SCHED -.->|Scheduled Jobs| DB

    DB --> REPO --> SVC --> CTR -->|JSON Response| C
```

---

## 🎯 Why this template?

Most Express boilerplates stop at **JWT + Prisma**. This template gives you the architecture of a serious production enterprise platform:

- **Strict SRC pattern** — Controllers, Services, Repositories with enforced boundaries
- **Event-Driven Architecture** — RabbitMQ as a first-class citizen, not an afterthought
- **Full Observability** — Correlation IDs flow from HTTP → RabbitMQ → Worker → every log line
- **Production-Grade Resilience** — Exponential backoff reconnect, graceful shutdown, health probes
- **Developer-Ready Helpers** — Response formatting, pagination, caching, and error throwing utilities included
- **Test Coverage** — Unit + Integration tests wired up from day one

### 🚫 Non-Goals

This template intentionally does not include:

- Microservices
- GraphQL
- CQRS / Event Sourcing
- Socket.IO
- Kubernetes manifests
- Multi-tenancy
- AWS-specific integrations

These can be added as extensions, but are intentionally excluded from the core template to keep the foundation deterministic, maintainable, and broadly applicable.

---

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v20+
- [Docker](https://www.docker.com/) & Docker Compose

### Installation

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd node-postg-template

# 2. Install dependencies
npm install

# 3. Copy and configure environment
cp .env.example .env

# 4. Start infrastructure (PostgreSQL · Redis · RabbitMQ)
docker-compose up -d

# 5. Run database migrations
npm run db:setup

# 6. Start the API server
npm run dev
```

In a **separate terminal**, start the background worker:

```bash
npm run worker
```

| Service | URL |
|---|---|
| API | `http://localhost:3002` |
| Swagger Docs | `http://localhost:3002/api/docs` |
| RabbitMQ Dashboard | `http://localhost:15672` (guest / guest) |
| Worker Health | `http://localhost:8080/health` |

---

## 📂 Project Structure

```text
src/
├── controllers/            # HTTP request handlers (thin layer, no business logic)
├── services/               # Business logic, orchestrates repos + publishes events
├── repositories/           # Data access via Prisma
├── middleware/
│   ├── correlation.middleware.ts   # Assigns requestId + correlationId to every request
│   ├── auth.middleware.ts
│   ├── error.middleware.ts
│   └── validation.middleware.ts
├── infrastructure/
│   ├── rabbitmq/           # connection, publisher, consumer, exchanges
│   ├── redis/              # connection singleton (TLS-ready)
│   └── scheduler/          # node-cron scheduled jobs
├── consumers/              # Background job handlers (email, AI)
├── events/
│   └── routing-keys.ts     # Domain event keys
├── helpers/
│   ├── response.helper.ts  # responseSuccess / responseError
│   └── pagination.helper.ts # parsePagination / buildPage / pageFromRepo
├── utils/
│   ├── async-context.ts    # AsyncLocalStorage for correlation IDs
│   ├── logger.ts           # Winston (JSON prod / colorized dev)
│   ├── password.util.ts    # hashPassword / verifyPassword (bcrypt)
│   ├── cache.util.ts       # CacheUtil.remember() — cache-aside pattern
│   ├── mailer.util.ts      # Handlebars email renderer
│   ├── throw-response.ts   # throwResponse() — structured service errors
│   ├── worker-metrics.ts   # Job stats + system metrics
│   └── swagger.ts          # OpenAPI spec
├── templates/
│   └── emails/
│       └── welcome.hbs     # Example Handlebars email template
├── routes/
├── worker.ts               # Worker process entry point
└── server.ts               # API process entry point

tests/
├── unit/
│   ├── password.util.test.ts
│   └── pagination.helper.test.ts
└── integration/
    └── health.test.ts
```

---

## 🏛️ Architecture Principles

### Layer Responsibilities

| Layer | Responsibility |
|---|---|
| **Controller** | Parse HTTP input → call Service → return JSON. No logic. |
| **Service** | Business rules, orchestrate Repositories, publish Domain Events |
| **Repository** | Prisma queries only. No business logic. |
| **Consumer** | Run in the Worker process. Handle one type of event. |

### The Golden Rule

> If it takes time, it goes to RabbitMQ.

Emails, AI inference, report generation, audit logging — none of these belong in the HTTP request lifecycle.

### Why RabbitMQ Instead of BullMQ?

Many developers ask: *Why not just use BullMQ?*

- **BullMQ** is a **Job Queue**. It is designed for task execution (e.g., "process video 123"). It tightly couples the producer and the worker.
- **RabbitMQ** is an **Event Broker**. It is designed for **Event-Driven Architecture**. 

When a user signs up, the API publishes a `user.created` domain event. Multiple independent consumers (EmailConsumer, AuditConsumer, AnalyticsConsumer) can subscribe to this exact same event without the API needing to know about them. This decoupling is essential for enterprise platforms.

### 📚 Architectural Decisions

| Decision | Reason |
|-----------|---------|
| **RabbitMQ over BullMQ** | Event broker for decoupled domain events vs task job queue |
| **Prisma over TypeORM** | Strict type safety and superior Developer Experience (DX) |
| **Joi over Zod** | Single robust validation standard historically proven in Express |
| **PostgreSQL over MongoDB** | Strong consistency and relational data modeling |
| **AsyncLocalStorage** | Zero-friction correlation ID propagation across async boundaries |

---

## 🍰 Vertical Slice: The User Module

A complete feature module demonstrating the end-to-end architecture from an HTTP request to background processing.

```mermaid
sequenceDiagram
    participant Client
    participant Controller as UserController
    participant Service as UserService
    participant Repo as UserRepository
    participant DB as PostgreSQL
    participant Broker as RabbitMQ
    participant Consumer as EmailConsumer

    Client->>Controller: POST /users
    Controller->>Service: createUser(dto)
    Service->>Repo: create(dto)
    Repo->>DB: INSERT
    DB-->>Repo: user record
    Repo-->>Service: user record
    Service->>Broker: publish("user.created", { id, email })
    Service-->>Controller: user dto
    Controller-->>Client: 201 Created

    Broker-->>Consumer: [Async] Consume "user.created"
    Consumer->>Consumer: Send Welcome Email
```

**Files tracing this exact flow:**
1. `src/controllers/user.controller.ts` — Parses request, returns standard response
2. `src/services/user.service.ts` — Executes business rules, orchestrates repository, publishes events
3. `src/repositories/user.repository.ts` — Handles Prisma queries
4. `src/consumers/email.consumer.ts` — Background worker reacting to the new user

---

## 🔄 Request Lifecycle

```text
POST /api/users
       │
       ▼
correlationMiddleware ──── requestId + correlationId assigned
       │                   echoed in x-request-id / x-correlation-id headers
       ▼
Joi Validation Middleware
       │
       ▼
UserController.create()
       │
       ▼
UserService.createUser()
       │
       ├─── UserRepository.create() ─────► Prisma → PostgreSQL
       │
       └─── rabbitmq.publish("user.created", { userId, email })
                  │       correlationId injected into message headers
                  ▼
           JSON Response ◄── HTTP request ends here

════════════════ BACKGROUND WORKER ════════════════
                  │
                  ▼
         Consumer extracts correlationId from message headers
                  │
                  ▼
         asyncLocalStorage.run({ requestId, correlationId })
                  │
                  ▼
         All worker logs share the same correlationId
         as the original HTTP request — full trace across processes
```

---

## 📡 Domain Events

One domain event triggers multiple independent consumers simultaneously.

```mermaid
graph TD
    API[Service] -->|publish| E["Exchange: app.events (topic)"]
    E -->|user.created| Q1[email.queue]
    E -->|user.created| Q2[audit.queue]
    Q1 --> C1[Email Consumer]
    Q2 --> C2[Audit Consumer]
```

### Supported Events

| Routing Key | Payload |
|---|---|
| `user.created` | `{ userId, email, timestamp }` |
| `email.send.requested` | `{ userId, email, subject, body }` |
| `ai.analysis.requested` | `{ userId, imageUrl, analysisType }` |
| `skin.analysis.requested` | `{ userId, imageUrl }` |

**Publishing an event:**

```typescript
import { rabbitmq } from "../infrastructure/rabbitmq";
import { ROUTING_KEYS } from "../events/routing-keys";

await rabbitmq.publish(ROUTING_KEYS.USER_CREATED, {
  userId: user.id,
  email: user.email,
});
```

Every event is automatically wrapped with a metadata envelope:

```json
{
  "metadata": {
    "eventId": "evt-uuid",
    "eventType": "user.created",
    "correlationId": "abc-123",
    "requestId": "req-uuid",
    "timestamp": "2026-06-19T00:00:00.000Z",
    "version": "1"
  },
  "payload": { ... }
}
```

---

## 🔭 Observability

### Correlation & Request IDs

Every HTTP response includes two headers:

| Header | Description |
|---|---|
| `x-request-id` | Unique per HTTP call. Always generated fresh. |
| `x-correlation-id` | Tracks a business operation across processes. Can be passed by a gateway. |

### Log Format

**Development** — human-readable:
```
2026-06-19 10:00:00 info [corr:abc-123]: User created successfully
```

**Production** — structured JSON for DataDog / CloudWatch:
```json
{ "level": "info", "correlationId": "abc-123", "requestId": "req-uuid", "message": "User created" }
```

---

## 🔁 Retry & Dead Letter Strategy

| Attempt | Behaviour |
|---|---|
| 1 | Fails → sent to retry queue with **5s delay** |
| 2 | Fails → sent to retry queue with **5s delay** |
| 3 | Fails → moved to **Dead Letter Queue (DLQ)** permanently |

No data is silently lost. Inspect failed messages in the RabbitMQ dashboard at `http://localhost:15672`.

**Connection Recovery** — If RabbitMQ or Redis restart, both singletons reconnect automatically with exponential backoff (1s → 2s → 4s → … → 30s max).

---

## ❤️ Health Checks

| Endpoint | Process | Description |
|---|---|---|
| `GET /api/health/live` | API | Liveness — process is running |
| `GET /api/health/ready` | API | Readiness — PostgreSQL + Redis + RabbitMQ all up |
| `GET :8080/live` | Worker | Worker liveness |
| `GET :8080/health` | Worker | Worker readiness + job metrics snapshot |

**Readiness Response:**

```json
{
  "status": "ready",
  "timestamp": "2026-06-19T10:00:00.000Z",
  "uptime": 3600,
  "services": {
    "database": "up",
    "redis": "up",
    "rabbitmq": "up"
  }
}
```

---

## 🧰 Helpers Reference

### `responseSuccess` / `responseError`

```typescript
import { responseSuccess, responseError } from "../helpers/response.helper";

return responseSuccess(res, 201, newUser, "User created");
return responseError(res, 404, "User not found");
```

### `parsePagination` / `buildPage` / `pageFromRepo`

```typescript
import { parsePagination, buildPage, pageFromRepo } from "../helpers/pagination.helper";

const { page, limit, skip } = parsePagination(req.query);
const [items, total] = await Promise.all([
  prisma.user.findMany({ skip, take: limit }),
  prisma.user.count(),
]);
return responseSuccess(res, 200, buildPage(items, total, { page, limit }));
```

### `CacheUtil.remember()`

```typescript
import CacheUtil from "../utils/cache.util";

const user = await CacheUtil.remember(`user:${id}`, 300, () => UserRepository.findById(id));
```

### `throwResponse()`

```typescript
import { throwResponse } from "../utils/throw-response";

// In Services — caught by global error middleware
throwResponse(404, "User not found");
throwResponse(409, "Email already taken", { conflictField: "email" });
```

### `hashPassword` / `verifyPassword`

```typescript
import { hashPassword, verifyPassword } from "../utils/password.util";

const hash = await hashPassword(plainText);
const isValid = await verifyPassword(plainText, hash);
```

---

## 📤 API Response Format

### Success
```json
{ "status": "success", "statusCode": 201, "data": {}, "message": "User created" }
```

### Paginated List
```json
{
  "status": "success",
  "statusCode": 200,
  "data": {
    "items": [],
    "total": 87,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

### Error
```json
{ "status": "error", "statusCode": 404, "message": "User not found" }
```

---

## ✅ Production Readiness Checklist

Before deploying:

- [ ] Change JWT secrets (`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`)
- [ ] Enable HTTPS / TLS on your load balancer
- [ ] Configure SMTP provider credentials
- [ ] Configure Redis TLS (`REDIS_TLS=true`)
- [ ] Configure RabbitMQ credentials and virtual host
- [ ] Enable log aggregation (Datadog, CloudWatch, etc.)
- [ ] Run database migrations (`npx prisma migrate deploy`)
- [ ] Verify readiness endpoints (`/api/health/ready`)
- [ ] Configure database backup strategy
- [ ] Configure monitoring alerts for DLQs and health probes

---

## 🚢 Production Deployment

Run API and Worker as **separate processes** for independent scaling:

```
API Containers (×2)         Worker Containers (×5)
      │                            │
      └─────────┬──────────────────┘
                │
            RabbitMQ
                │
    ┌───────────┼───────────┐
PostgreSQL     Redis     CloudWatch
```

| Process | Scales based on |
|---|---|
| API | HTTP request throughput |
| Worker | Queue depth / job processing time |

---

## 🛠️ Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start API server (Nodemon) |
| `npm run worker` | Start Worker process (Nodemon) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Start compiled API |
| `npm test` | Run all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:coverage` | Tests with coverage report |
| `npm run lint` | Lint and auto-fix |
| `npm run db:setup` | Prisma generate + migrate |
| `npm run db:seed` | Run database seed |

---

## 🔑 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | API server port |
| `NODE_ENV` | `development` | Environment |
| `DATABASE_URL` | — | Prisma connection string |
| `ACCESS_TOKEN_SECRET` | — | JWT signing secret |
| `REFRESH_TOKEN_SECRET` | — | JWT refresh secret |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_TLS` | `false` | Enable TLS (ElastiCache, Upstash) |
| `REDIS_TTL_SECONDS` | `3600` | Default cache TTL |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | AMQP connection URL |
| `WORKER_HEALTH_PORT` | `8080` | Worker health probe port |
| `METRICS_INTERVAL_MS` | `60000` | Worker metrics log interval |
| `MAILER_TRANSPORT_HOST` | `smtp.ethereal.email` | SMTP host |
| `MAILER_EMAIL` | — | SMTP user |
| `MAILER_PASSWORD` | — | SMTP password |

See `.env.example` for the full list including AWS, Google OAuth, and WebSub.

---

## 🚀 Roadmap

- [ ] Role-Based Access Control (RBAC)
- [ ] Refresh token rotation
- [ ] Audit logging consumer
- [ ] Prometheus + Grafana metrics
- [ ] OpenTelemetry distributed tracing

---

<div align="center">
  <i>Built with ❤️ using Node.js · Express · Prisma · RabbitMQ · Redis</i>
</div>
