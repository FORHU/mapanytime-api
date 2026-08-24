# Branch: `feat/wishlist-refund-and-role-cleanup`

_Off `main` @ 530febf. 6 commits, 2026-08-23._

Pre-commit review sweep + fixes for a session that had wishlist backend
support, order refund/low-stock handling, roles consolidation, and a bulk
map-density seeder sitting uncommitted. Full findings list (fixed and
flagged-only) live in
[`mapanytime-market-app/docs/PICKUP-NEXT.md`](../../mapanytime-market-app/docs/PICKUP-NEXT.md)
under "Review session, 2026-08-23".

---

## `chore(deploy): wire PayMongo secrets into env and CI`

Without `PAYMONGO_SECRET_KEY`, `PaymentService` silently falls back to
`MockProvider` in production, which is a no-op checkout. Add the key pair
to `.env.example` and both deploy workflows.

**Files:** `.env.example`, `.github/workflows/deploy-production.yml`,
`.github/workflows/deploy-staging.yml` — 16 insertions

## `refactor(roles): consolidate seeder against SYSTEM_ROLES constants`

`roles.seeder.ts` carried its own separate hardcoded role list and
permission if/else chain that could drift from `SYSTEM_ROLES`. Now iterates
`SYSTEM_ROLES` directly against a `Record<SystemRole, string>` description
map (a missing entry is a compile error, not a silently unseeded role) and
a `NON_ADMIN_ROLE_PERMISSIONS` lookup.

`permission.gates.test.ts` regex-scraped the seeder's old inline array;
updated to read the new constant instead of source text.

**Files:** `prisma/seeders/roles.seeder.ts`,
`src/constants/permissions.constant.ts`, `src/constants/roles.constant.ts`,
`tests/unit/permission.gates.test.ts` — 61 insertions, 60 deletions

## `fix(orders): refund captured payments on cancel, alert on low stock`

**The two headline fixes of this branch.**

`cancelOrder` used to mark any cancelled order's payment `FAILED`
regardless of whether money had actually been captured. It now checks
payment status first: a still-`PENDING` payment just releases the
reservation as before; a captured (`COMPLETED`, non-cash) payment goes
through the same provider `refundPayment()` flow
`ReturnService.executeRefund` already uses, and cancellation aborts if the
provider rejects the refund.

The refund call happens outside the final transaction, so the order can
move on (e.g. the seller completes it) while a refund is in flight. The
final transaction now re-fetches the order and re-validates the status
transition before writing, instead of blindly overwriting to `CANCELLED`
— closes a window where a completed/settled order could get
force-cancelled and refunded on top of being settled. (Found during this
session's review — was not caught by the existing test suite.)

`completeOrder` now also detects when a product's `quantityOnHand` crosses
at or below the existing dashboard low-stock threshold and notifies the
seller — fires once on the crossing, not on every subsequent order.

**Files:** `src/modules/orders/order.repository.ts`,
`src/modules/orders/order.service.ts` — 161 insertions, 8 deletions

## `fix(wishlist): resolve image URLs and guard missing product`

`getWishlist` was returning raw S3 file paths instead of resolved URLs,
unlike every other product-image endpoint. Fixed to match
`product.repository.ts`'s resolution pattern, and guarded
`item.product?.productImages` so a wishlist row without a populated
product relation doesn't throw. **This was an actively failing unit test**
(`tests/unit/wishlist.service.test.ts`, "counts the saved items"), not
just a theoretical FIXME — found and fixed during this session's
pre-commit review.

**Files:** `src/modules/wishlists/wishlist.service.ts` — 28 insertions,
1 deletion

## `feat(seed): add bulk map-density seeder`

Adds 52 stores and ~1,637 products across all 13 categories, scattered
over real Baguio City / La Trinidad neighborhoods, owned by 5 new
`bulk.sellerN@mapanytime.test` accounts kept separate from the
hand-crafted sellers. Deterministic (seeded PRNG, not `Math.random()`) so
re-running `db:seed` won't duplicate or reshuffle anything.

Also removes a dead code path in `multi_store_seller.seeder.ts` that
defined `seller.multistore@mapanytime.test` as a new user "Nora
Bumanglag"; that user is actually created first by `users.seeder.ts` as
"Marco Cordillera", so the branch could never fire. Simplified to a
`findUnique` + throw with a comment explaining the seeding-order
dependency.

**Files:** `prisma/seed.ts`, `prisma/seeders/bulk_map_stores.seeder.ts`
(new), `prisma/seeders/multi_store_seller.seeder.ts` — 535 insertions,
24 deletions

## `style: run prettier on order.service.ts`

Formatting-only, caught by `npm run format:check`.

**Files:** `src/modules/orders/order.service.ts` — 1 insertion, 1 deletion

---

## Verification (post-commit, all green)

- `npm run lint` — clean
- `npm run format:check` — clean
- `npx tsc` (build) — clean
- `npx jest tests/unit` — 336/336 pass, 40/40 suites
