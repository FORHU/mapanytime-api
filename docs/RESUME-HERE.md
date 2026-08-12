# 🔖 Resume Here — state as of 2026-08-12

Written mid-session because of a power outage. Everything below is **committed
and pushed**, so nothing is lost if this machine goes down.

---

> ## ✅ The merge described below has happened
>
> `feat/refactor-revamp` landed on `main` as **PR #45** (`244e5fb`) later on
> 2026-08-12. The "do this first" section is kept for the record but is no
> longer an instruction — staging is no longer blocked by the checksum
> mismatch.
>
> **The deploy steps moved to [`staging-deploy.md`](./staging-deploy.md)**,
> which also documents a hazard found afterwards: the repo's local `.env`
> `DATABASE_URL` points at **staging**, so `migrate dev` / `db:setup` /
> `migrate reset` from a normal checkout write to the shared database.
>
> Follow-up status, as of the same day:
>
> | Follow-up                      | Status                                          |
> | ------------------------------ | ----------------------------------------------- |
> | `requirePermission` unenforced | ✅ Done — gates on rbac, approvals, user admin  |
> | Swagger globs unguarded        | ✅ Done — `tests/unit/swagger.spec.test.ts`     |
> | Coverage thin                  | ◐ Improved — 23 suites / 180 tests, gaps remain |
> | Web never got a browser pass   | ❌ Still outstanding                            |
> | "Flaky" test                   | ✅ Reproduced and fixed — bcrypt vs. 5s timeout |

---

## Where things stand

|               |                                                          |
| ------------- | -------------------------------------------------------- |
| Branch        | `feat/refactor-revamp`                                   |
| Local HEAD    | `b5d668c`                                                |
| Remote        | `b5d668c` — **in sync, fully pushed**                    |
| `main`        | `9d43276` (PR #43 merged by Reign)                       |
| Merge to main | **clean fast-forward, 8 commits, no conflicts possible** |
| Working tree  | clean                                                    |

Gates, last run: `tsc` 0 · `lint` 0 · `prettier` 0 · `prisma validate` 0 ·
`npm test` 16 suites / 99 tests.

---

## ⚠️ Do this first — staging is broken from `main`

Staging's `_prisma_migrations` table holds **one row, `0_init`**, recorded with
the checksum of the _squashed_ baseline (1404 lines). `main`'s `0_init` is the
**original** file (1215 lines, different checksum) sitting under 13 migrations.

So right now, `npx prisma migrate deploy` against staging **from `main` will
fail** — checksum mismatch, then 12 migrations for tables that already exist.

**Merging `feat/refactor-revamp` into `main` is what fixes this.** Nothing else
will.

### After the merge, in order

1. **Deploy the new migrations to staging** — it only has `0_init`; Jahz's four
   property/approval tables are not there yet:
   ```bash
   npx prisma migrate deploy
   ```
2. **Tell the team to reset their local DBs** — their history won't match the
   squashed baseline:
   ```bash
   npx prisma migrate reset
   ```
   Do **not** tell them to run `migrate dev`; it will get confused.
3. If `tsc` complains about missing Prisma models (`merchantAds`,
   `primaryCategory`, `MERCHANTADKIND`, properties types) the schema is fine and
   the generated client is stale — `npx prisma generate`.

---

## What the 8 commits contain

```
b5d668c  Merge main (PR #43 properties/approvals) into feat/refactor-revamp
fdb3a4f  style: prettier + record the verification pass in the migration doc
7a245fa  fix: repair swagger globs, eslint override and docs after the migration
803953f  chore(db): squash 9 migrations into a single 0_init baseline
de175d0  fix: require admin auth on /v1/rbac, drop an unnecessary cast
efe44a7  test: cover rbac, move the router aggregator out of src/routes/
7a1bc5d  refactor: migrate remaining 9 features into src/modules
31e2ca5  refactor: finish shim removal and rewire rbac to its service
```

Headlines:

- **Modular migration complete** — `src/controllers/`, `src/services/`,
  `src/repositories/` and `src/routes/` no longer exist. 26 modules under
  `src/modules/`; the router aggregator is `src/routes.ts`. Full record in
  [`modular-migration.md`](./modular-migration.md).
- **Security fix** — `/v1/rbac` had **no authentication at all**; all four
  endpoints, including `POST /roles` and `PUT /roles/:roleId/permissions`, were
  reachable with no credentials. Now `authenticate + requireAdmin` at the
  router, covered by `tests/integration/rbac.auth.test.ts`.
- **Migrations squashed** 9 → 1 (`0_init`), staging baselined in place, zero
  drift, no table dropped or recreated.
- **Swagger was serving 0 endpoints** — its globs pointed at deleted folders.
  Now 26 paths / 31 operations.

---

## The merge with PR #43 — what to know

One conflict, resolved by hand: `src/routes/index.ts` was modified on `main` and
deleted here (it became `src/routes.ts`).

**Git's default resolution silently drops Jahz's three route registrations.**
They were ported manually into `src/routes.ts`:

```
/v1/files            /v1/admin/approvals            /v1/properties
```

If anyone re-does this merge, that is the trap. Verify those three mounts exist
in `src/routes.ts` afterwards.

Migration chain verified coherent: `0_init` contains **none** of the columns
`approval_workflows` adds to `Stores` (`approvalStatus`, `reviewedById`,
`reviewedAt`, `rejectionReason`), so baseline → their four migrations builds the
merged schema exactly.

---

## Open follow-ups (none block the merge)

1. **`requirePermission` is wired into zero routes.** The permission system is
   administrable but unenforced; real authorization is the coarse `requireAdmin`
   role check. The seed data already contains `users.roles` ("Manage Roles &
   RBAC") — the natural gate for the rbac router itself:
   ```ts
   router.use(authenticate, requirePermission('users.roles'));
   ```
   Admins still pass (the middleware short-circuits on `isAdmin`). Left alone
   because choosing which codes guard which endpoints is a policy decision.
2. **Nothing guards the swagger globs.** They broke silently once and will again
   on the next restructure. A test asserting the spec has >0 paths catches it.
3. **Coverage is thin** — 16 suites for 26 modules.
4. **`mapanytime-market-web` never got a browser pass.** Per the earlier review
   backlog, those fixes were only typechecked and built, never visually
   confirmed — and that same backlog records a component that passed typecheck
   while being completely unreachable in the UI. This is the largest genuinely
   unverified thing left in the workspace.

---

## Resolved, for the record

- **The "flaky" test is not reproducible.** One run showed 2 failures in 1 suite
  while a dev server and a concurrent `prisma generate` were running. Since
  then: **9 consecutive clean runs**, 99/99. Treating it as environmental
  contention, not a real defect. If CI flakes, that is the thread to pull.

  **Update — pulled, and it was contention.** It reproduced once the suite grew
  to 23 suites: `tests/unit/password.util.test.ts` hashes at
  `SALT_ROUNDS = 12`, which takes a few hundred ms on an idle machine and
  several seconds when every jest worker is competing for CPU. "Produce a
  unique hash each time" does two sequential hashes against jest's default 5s
  timeout. A timeout, not a defect in the hashing — the tests now carry a 30s
  timeout rather than a lowered cost factor.

## Backups held in scratchpad (this machine only)

- pre-squash migration folders (all 9)
- the original 9 `_prisma_migrations` rows with checksums

Not needed if the merge goes ahead as planned; useful only if the baseline ever
has to be reconstructed.
