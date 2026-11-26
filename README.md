# mapanytime-api

The backend for **MapAnytime**, a hyperlocal, pickup-only marketplace for the
Philippines. Buyers find stores on a live map, reserve stock, and pay through a
gateway or in cash at pickup. This API serves the Flutter buyer app
(`mapanytime-market-app`) and the seller/admin/agent web portal
(`mapanytime-market-web`), which is also the only admin frontend.

> **Start with [`docs/specs/`](docs/specs/).** The findings register —
> [`FLAGS.md`](docs/specs/FLAGS.md) (F1–F38) and
> [`OPEN-FLAGS.md`](docs/specs/OPEN-FLAGS.md) (F39 onward) — is the record of
> what is known to be wrong, fixed, or decided.
> [`HANDOFF-2026-10-16.md`](docs/specs/HANDOFF-2026-10-16.md) is the most recent
> hand-off, and [`NEXT-SESSION.md`](docs/specs/NEXT-SESSION.md) the operational
> checklist. Cite findings by their F-id, never by a filename (F82).

## Stack

| Layer         | Technology                                                  |
| :------------ | :---------------------------------------------------------- |
| HTTP          | Express 4 + TypeScript, Joi validation, Helmet, CORS        |
| Data          | PostgreSQL via Prisma 6                                     |
| Cache / state | Redis — carts, idempotency keys, rate-limit counters, locks |
| Events        | SNS topic fanned out to SQS queues, with dead-letter queues |
| Realtime      | Socket.IO, Redis adapter across replicas                    |
| Payments      | Xendit and PayMongo adapters, a mock for development, cash  |
| Files         | S3 (MinIO locally), presigned URLs                          |
| Email         | Nodemailer + Handlebars templates in `email-template/`      |
| Scheduling    | node-cron, in the worker process                            |
| Tests         | Jest + ts-jest + Supertest                                  |
| Deploy        | Docker image → ECR, rolled out over AWS SSM (`infra/`)      |

## Two processes, one image

| Process    | Entry           | Runs                                                                             | Start (built)          |
| :--------- | :-------------- | :------------------------------------------------------------------------------- | :--------------------- |
| **API**    | `src/server.ts` | HTTP routes, Socket.IO gateway, reservation and mobility sweepers                | `npm start`            |
| **Worker** | `src/worker.ts` | Email and analytics consumers, every cron job in `src/infrastructure/scheduler/` | `npm run start:worker` |

In a container, always start the worker with `npm run start:worker`.
`npm run worker` is the development command (nodemon over `src/`), and the
image contains only `dist/` — see F113 for what that cost.

## Layout

```text
src/
├── modules/<feature>/     # one folder per feature: route, controller, service, repository
├── routes.ts              # mounts every module under /api/v1
├── middleware/            # auth, CORS allowlist, rate limiting, validation, errors
├── infrastructure/        # event bus (SNS/SQS), redis, socket gateway, scheduler
├── consumers/             # worker-side queue consumers
├── server.ts / worker.ts  # process entry points
prisma/                    # schema, migrations, seeders
tests/unit, tests/integration
docs/specs/                # specs, plans and the findings register
infra/                     # deploy script and IAM policies for the SSM path
```

Features live only in `src/modules/`. Controllers stay thin; business rules go
in services; Prisma calls go in repositories.

## Running locally

Prerequisites: Node 20+ and Docker.

```bash
npm install
cp .env.example .env          # then fill it in — see the warning below
docker compose up -d --wait db redis localstack minio minio-init
npm run db:setup              # prisma generate + migrate dev, local database only
npm run dev                   # API on http://localhost:4002
npm run worker                # in a second terminal
```

> **Check `DATABASE_URL` before any Prisma write.** A `.env` copied from a
> teammate may point at staging. `db:setup` and `db:seed` refuse to run against
> a non-local database (`scripts/check-db-target.ts`); `npx prisma migrate dev`
> on its own does not.

| URL                                      | What                                  |
| :--------------------------------------- | :------------------------------------ |
| `http://localhost:4002/api/v1/...`       | The API                               |
| `http://localhost:4002/api/docs`         | Swagger UI (development only)         |
| `http://localhost:4002/api/health/ready` | Readiness: Postgres, Redis, event bus |
| `http://localhost:8080/live`             | Worker liveness                       |
| `http://localhost:4576`                  | LocalStack (SNS + SQS), no dashboard  |

### Testing payment gateways

Without `PAYMONGO_SECRET_KEY` / `XENDIT_SECRET_KEY`, a gateway falls back to
`MockProvider` and is hidden from checkout (F83). Cash on pickup needs no
gateway.

**Xendit — against the deployed API**, not a tunnel. Its webhook and the
post-payment return page are both served there.

1. Set the GitHub Actions secrets `MAPANYTIME_API_PUBLIC_URL`
   (`https://mapanytime.com`), `XENDIT_SECRET_KEY` and `XENDIT_WEBHOOK_TOKEN`.
   Use an `xnd_development_` key while testing, and take the token from the same
   Xendit mode as the key.
2. In the Xendit Dashboard → Settings → Webhooks, set the URL to
   `https://mapanytime.com/api/v1/payments/webhook/xendit`.
3. Re-run the production deploy, then place an order. It should redirect to
   Xendit, return to `/api/v1/payments/xendit/return`, and flip to paid when the
   webhook lands. A local API can open sessions, but its orders never complete,
   because the webhook goes to the deployed one.

**PayMongo — through a local tunnel.**

1. Fill in the PayMongo variables in `.env` (see `.env.example`).
2. `npm run tunnel` and copy the `https://*.ngrok-free.app` URL.
3. In the PayMongo dashboard, set the webhook to
   `<ngrok-url>/api/v1/payments/webhook/paymongo` and copy its secret into
   `.env`.

Xendit's return URL must be https, carry no port and not be `localhost`
(F71, F73) — `assertCheckoutReturnUrl` checks this at boot.

## Scripts

| Command                   | What it does                                 |
| :------------------------ | :------------------------------------------- |
| `npm run dev`             | API with reload                              |
| `npm run worker`          | Worker with reload (development only)        |
| `npm run build`           | Compile to `dist/`                           |
| `npm start`               | Compiled API                                 |
| `npm run start:worker`    | Compiled worker                              |
| `npm test`                | Every test                                   |
| `npm run check`           | Lint and test                                |
| `npm run lint` / `format` | ESLint / Prettier                            |
| `npm run db:setup`        | Generate the client and migrate (local only) |
| `npm run db:seed`         | Seed (local only)                            |
| `npm run tunnel`          | ngrok to port 4002, for PayMongo webhooks    |

CI runs `prettier . --check`, and that includes markdown in `docs/` (F58). Run
`npx prettier --write` on anything you touch.

## Conventions worth knowing before you change things

- **Responses** go through `responseSuccess` / `responseError`; services throw
  with `throwResponse(status, message)` and the error middleware formats them.
- **Every auth failure is a 401.** Both clients sign out on 401 and on nothing
  else (`auth.middleware.ts`).
- **Stock moves by conditional `UPDATE`**, never read-then-write
  (`inventoryStock.repository.ts`; F43, F75).
- **The socket gateway trusts tokens, not ids.** Notification channels are
  joined by access token; viewport rooms are public (F107).
- **Domain events** are published to an SNS topic and fanned out to one SQS
  queue per consumer, with a correlation id that follows the request into the
  worker's logs. Locally that is LocalStack (`docker/localstack/init-events.sh`);
  deployed, `infra/event-bus-setup.sh` creates it (#127).

## Deployment

The image is built in GitHub Actions, pushed to ECR, and rolled out by
`infra/deploy-remote.sh` over AWS SSM: migrations first (`prisma migrate
deploy`), then the API container, then the worker, each health-checked, plus a
CORS preflight check (F97). Setup steps and IAM policies are in
[`infra/`](infra/); open operational items are in
[`NEXT-SESSION.md`](docs/specs/NEXT-SESSION.md).
