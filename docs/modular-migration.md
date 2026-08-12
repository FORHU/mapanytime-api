# 🧭 Modular Migration — Status & Cleanup Plan

Audit date: **2026-08-11**. Steps 1–2 executed **2026-08-12**. Codebase: `mapanytime-api`.

The API carried two structures side by side: the original layered ("monolith")
folders and the newer feature-module folders. This document records what state
that migration is in, what was removed, and what order to finish it in.

**TL;DR** — all 23 compatibility shims are gone. The legacy folders now hold
*only* genuinely unmigrated features, so the two-structure confusion is
resolved. What remains is the rbac decision plus 9 unmigrated features.

---

## The two structures

**Layered (legacy)**

```
src/controllers/   src/services/   src/repositories/   src/routes/
```

**Modular (target)**

```
src/modules/<feature>/<feature>.{controller,service,repository,route}.ts
```

15 feature folders exist under `src/modules/` (`merchantAds` arrived 2026-08-12
from separate in-flight work, and was built modular from the start).

### Why the "duplicates" were harmless

`src/controllers/cart.controller.ts` was not a second implementation:

```ts
import CartController from '../modules/cart/cart.controller';
export default CartController;
```

Every legacy file that shared a basename with a module file looked like this —
a compatibility shim pointing at the single real implementation in
`src/modules/`. Two used `export *` rather than a default re-export
(`controllers/payment.controller`, `repositories/store.repository`), because the
payments module exports named functions instead of a default class.

All of them have since been deleted; the sections below are kept as a record of
what was removed.

---

## Migrated vs still legacy

| Migrated to `src/modules/` | Still genuinely layered |
| --- | --- |
| products, stores, orders, cart, payments, categories, shipments, returns, settlements, payouts, supplierProducts, appRelease, audit, notifications, merchantAds | auth, users, agent, fileUpload, health, inventory, inventoryReservation, taxation, rbac |

---

## Finding 1 — 15 dead shims ✅ deleted

Nothing imported these. Pure deletion, zero risk.

```
src/controllers/cart.controller.ts
src/controllers/category.controller.ts
src/controllers/order.controller.ts
src/controllers/product.controller.ts
src/controllers/store.controller.ts
src/services/cart.service.ts
src/services/order.service.ts
src/services/payment.service.ts
src/services/product.service.ts
src/repositories/order.repository.ts
src/repositories/payment.repository.ts
src/routes/cart.route.ts
src/routes/order.route.ts
src/routes/product.route.ts
src/routes/store.route.ts
```

## Finding 2 — 6 load-bearing shims ✅ rewritten and deleted

Each was one import rewrite away from being deletable.

| Shim | Importer | Now points at |
| --- | --- | --- |
| `services/category.service` | `src/modules/products/product.service.ts:2` | `../categories/category.service` |
| `repositories/category.repository` | `src/modules/stores/store.service.ts:1` | `../categories/category.repository` |
| `repositories/store.repository` | `src/modules/stores/store.service.ts:2` | `./store.repository` |
| `repositories/product.repository` | `src/services/inventory.service.ts:2` | `../modules/products/product.repository` |
| `routes/category.route` | `src/routes/index.ts:8` | `../modules/categories/category.route` |
| `services/store.service` | `tests/unit/store.service.test.ts:1` | `../../src/modules/stores/store.service` |

Two things worth calling out:

- `store.service.ts` reached **outside its own module** for its own repository.
  That one was a straight self-reference bug in the migration.
- `routes/category.route` was the only route still wired into `routes/index.ts`
  through a shim; every other route entry already pointed at `../modules/...`.

**Test coupling:** `tests/unit/store.service.test.ts` imported *and* `jest.mock`d
the legacy store paths (lines 1, 2, 4). All three moved in the same pass as the
`store.service.ts` rewrite — had they not, the mock would have silently stopped
matching the module under test and the test would have passed against an
unmocked repository.

## Finding 3 — dead code

- **`src/routes/payment.route.ts`** ✅ deleted — a real router (not a shim),
  imported by nobody; `routes/index.ts` wires `modules/payments/payment.route`
  instead. Its only effect was keeping the `controllers/payment.controller` shim
  alive, so both went together.
- **`src/services/rbac.service.ts` + `src/repositories/rbac.repository.ts`** ✅
  resolved 2026-08-12. These were imported by nothing;
  `src/controllers/rbac.controller.ts` bypassed both and called `prisma`
  directly through four `as unknown as { ... }` casts for `permissions` and
  `rolePermissions`.

  **The stated reason for those casts was wrong.** `Permissions` and
  `RolePermissions` are defined in `prisma/schema.prisma` (lines 59–77) and are
  on the generated client — `rbac.repository.ts` has always called
  `prisma.permissions` and `prisma.rolePermissions` cast-free and type-checked
  clean. The casts were unnecessary from the start, and were suppressing nothing.

  Resolution: the controller now delegates to `RbacService` and holds only HTTP
  concerns (request validation, response shaping). All four casts and both local
  `PermissionRecord` / `RoleWithPermissions` interfaces are gone — the types now
  come from the Prisma client. 165 → 62 lines.

  ⚠️ **Unverified by tests.** There is no rbac test coverage anywhere in
  `tests/`, so this rewire is guaranteed only by the compiler. The four
  endpoints under `/v1/rbac` are worth an integration test before trusting it in
  production.

## Finding 4 — cross-module coupling

Light, and currently acceptable for a marketplace domain. Four edges:

```
cart      → products   (ProductRepository)
orders    → cart       (CartService)
orders    → products   (ProductRepository)
payments  → products   (ProductRepository)
```

`products → categories` is now a direct module-to-module edge rather than a trip
through a shim. The one remaining edge out of `src/modules/` into the legacy
folders is `orders → services/taxation.service`, which resolves once taxation is
migrated.

---

## Cleanup order

1. ~~**Delete the 15 dead shims + dead `routes/payment.route.ts`**~~ ✅ done
   2026-08-12. Mechanical, no behaviour change. 17 files, including the
   `controllers/payment.controller` shim freed by removing the dead router.
2. ~~**Rewrite the 6 live imports, then delete those shims**~~ ✅ done
   2026-08-12. The legacy folders now hold *only* genuinely unmigrated features
   — the two-structure confusion is gone. 23 files deleted in total.
3. ~~**Decide on rbac**~~ ✅ done 2026-08-12. `rbac.controller` now delegates to
   the existing `RbacService`; the casts turned out to be unnecessary rather
   than load-bearing. See Finding 3.
4. **Migrate the remaining 9 features.** auth, users and inventory are the large
   ones; health, fileUpload and agent are small. rbac is now the cheapest of the
   nine — its controller/service/repository trio is already clean and layered
   correctly, so migrating it is a file move plus import updates.

Steps 1–2 were mechanical and were done in a single pass.

## Verifying after each step

```bash
npx tsc --noEmit     # clean after steps 1–3, 2026-08-12
npm run lint         # clean
npm test             # 11 suites / 59 tests passing
```

Use npm/npx here — not bun.

**If `tsc` reports missing Prisma models** (`merchantAds`, `merchantAdProducts`,
`primaryCategory`, `MERCHANTADKIND`), the generated client is stale rather than
the schema being wrong — run `npx prisma generate`. This bit after picking up
the merchantAds work on 2026-08-12.
