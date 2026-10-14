# MapAnytime — Project Evaluation

**Evaluated:** 2026-10-14, by reading the working tree across all four
subprojects, with spot-checks of the claims in [`OPEN-FLAGS.md`](OPEN-FLAGS.md)
and [`NEXT-SESSION.md`](NEXT-SESSION.md) against the code.

New findings are registered as **F107–F113** in [`OPEN-FLAGS.md`](OPEN-FLAGS.md),
which stays the single findings register. This document is the overview; the
register is the record. Cite findings by id, not by this filename (F82).

---

## 1. What MapAnytime is

A hyperlocal, **pickup-only** marketplace for the Philippines. Buyers discover
stores on a live map, reserve stock, and pay through a gateway (Xendit live in
sandbox; PayMongo unconfigured) or in cash at pickup. Around that core sit
real-estate listings, mobility tracking ("God's Eye"), merchant map ads, and the
MapPoints loyalty programme. Delivery was cut (F36 / F59).

| Subproject                | Stack                                                                 | Role                                                                                               |
| :------------------------ | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `mapanytime-api`          | Express + TypeScript, Prisma / PostgreSQL, Redis, RabbitMQ, Socket.IO | 31 feature modules under `src/modules/`; separate worker process for queue consumers and cron jobs |
| `mapanytime-market-app`   | Flutter, Riverpod, go_router, Mapbox                                  | Buyer app — map, storefront, cart and checkout, pickup pass, rewards, notifications                |
| `mapanytime-market-web`   | Next.js 15, React 19, TanStack Query, Tailwind (MD3 tokens)           | Seller, admin and agent portals, plus a buyer web flow                                             |
| `mapanytime-market-admin` | Next.js 15, **React 18**                                              | A second admin console — pricing engine, moderation, monitoring                                    |

## 2. What is strong

- **The money and stock paths are careful.** Stock is reserved and released by
  a single conditional `UPDATE` (F43, F75), so the last unit cannot be sold
  twice and a hold cannot be given back twice. Webhooks are idempotent and
  `COMPLETED` is terminal. Checkout carries an idempotency key (F76). The
  gateway call sits outside the order transaction (F74). Refunds restock
  (F87) and are guarded against repeat calls (F88).
- **Authentication is in good shape** after the 2026-09-07 pass: 15-minute access
  tokens, refresh tokens stored only as `jti` plus SHA-256, atomic rotation, and
  family revocation on replay (F98–F106).
- **The findings register is honest.** It records what was verified, what was
  inferred, and what was not checked — rare, and worth protecting.
- **Coverage is real where it matters.** 999 tests across 85 suites pass on the
  API as of this evaluation, concentrated on orders, payments, inventory,
  pricing and auth.

## 3. New findings

| Flag     | Severity | Finding                                                                                                                                                                                 | Status                                                                                   |
| :------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| **F107** | Critical | The Socket.IO gateway authenticated nothing: any client could read any user's notifications by naming their id, push fake notifications to anyone, and post as anyone in chat           | **Fixed** 2026-10-14                                                                     |
| **F108** | High     | The F44 stale-order sweeper cancelled cash-on-pickup orders the seller had not accepted within 15 minutes                                                                               | **Fixed** 2026-10-14                                                                     |
| **F109** | High     | A gateway payment arriving after the sweeper cancelled the order is captured with no order, no stock and no refund                                                                      | **Half fixed** — now detected and logged; refund is a decision                           |
| **F113** | Critical | The deployed worker container never ran: every deploy started it with a dev-only command the image cannot run, so no email, analytics or scheduled job has run on staging or production | **Fixed in code** — confirm on a host before deploying; read the deploy warnings in F113 |
| **F110** | Medium   | Scheduler hygiene: a `TEMP` every-minute purge, two jobs that only log, and the reservation sweep running in every API replica as well as the worker                                    | **Fixed** 2026-10-14                                                                     |
| **F111** | Medium   | Rate-limit emergency caps track the Redis connection, not store health; the APK download limiter counts per instance                                                                    | **Fixed** 2026-10-14                                                                     |
| **F112** | Low      | The API `README.md` is still the original template's and contradicts the system                                                                                                         | **Fixed** 2026-10-14                                                                     |

Detail for each is in [`OPEN-FLAGS.md`](OPEN-FLAGS.md).

### What changed for F107–F109

- **F107.** `subscribe_notifications` now takes `{ token }` and joins the
  channel of whoever the access token belongs to, under the same rules as
  `authenticate` (new `resolveActiveUser` in `auth.middleware.ts`). A `userId` in
  the payload is ignored. `send_notification` and the chat-room events are
  removed — no client used them. Both web call sites and the Flutter
  notification socket send the token, read at emit time so reconnects after a
  refresh still work. Pinned by `tests/unit/socket.notifications-auth.test.ts`
  against a real Socket.IO server.
- **F108.** `expireStalePendingOrders` excludes orders paid by a `CASH` method.
  Pinned in `tests/unit/order.service.expire-pending.test.ts`.
- **F109.** The success webhook detects an order already `CANCELLED` or
  `FAILED`, logs `REFUND OWED` at error level with the payment and order, and
  sends no "confirmed" or "prepare this order" notifications. Pinned in
  `tests/unit/payment.service.test.ts`.

### What changed for F110, F111 and F113

- **F113.** A new `start:worker` script runs the compiled worker, and both deploy
  paths use it. Deploys now fail if the worker's `/live` never answers. The
  shared-dev workflow's worker could not start at all (`-p 127.0.0.1::`); that
  mapping is gone.
- **F110.** Purge back to hourly; the two log-only jobs removed. The duplicate
  reservation sweep is kept on purpose — F113 means the API's copy is the one
  that has actually been running.
- **F111.** Stores report when their Redis commands fail, and the emergency caps
  follow that, not just the connection. The APK download limiter counts in
  Redis.

> **Deploy note for F113 — read before the first deploy with it.** The first
> working worker runs everything that never ran: any email queued since the
> first deploy (including expired reset codes), settlement release for every
> matured settlement, and the stale-order sweep. Check `email.queue` and the
> settlement count first. Details in F113.

> **Deploy note for F107.** App builds already installed send `{ userId }`
> without a token, so they stop receiving live notifications until they update.
> The notification feed over HTTP is unaffected. Ship the API and web together,
> and publish a new APK through App Releases.

## 4. Structural observations

- **Documentation drifts from the code.** This is the register's most frequent
  finding (F57, F59, F60, F67, F82) and it continues. The architecture spec
  describes cron jobs that are stubs and a chat feature with no server-side
  checks. `NEXT-SESSION.md` lists MapPoints (P3-1) as unstarted, but it shipped.
  The API README (F112, since rewritten) listed Socket.IO and AWS as non-goals
  and RBAC as roadmap, though all three exist.
- **Two admin frontends.** `market-web/src/app/admin/*` and
  `mapanytime-market-admin` cover overlapping ground on different React majors.
  Every admin feature risks being built twice, or in the wrong one. Pick one
  home.
- **Redis is a single point of failure for ordering** (F77). The cart lives
  only in Redis.

## 5. Still open from earlier sessions

These carry the most risk and are not new, but nothing in this evaluation found
them closed:

- **`ACCESS_TOKEN_EXPIRY` repository secret.** If it is set, F98's 15-minute
  tokens are not in effect in deployed environments.
- **AWS setup for the SSM deploy path.** Merges to `staging` deploy red until it
  exists.
- **The auth migration has not run on production.** It forces one re-login for
  every user.
- **F86 — who pays the gateway fee on a refund.** Today the platform does,
  silently; one refund costs about what the order's commission earned.
- **F65 — Xendit has no rate card**, and it is the only gateway that can take
  money. Must close before Xendit goes live.
- **F96 — no canonical host**, so `www` and apex behave differently.
- **F84 — the clawback ledger** for refunds after payout needs a migration.

## 6. Recommended order

1. **Confirm F113 on a host** (`docker logs mapanytime-api-worker`), then
   prepare for the catch-up its deploy notes describe.
2. **Deploy F107–F113** — API and web together, then a new APK.
3. **Decide F109's refund**: refund automatically through the adapter when a
   payment lands on a cancelled order, or set the gateway session expiry below
   the sweeper's 15-minute window (Xendit's session expiry field needs
   confirming against the sandbox before relying on it).
4. **Check the `ACCESS_TOKEN_EXPIRY` secret**, then the SSM setup and the
   production auth migration.
5. **Decide F86 and close F65** before any real money moves.
6. **The admin-frontend question** — choose one admin home.
