# 🚀 Getting Started

Everything you need to run this template locally in under 5 minutes.

---

## Prerequisites

| Tool               | Version | Install                                                       |
| ------------------ | ------- | ------------------------------------------------------------- |
| **Node.js**        | v20+    | [nodejs.org](https://nodejs.org)                              |
| **Docker Desktop** | Latest  | [docker.com](https://www.docker.com/products/docker-desktop/) |
| **Git**            | Latest  | [git-scm.com](https://git-scm.com)                            |

---

## Step 1 — Clone and Install

```bash
git clone <your-repo-url>
cd node-postg-template
npm install
```

---

## Step 2 — Environment Setup

```bash
cp .env.example .env
```

Open `.env` and set the required values:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/myapp?schema=public"
ACCESS_TOKEN_SECRET="generate-a-strong-secret-here"
REFRESH_TOKEN_SECRET="generate-another-strong-secret-here"
```

> **Tip**: Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Step 3 — Start Infrastructure

```bash
docker-compose up -d
```

This starts:

- **PostgreSQL** on port `5432`
- **Redis** on port `6379`
- **RabbitMQ** on port `5672` (Management UI: `15672`)

Verify everything is running:

```bash
docker ps
```

---

## Step 4 — Run Database Migrations

```bash
npm run db:setup
```

This runs `prisma generate` + `prisma migrate dev`.

---

## Step 5 — Start the Application

**Terminal 1 — API Server:**

```bash
npm run dev
```

**Terminal 2 — Background Worker:**

```bash
npm run worker
```

---

## Step 6 — Verify It's Working

```bash
# Liveness check
curl http://localhost:3002/api/health/live

# Readiness check (all services)
curl http://localhost:3002/api/health/ready
```

Expected response:

```json
{
  "status": "ready",
  "services": { "database": "up", "redis": "up", "rabbitmq": "up" }
}
```

---

## Step 7 — Explore the API Docs

Open [http://localhost:3002/api/docs](http://localhost:3002/api/docs) in your browser.

> Swagger UI is only enabled in `development` mode.

---

## What's Running

| Service       | URL                              | Credentials   |
| ------------- | -------------------------------- | ------------- |
| API Server    | `http://localhost:3002`          | —             |
| Swagger Docs  | `http://localhost:3002/api/docs` | —             |
| RabbitMQ UI   | `http://localhost:15672`         | guest / guest |
| Worker Health | `http://localhost:8080/health`   | —             |

---

## Common Commands

```bash
npm run dev          # Start API with hot reload
npm run worker       # Start Worker with hot reload
npm test             # Run all tests
npm run test:unit    # Unit tests only
npm run db:setup     # Run Prisma migrations
npm run lint         # Lint and auto-fix
```

---

## Next Steps

- Read the **[Beginner Guide](./beginner-guide.md)** to understand the project structure
- Read the **[API Guide](./api-guide.md)** to start building endpoints
- Read the **[Engineering Handbook](./engineering-handbook.md)** for architecture principles
