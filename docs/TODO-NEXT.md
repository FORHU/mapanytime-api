# 📋 Next tasks — handoff

Written 2026-08-12 at the end of a session on
`feat/analytics-events-and-permission-gates`. Everything here is **open work**;
what is already finished is listed at the bottom so you don't redo it.

Ordered by "would hurt if skipped", not by size.

---

## 1. 🔴 Isolate the staging workflow before deploying it anywhere

**Why this is first:** `deploy-staging.yml` and `deploy-production.yml` are
currently identical in every host-level name:

|                  | staging                             | production       |
| ---------------- | ----------------------------------- | ---------------- |
| `CONTAINER_NAME` | `mapanytime-api`                    | `mapanytime-api` |
| `APP_PORT`       | `4002`                              | `4002`           |
| env file         | `/home/ec2-user/mapanytime-api.env` | same             |
| docker network   | `mapanytime`                        | same             |
| worker port      | `127.0.0.1:8080`                    | same             |

The **only** thing separating them is which host `secrets.EC2_HOST` resolves
to. Pointed at the same box, a staging deploy overwrites production's env file,
`docker rm`s its container and rebinds its port — and nothing about that looks
like a mistake until production is down.

A separate EC2 is the better answer for a real production system. Do this
anyway: it costs nothing on a separate host and is what makes a shared host
survivable.

### Change `deploy-staging.yml` only — leave production alone

Replace the `env:` block:

```yaml
env:
  ECR_REPOSITORY: mapanytime-api-staging
  AWS_REGION: ap-southeast-1
  NODE_ENV: staging
  IMAGE_TAG: ${{ github.event.workflow_run.head_sha || github.sha }}
  EC2_IAM_ROLE_NAME: forhu-staging-mapanytime-api-role

  CONTAINER_NAME: mapanytime-api-staging
  WORKER_NAME: mapanytime-api-worker-staging
  DOCKER_NETWORK: mapanytime-staging
  ENV_FILE_NAME: mapanytime-api-staging.env

  # APP_PORT is what the app listens on *inside* the container; HOST_PORT is
  # what gets published on the EC2 host. Only the host-facing side has to
  # differ from production, so the container keeps 4002 and no app config
  # changes.
  APP_PORT: 4002
  HOST_PORT: 4003
  WORKER_PORT: 8080
  WORKER_HOST_PORT: 8081
```

Then work through the rest of the file — **all of these, or the isolation is
only partial**:

- [ ] "Write env file" step: `cat > ${{ github.workspace }}/${{ env.ENV_FILE_NAME }}`
      (keep `PORT=${{ env.APP_PORT }}` — the container still listens on 4002)
- [ ] "Copy env file to EC2": `source: ${{ env.ENV_FILE_NAME }}`
- [ ] Deploy script: every `/home/ec2-user/mapanytime-api.env` →
      `/home/ec2-user/${{ env.ENV_FILE_NAME }}` (there are two: the `chmod` and
      the `source`, plus each `--env-file`)
- [ ] Every `--network mapanytime` → `--network ${{ env.DOCKER_NETWORK }}`
      (three: migration, api, worker)
- [ ] API publish: `-p ${{ env.HOST_PORT }}:${{ env.APP_PORT }}`
- [ ] Worker container name: `${{ env.CONTAINER_NAME }}-worker` →
      `${{ env.WORKER_NAME }}`
- [ ] Worker publish: `-p 127.0.0.1:${{ env.WORKER_HOST_PORT }}:${{ env.WORKER_PORT }}`
- [ ] Health check URL: `http://127.0.0.1:${{ env.HOST_PORT }}/api/health/live`
- [ ] `docker logs` on failure: `${{ env.CONTAINER_NAME }}` (already correct
      once the env var changes)

Worth adding while you're in there — nothing currently creates the network, so
the first deploy fails on `--network`:

```bash
docker network inspect ${{ env.DOCKER_NETWORK }} >/dev/null 2>&1 \
  || docker network create ${{ env.DOCKER_NETWORK }}
```

> ⚠️ `docker image prune -f` at the end of the script is **host-wide**. On a
> shared box it will also collect production's untagged layers. Harmless in
> practice (prod's running image is tagged and in use) but worth knowing.

---

## 2. 🔴 The staging auto-trigger is dead

`deploy-staging.yml` triggers on `workflow_run` for branch `staging`, and
**there is no `staging` branch on origin**:

```bash
git ls-remote --heads origin staging   # returns nothing
```

So merging to `main` deploys nothing, and manual `workflow_dispatch` is the
only path. This is the likely reason staging is still sitting on `0_init`.

- [ ] Either create the `staging` branch, or repoint the trigger at `main`

The job's own guard is **correct** — `conclusion == 'success' && event ==
'push'` — so it won't deploy a red CI run once the branch exists. No change
needed there.

---

## 3. 🟠 Provision the staging EC2

Assumes a separate instance. If sharing with production, task 1 must land
first.

On the box:

```bash
sudo dnf install -y docker && sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user          # then log out/in

# AWS CLI v2 — the deploy script calls `aws ecr get-login-password`
aws --version || { curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o a.zip \
  && unzip -q a.zip && sudo ./aws/install; }

curl --version || sudo dnf install -y curl   # the health-check loop needs it

docker network create mapanytime-staging
```

- [ ] Public half of `EC2_SSH_KEY` in `~/.ssh/authorized_keys` for `ec2-user`
- [ ] Security group: `4003` from your ALB, `22` from the runners

### ⚠️ The `localhost` trap

The workflow defaults `REDIS_HOST` to `localhost` and `RABBITMQ_URL` to
`amqp://guest:guest@localhost:5672/`. **Inside a container `localhost` is the
container itself**, so those defaults can never work. They must be set as real
secrets.

If self-hosting both on the box:

```bash
docker run -d --name redis-staging    --network mapanytime-staging --restart unless-stopped redis:7-alpine
docker run -d --name rabbitmq-staging --network mapanytime-staging --restart unless-stopped rabbitmq:3-management-alpine
```

→ `REDIS_HOST=redis-staging`, `RABBITMQ_URL=amqp://guest:guest@rabbitmq-staging:5672/`

Sharing one Redis/RabbitMQ between environments also works, but only with a
separate RabbitMQ **vhost** and a separate Redis **database index** — otherwise
staging traffic lands in production queues and cache keys.

> This matters specifically for the analytics work: if RabbitMQ is unreachable
> the API still accepts events — the service falls back to writing them
> straight to Postgres and reports `transport: 'direct'`. It will **not** look
> broken. You just silently lose the batching.

### AWS side

- [ ] ECR repo `mapanytime-api-staging` in `ap-southeast-1`
- [ ] IAM role named exactly `forhu-staging-mapanytime-api-role`, attached as
      the instance profile. The workflow runs `aws iam put-role-policy` against
      that name, so it must already exist, and the Actions credentials need
      `iam:PutRolePolicy` on it.

### GitHub side

- [ ] Environment **`staging`** with `EC2_HOST`, `EC2_SSH_KEY`, `DATABASE_URL`,
      `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `REDIS_*`, `RABBITMQ_URL`,
      `CORS_ORIGIN`, `AWS_S3_BUCKET_NAME`
- [ ] **Environment-scoped, not repo-level.** A repo-level `EC2_HOST` resolves
      to the same value in both workflows, which is exactly the collision task
      1 is about.

---

## 4. 🟠 Deploy staging

Once 1–3 are done. **Do not SSH in and run `prisma migrate deploy` by hand** —
both pipelines already run it on the host, from the image being deployed,
before the container swap and under `set -e`. Running it manually migrates the
database without shipping the matching code.

- [ ] Run the **Deploy Staging** workflow via `workflow_dispatch`
- [ ] Five migrations are pending on staging (four property/approval + the new
      `20260812150000_analytics_events`)
- [ ] Tell the team to `npx prisma migrate reset` locally — **not**
      `migrate dev`, which gets confused by the squashed baseline

Full runbook: [`staging-deploy.md`](./staging-deploy.md).

---

## 5. 🟠 Browser pass on `mapanytime-market-web`

The largest genuinely unverified thing in the workspace. Those fixes were
typechecked and built, never looked at — and the same backlog records a
component that passed typecheck while being **completely unreachable in the
UI** (`ApkDownloadModal`, where the landing page rendered its own inline stub
with no `onClick`).

Playwright is already configured: `pnpm test:e2e`, `testDir: ./e2e`, auto-starts
the dev server on `:4000`. Only `home.spec.ts` and `theme.spec.ts` exist today.

- [ ] Run it, then click through the app for real
- [ ] Note this project uses **pnpm**, not npm

---

## 6. 🟡 API test coverage

23 suites / 180 tests for 27 modules. Still with no tests at all:

```
agent  adminApprovals  merchantAds  categories  users  payouts  returns
shipments  notifications  supplierProducts  audit  files  appRelease  fileUpload
```

Highest value next, by risk: `adminApprovals` (approval workflow, and its auth
gate changed this session), `agent`, `categories`, `users`.

Convention in this repo: **mutation-check** the test, don't just run it green.
Break the rule deliberately, confirm the test fails, restore.

---

## 7. 🟡 Analytics phases 2–7

Phase 1 (ingestion) is done. From
[`analytics-evaluation.md`](./analytics-evaluation.md):

- [ ] **Phase 2** — session dedup. The `sessionId` column and the API contract
      exist; the web client still needs to generate a UUID on first visit and
      persist it. Dedup happens at aggregation, not ingestion.
- [ ] **Phase 3** — daily aggregation into `DailyProductStats` /
      `DailyStoreStats`. A nightly job is more resilient than a materialized
      view and easier to monitor.
- [ ] **Phase 4–7** — trending/popularity, search ranking, personalisation, ML

### Partitioning — do this before volume gets real

`AnalyticsEvents` is a plain table today. Partitioning by range on `occurredAt`
was deliberately deferred: it needs the partition key in the primary key, plus
a mechanism to create future partitions (pg_partman or a cron job). **Without
that mechanism, inserts fail once past the last partition** — which is a worse
outage than the problem it solves. It was not worth building blind against a
database I couldn't test.

The table is append-only and empty, so this stays cheap for a while.

---

## 8. ⚪ Small stuff

- [ ] `Dockerfile` says `EXPOSE 3002` but everything runs on 4002. Harmless
      (`EXPOSE` is documentation, and the env file sets `PORT`), just
      misleading.
- [ ] **No file under `src/modules/` carries an `@swagger` JSDoc block**, so
      the two module globs in `src/utils/swagger.ts` contribute nothing —
      all 26 paths come from the 9 YAML files in `src/swagger/`. Either start
      annotating routes or drop the globs. `tests/unit/swagger.spec.test.ts`
      guards whichever you choose.
- [ ] `/v1/admin/app-releases` is still on the coarse `requireAdmin`. Nothing
      in `SYSTEM_PERMISSIONS` describes publishing a mobile release; add a
      `releases.manage` code if you want it gated like the others.

---

## ✅ Already done this session — don't redo

On `feat/analytics-events-and-permission-gates` (8 commits, pushed to origin).
Gates at handoff: `tsc` / `lint` / `prettier` / `prisma validate` clean,
**23 suites / 180 tests passing**.

|                               |                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Swagger guard**             | `tests/unit/swagger.spec.test.ts` resolves every configured glob against disk and asserts each YAML contributes its declared paths. Mutation-checked.                     |
| **`requirePermission` wired** | `/v1/rbac` + role-writing user endpoints → `users.roles`; `/v1/admin/approvals` → `stores.approve`; `GET /v1/users/:userId` → `users.manage`. Behaviour-preserving today. |
| **Analytics phase 1**         | `POST /v1/analytics/events` → RabbitMQ → batching worker → `AnalyticsEvents`. Anonymous-capable, with a direct-write fallback.                                            |
| **Batch consumer**            | `src/infrastructure/rabbitmq/batch-consumer.ts` on a dedicated channel.                                                                                                   |
| **cart + payment tests**      | 32 tests across the two money paths, mutation-checked.                                                                                                                    |
| **bcrypt flake**              | Diagnosed and fixed — a 5s jest timeout vs. cost-12 hashing under parallel load, not a defect.                                                                            |
| **Docs**                      | This file, `staging-deploy.md`, plus `RESUME-HERE.md` / `modular-migration.md` refreshed.                                                                                 |

### Two traps worth carrying forward

1. **`requirePermission` can only ever widen access** — it short-circuits on
   `isAdmin`. Gating an admin surface with `stores.manage`, `orders.view` or
   `analytics.view` would hand every SELLER access to it, because the seeder
   grants those three to non-admin roles.
   `tests/unit/permission.gates.test.ts` asserts no route does.

2. **`.env`'s `DATABASE_URL` is not fixed.** It pointed at **staging**
   (`forhu-staging-…-postgres`) and at `localhost` on the same day. `.env` is
   gitignored, so nothing in the tree tells you which. Check before any command
   that writes — `migrate dev`, `db:setup`, `db:seed` and `migrate reset` all
   hit whatever it points at. This is why
   `20260812150000_analytics_events` has hand-written SQL rather than SQL from
   `migrate dev`; it was verified against `prisma migrate diff --from-empty`,
   then applied to a local Postgres and inspected (12 columns, 7 indexes plus
   the pkey, 8 enum values, 0 foreign keys, insert/read/delete round-trip).
