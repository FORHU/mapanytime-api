# 🧭 Modular Migration — Complete

Audit date: **2026-08-11**. Migration completed **2026-08-12**. Codebase: `mapanytime-api`.

The API carried two structures side by side: the original layered ("monolith")
folders and the newer feature-module folders. **That is now resolved.**
`src/controllers/`, `src/services/` and `src/repositories/` no longer exist;
every feature lives in `src/modules/`.

This document is kept as a record of what was found and what was done, plus the
conventions the result now follows.

---

## The structure

```
src/modules/<feature>/<feature>.{controller,service,repository,route}.ts
```

23 feature folders under `src/modules/`:

```
agent  appRelease  audit  auth  cart  categories  fileUpload  health
inventory  merchantAds  notifications  orders  payments  payouts  products
rbac  returns  settlements  shipments  stores  supplierProducts  taxation  users
```

**No layered folders remain.** The router aggregator that used to be
`src/routes/index.ts` is now `src/routes.ts` — a single file rather than a
folder holding one file. `src/app.ts` imports it as `./routes`, which resolves
to either form, so that move cost no call-site changes.

### Naming

Folder names are plural where the domain is naturally countable
(`products`, `stores`, `users`), singular otherwise (`auth`, `health`,
`taxation`). File stems stay singular and match the domain object
(`users/user.service.ts`), except for compound camelCase names which keep their
form (`supplierProducts`, `merchantAds`, `fileUpload`,
`inventory/inventoryReservation.*`).

`inventory` holds both `inventory.*` and `inventoryReservation.*`, because
reservations are served as nested paths under `/v1/inventory` from a single
route file.

---

## What was done

### Step 1 — 15 dead shims deleted

Every legacy file that shared a basename with a module file was a re-export
shim, not a forked implementation:

```ts
import CartController from '../modules/cart/cart.controller';
export default CartController;
```

Two used `export *` rather than a default re-export
(`controllers/payment.controller`, `repositories/store.repository`), because the
payments module exports named functions instead of a default class. Nothing
imported any of the 15, so deletion was mechanical.

Also deleted: **`src/routes/payment.route.ts`** — a real router, not a shim,
that nothing imported. `routes/index.ts` had always wired
`modules/payments/payment.route` instead, so Express never saw it. Its only
effect was keeping the `controllers/payment.controller` shim alive. The two went
together.

> The risk with a never-mounted duplicate router is the reverse of what it looks
> like: an endpoint added to it would have silently done nothing.

### Step 2 — 6 load-bearing shims rewritten and deleted

| Shim                               | Importer                              | Rewritten to                             |
| ---------------------------------- | ------------------------------------- | ---------------------------------------- |
| `services/category.service`        | `modules/products/product.service.ts` | `../categories/category.service`         |
| `repositories/category.repository` | `modules/stores/store.service.ts`     | `../categories/category.repository`      |
| `repositories/store.repository`    | `modules/stores/store.service.ts`     | `./store.repository`                     |
| `repositories/product.repository`  | `services/inventory.service.ts`       | `../products/product.repository`         |
| `routes/category.route`            | `routes/index.ts`                     | `../modules/categories/category.route`   |
| `services/store.service`           | `tests/unit/store.service.test.ts`    | `../../src/modules/stores/store.service` |

`store.service.ts` had been reaching **outside its own module** for its own
repository — a straight self-reference bug in the original migration.

**Test coupling:** `tests/unit/store.service.test.ts` imported _and_
`jest.mock`d the legacy store paths. All three lines had to move together —
otherwise the mock silently stops matching the module under test and the test
passes against an unmocked repository.

### Step 3 — rbac rewired to its service

`src/controllers/rbac.controller.ts` bypassed the existing `RbacService` and
`RbacRepository` (which nothing imported) to call `prisma` directly through four
`as unknown as { ... }` casts.

**The stated reason for those casts was wrong.** `Permissions` and
`RolePermissions` are defined in `prisma/schema.prisma` and are on the generated
client — `rbac.repository.ts` had always called `prisma.permissions` and
`prisma.rolePermissions` cast-free and type-checked clean. The casts were
unnecessary from the start and were suppressing nothing.

The controller now delegates to `RbacService` and holds only HTTP concerns.
All four casts and both hand-written `PermissionRecord` / `RoleWithPermissions`
interfaces are gone; types come from the Prisma client. 165 → 62 lines.

> This was unverified by tests at the time — see step 5, which closed that gap.

### Step 4 — the remaining 9 features migrated

auth, users, agent, fileUpload, health, inventory, inventoryReservation,
taxation and rbac moved to `src/modules/` (29 files, via `git mv` to preserve
history). Imports inside the moved files were rewritten on two rules:

- intra-feature (`../services/x.service`) → `./x.service`
- everything else gains one level, since `src/controllers/` and
  `src/modules/<feature>/` sit at the same depth but no longer share a parent

Five call sites outside the moved features needed updating —
`middleware/auth.middleware.ts`, `types/express.d.ts`,
`infrastructure/scheduler/index.ts`, `modules/orders/order.service.ts` and the
router aggregator — plus six test files.

### Step 5 — rbac test coverage, and the last folder

`tests/unit/rbac.controller.test.ts` and `tests/unit/rbac.service.test.ts` close
the gap left by step 3 (17 tests). Both were mutation-checked rather than merely
run green: removing the `permissionIds.length > 0` guard in the service fails 2
tests, and dropping the `Array.isArray(permissionCodes)` validation in the
controller fails 1.

The service tests pin the behaviour that is easy to regress silently — that
`updateRolePermissions` clears _before_ it assigns, and that an empty or
unmatched code list still clears rather than becoming a no-op.

`src/routes/index.ts` then moved to `src/routes.ts`, removing the last layered
folder.

---

## Cross-module coupling

Light and appropriate for a marketplace domain. Nine edges, all now
module-to-module rather than routed through legacy folders:

```
agent     → stores      cart      → products
inventory → products    orders    → cart
payments  → products    orders    → products
products  → categories  orders    → taxation
stores    → categories
```

`orders → taxation` was the last edge pointing out of `src/modules/` into the
layered folders; it resolved when taxation moved.

---

## Verifying

```bash
npx tsc --noEmit     # clean
npm run lint         # clean
npm test             # 14 suites / 85 tests passing
```

Use npm/npx here — not bun.

**If `tsc` reports missing Prisma models** (`merchantAds`, `merchantAdProducts`,
`primaryCategory`, `MERCHANTADKIND`), the generated client is stale rather than
the schema being wrong — run `npx prisma generate`. This bit after picking up
the merchantAds work on 2026-08-12.

Stale `dist/` output can also contain references to the deleted layered paths.
`dist/` is gitignored and is not part of the build inputs; rebuild to clear it.

---

### Step 6 — what the migration broke, and a pre-existing hole

A verification pass before merging found three things pointing at deleted
folders. **None were caught by `tsc`, lint or the tests**, because all three are
string paths resolved against the filesystem at runtime:

- **swagger** globbed `./src/routes/*.ts`, `./src/controllers/*.ts` and
  `./src/docs/*.yaml`. All three were dead — the first two removed here, and the
  YAML had separately moved to `src/swagger/`. `swagger-jsdoc` fails silently on
  a glob matching nothing, so `/api-docs` was serving **0 paths**. Now 26 paths /
  31 operations.
- **eslint**'s `no-return-await` override targeted `src/repositories/*.ts` and
  silently stopped applying. Retargeted at `src/modules/**/*.repository.ts`.
- **README and the beginner guide** still described the layered layout, with
  four broken relative links.

> The lesson generalises: a restructure is only as safe as the string paths
> nobody type-checks. Grep for the old folder names in _every_ file type —
> configs, globs, docs — not just imports.

Separately, the pass found that **`/v1/rbac` had no authentication at all**. The
router was mounted bare, so all four endpoints — including `POST /roles` and
`PUT /roles/:roleId/permissions` — were reachable with no credentials. This
predates the migration; the move only relocated the file. Now guarded at the
router with `authenticate + requireAdmin`, covered by
`tests/integration/rbac.auth.test.ts` (9 tests, mutation-checked).

---

## Follow-ups

Open, in rough priority order:

- **`requirePermission` is wired into zero routes.** The permission system is
  administrable but unenforced; real authorization is the coarse `requireAdmin`
  role check. The seed data already contains `users.roles` ("Manage Roles &
  RBAC"), which is the natural gate for the rbac router itself. Deciding which
  codes guard which endpoints is a policy call, not a refactor.
- **Nothing guards the swagger globs.** They broke silently once and would again
  on the next restructure. A test asserting the spec has more than 0 paths would
  catch it.
- **Coverage is thin** — 14 suites for 23 modules. rbac, taxation,
  inventoryReservation, store and order have unit tests; most modules have none.
  Nothing about the migration made that worse — the shims never had tests either
  — but a module boundary is a natural place to add them.
