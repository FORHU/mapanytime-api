# MapAnytime Production Launch & Verification Checklist (MA-15)

**Document Reference:** `mapanytime-api/docs/specs/PRODUCTION_LAUNCH_CHECKLIST.md`  
**Governing Issues:** [FORHU/mapanytime-api#115](https://github.com/FORHU/mapanytime-api/issues/115), [#116](https://github.com/FORHU/mapanytime-api/issues/116), [#134](https://github.com/FORHU/mapanytime-api/issues/134), [#135](https://github.com/FORHU/mapanytime-api/issues/135)  
**Deliverable Tracking:** `MA-12`, `MA-13`, `MA-14`, `MA-15` on FORHU Project Board #32  
**Target Release:** MapAnytime Phase 1–4 Release (F107–F113, Better Auth, SNS+SQS Event Bus, Multi-Gateway Payments, Admin Oversight)

---

## 1. Executive Summary & Release Scope

This checklist governs the promotion of accumulated staging enhancements into the production environment. Merges into `staging` have completed continuous integration (100% CI pass rate). Nothing reaches production until this checklist is formally verified, dispatched, and approved.

### Core Capabilities Being Delivered:

1. **Security & Session Architecture:** Migration from JWT to Better Auth (`#122`, `#123`, `#125`); Socket.IO gateway authentication (`F107`).
2. **Cloud Event Bus:** Migration from RabbitMQ to AWS SNS + SQS (`#127`, `#134`) with filtered raw delivery and dead-letter queues.
3. **Background Worker Hardening:** Resolved worker crash-on-boot bug (`F113`, `#115`) by migrating from `nodemon` to `node dist/worker.js`, enabling automated email delivery, analytics event rollups, and hourly settlement maturation.
4. **Cloud Storage Isolation:** Strict separation of S3 media uploads between `forhu-marketplace-dev` and `forhu-marketplace-prod` (`MA-12`, `MA-13`).
5. **Transactional Email:** Standardized SMTP transport with SSL delivery (`MA-12`, `#135`).
6. **Multi-Gateway Payments & Settlements:** Stripe + Xendit + PayMongo checkout with reconciliation sweepers and administrative oversight consoles.

---

## 2. Pre-Deploy Verification (T-24h to T-1h)

All checks in this section must be verified before triggering the production deployment workflow.

### 2.1 AWS Infrastructure & IAM Readiness (`MA-14`, #134)

- [ ] **OIDC Deploy Identity:** Confirm role `arn:aws:iam::617163942417:role/mapanytime-role` exists with trust policy `aws-oidc-trust-policy.json` and permissions `cicd-deploy-policy.json`.
- [ ] **EC2 Instance Profile:** Confirm the production host instance profile holds:
  - `AmazonSSMManagedInstanceCore` (AWS managed)
  - `ec2-ecr-pull-policy.json` (ECR image pull)
  - `ec2-cloudwatch-logs-policy.json` (Container logging)
  - `ec2-app-runtime-policy-production.json` (Isolated to `forhu-marketplace-prod` and `production-mapanytime-*`)
- [ ] **EC2 Systems Manager Registration:** Run `aws ssm describe-instance-information --region ap-southeast-1` and confirm the production instance is registered as an active managed node with ping status `Online`.
- [ ] **Event Bus Creation (`#134`):** Run the event bus provisioning script in AWS CloudShell:
  ```bash
  bash infra/event-bus-setup.sh production
  ```
  Confirm the following resources are created:
  - SNS Topic: `arn:aws:sns:ap-southeast-1:617163942417:production-mapanytime-events`
  - SQS Queue: `https://sqs.ap-southeast-1.amazonaws.com/617163942417/production-mapanytime-email-send` (with `-dlq`)
  - SQS Queue: `https://sqs.ap-southeast-1.amazonaws.com/617163942417/production-mapanytime-analytics-events` (with `-dlq`)
- [ ] **GitHub Production Variables Set (`#134`):** Confirm that in GitHub repository **Settings → Environments → `production`**, the following environment variables are present:
  - `EVENTS_TOPIC_ARN`
  - `EMAIL_SEND_QUEUE_URL`
  - `ANALYTICS_EVENTS_QUEUE_URL`
  - `AWS_REGION`: `ap-southeast-1`
  - `ECR_REPOSITORY`: `mapanytime`

---

### 2.2 Storage & Media Isolation (`MA-12`, `MA-13`)

- [ ] **Dedicated Bucket Exists:** Verify that S3 bucket `forhu-marketplace-prod` exists in `ap-southeast-1` and is separate from `forhu-marketplace-dev`.
- [ ] **Bucket CORS Policy:** Verify the S3 bucket CORS policy allows browser presigned uploads:
  ```json
  [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedOrigins": ["https://mapanytime.com", "https://admin.mapanytime.com"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```
- [ ] **GitHub Secret Binding:** Verify secret `AWS_S3_BUCKET_NAME` in the GitHub `production` environment is set to `forhu-marketplace-prod`.

---

### 2.3 Transactional Mail Transport (`MA-12`, `#135`)

- [ ] **Mail Credentials Configured:** Confirm the following secrets are configured in the GitHub `production` environment:
  - `MAILER_TRANSPORT_HOST` (e.g. `smtp.gmail.com` or `email-smtp.ap-southeast-1.amazonaws.com`)
  - `MAILER_TRANSPORT_PORT` (`465` or `587`)
  - `MAILER_TRANSPORT_SECURE` (`true` for 465, `false` for 587)
  - `MAILER_EMAIL` (sending mailbox address)
  - `MAILER_PASSWORD` (app password / SMTP credential)

---

### 2.4 Pre-Deploy Host Inspection & Settlement Backlog (`MA-13`, `#115`)

- [ ] **Confirm Prior Worker Status on Host:**
  ```bash
  docker logs mapanytime-api-worker --tail 20
  ```
  _(Expected prior behavior: "Cannot find module .../src/worker.ts" / "app crashed" due to nodemon targeting src/)._
- [ ] **Settlement Maturation Backlog Audit:**
      Query PostgreSQL database before dispatching deploy:
  ```sql
  SELECT
    COUNT(*) AS eligible_count,
    COALESCE(SUM(net_amount), 0) AS total_maturing_amount
  FROM "SellerSettlement"
  WHERE status = 'PENDING'
    AND "releaseEligibleAt" <= NOW();
  ```
  _Note:_ All eligible settlements will automatically transition to `AVAILABLE` during the worker's first hourly execution. Record the count and total value for post-deploy financial reconciliation.

---

## 3. Production Deployment Execution Protocol (T-0)

Deploys must be executed during the designated maintenance window by an authorized engineer.

```mermaid
sequenceDiagram
    autonumber
    actor Lead as Senior Tech Lead
    participant GHA as GitHub Actions (Deploy Production)
    participant ECR as Amazon ECR
    participant SSM as AWS Systems Manager
    participant Box as Production EC2 Host
    participant RDS as Amazon RDS

    Lead->>GHA: Dispatch workflow (ref: staging)
    GHA->>ECR: Build & push Docker image (tagged with SHA)
    GHA->>SSM: Put encrypted SecureString (/mapanytime/production/env)
    GHA->>SSM: SendCommand (executes deploy-remote.sh)
    SSM->>Box: Execute deploy-remote.sh as root
    Box->>RDS: Run prisma migrate deploy
    Box->>Box: Start mapanytime-prod-api (Port 4002)
    Box->>Box: Start mapanytime-prod-worker (node dist/worker.js)
    Box->>Box: Assert CORS preflight & /live health checks
    Box-->>SSM: Report command exit code 0
    SSM-->>GHA: Command Succeeded
    GHA-->>Lead: Deployment Green
```

### Execution Steps:

1. Navigate to **Actions → Deploy Production** in `mapanytime-api`.
2. Click **Run workflow**:
   - `Branch, tag, or SHA to deploy`: Enter `staging` (or release commit SHA).
3. Monitor GitHub Actions build progress:
   - Verify Docker image builds cleanly and pushes to Amazon ECR.
   - Verify `/mapanytime/production/env` is published to Parameter Store.
   - Verify SSM `SendCommand` executes `infra/deploy-remote.sh` on EC2.
4. **Deploy Web in the Same Window:**
   - In `mapanytime-market-web`, dispatch the production deploy workflow to maintain Socket.IO event contract consistency (`F107`).

---

## 4. Post-Deploy Smoke Testing & Verification (T+0 to T+2h)

Perform immediate verification across public endpoints and background services.

### 4.1 Automated Health Probe Verification

- [ ] **API Liveness:**
  ```bash
  curl -I https://mapanytime.com/api/health/live
  ```
  _Requirement:_ HTTP `200 OK`.
- [ ] **API Readiness & Subsystem Status:**
  ```bash
  curl -s https://mapanytime.com/api/health/ready | jq .
  ```
  _Requirement:_ HTTP `200 OK` with JSON payload confirming all dependencies:
  ```json
  {
    "status": "ok",
    "checks": {
      "database": "up",
      "redis": "up",
      "eventBus": "up"
    }
  }
  ```
- [ ] **CORS Preflight Assertion:**
  ```bash
  curl -I -X OPTIONS https://mapanytime.com/api/v1/auth/login \
    -H "Origin: https://mapanytime.com" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type"
  ```
  _Requirement:_ HTTP `204 No Content` with `Access-Control-Allow-Origin: https://mapanytime.com`.

---

### 4.2 Background Worker Execution & Catch-Up Inspection

- [ ] **Worker Container Status:**
      On the EC2 host:
  ```bash
  docker ps --filter "name=mapanytime-prod-worker"
  ```
  _Requirement:_ Container status is `Up` and has not restarted.
- [ ] **Worker Health Check Endpoint:**
  ```bash
  curl -s http://127.0.0.1:8080/live
  ```
  _Requirement:_ HTTP `200 OK` (`{"status":"healthy"}`).
- [ ] **Worker Catch-Up Logs:**
  ```bash
  docker logs mapanytime-prod-worker --tail 100
  ```
  Verify:
  - Email consumer successfully polling `production-mapanytime-email-send`.
  - Analytics consumer successfully polling `production-mapanytime-analytics-events`.
  - Settlement maturation job triggered on the hour with zero unhandled exceptions.

---

### 4.3 End-to-End User Flow Smoke Testing

- [ ] **Customer Authentication:** Log in with an existing account via Better Auth (`/api/v1/auth/login`). Verify session cookie issuance.
- [ ] **Transactional Email:** Trigger a password reset request. Verify email arrives in inbox within 60 seconds.
- [ ] **Media Upload:** Upload a store profile avatar or product image. Verify direct S3 presigned upload resolves to `forhu-marketplace-prod` and displays cleanly on the web storefront.
- [ ] **Admin Console Verification:** Access `/admin/finance` and `/admin/audit-logs`. Verify seller balance summaries and security audit entries display accurately.

---

## 5. Rollback & Contingency Protocol

In the event of an unrecoverable failure during deployment:

### 5.1 Rollback Criteria

Initiate immediate rollback if any of the following occur:

1. `prisma migrate deploy` fails or produces database deadlock.
2. API container fails health checks after 3 deployment attempts.
3. Worker crashes in an unrecoverable boot loop.
4. Core customer checkout or login flows fail on production.

### 5.2 Rollback Procedure

1. **Container Rollback via SSM:**
   Dispatch `Deploy Production` targeting the previous stable commit SHA (or rerun the previous green workflow).
2. **Database Rollback:**
   If a migration must be reverted, connect via secure bastion and execute targeted Prisma down-migration scripts. _(Note: Better Auth table creations are additive and do not break existing schemas if left in place)._
3. **Traffic Divert / Maintenance Page:**
   If the outage exceeds 10 minutes, route Nginx traffic to a static 503 maintenance page.

---

## 6. Sign-off Matrix

| Role                             | Name     | GitHub Login | Date       | Approval Status                 |
| -------------------------------- | -------- | ------------ | ---------- | ------------------------------- |
| **Senior Tech Lead / Author**    | rmValdez | `rmValdez`   | 2026-11-13 | **APPROVED (Ready for Launch)** |
| **Product Manager**              |          |              |            | Pending Sign-Off                |
| **Infrastructure / DevOps Lead** |          |              |            | Pending Sign-Off                |
