import { Prisma } from '@prisma/client';

/**
 * Ad schedule windows — the single source of truth for "is this ad live".
 *
 * The window is half-open: [startAt, expiresAt). Start is inclusive, end is
 * exclusive. That convention is what stops an ad being live for one extra
 * second and stops two back-to-back windows counting as overlapping at the
 * instant they touch.
 *
 * Liveness is DERIVED, never stored. It is evaluated at read time — inside the
 * discovery query, at checkout, and when the seller portal renders — so it is
 * exact to the millisecond and cannot drift, lag, or be missed by a job that
 * failed to run. The worker's transition sweep exists only for side effects
 * (notifications, socket pushes); it never decides whether an ad is live.
 *
 * NULL semantics, which every caller depends on:
 *   startAt   NULL → no start constraint; the ad has already started.
 *   expiresAt NULL → never ends.
 */

export type AdWindowState = 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'ENDED';

export interface AdWindow {
  startAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
}

/** Shortest window that can meaningfully be served and attributed. */
export const MIN_WINDOW_MS = 5 * 60 * 1000;

/**
 * How far into the past a start time may be on create. Absorbs clock skew
 * between the seller's device and the server plus the seconds between the form
 * rendering and the request landing — without it, "Start now" fails
 * intermittently for reasons no seller can act on.
 */
export const START_GRACE_MS = 120 * 1000;

/** Guards against a mistyped year scheduling a promotion for the next century. */
export const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Precedence is deliberate:
 *   ENDED outranks PAUSED    — un-pausing an expired ad never resurrects it.
 *   SCHEDULED outranks PAUSED — a seller who pauses a future ad still sees the
 *                               start they set, rather than losing it behind a
 *                               generic "paused".
 */
export function deriveAdState(ad: AdWindow, now: Date = new Date()): AdWindowState {
  if (ad.expiresAt && now >= ad.expiresAt) return 'ENDED';
  if (ad.startAt && now < ad.startAt) return 'SCHEDULED';
  if (!ad.isActive) return 'PAUSED';
  return 'LIVE';
}

export function isAdLive(ad: AdWindow, now: Date = new Date()): boolean {
  return deriveAdState(ad, now) === 'LIVE';
}

/**
 * The same predicate as deriveAdState()'s LIVE branch, expressed for Prisma.
 *
 * These two MUST agree. They are tested against a shared table of boundary
 * instants precisely because drift between an in-memory derivation and a SQL
 * filter is the failure this pairing is designed to catch.
 */
export function liveWindowFilter(now: Date = new Date()): Prisma.MerchantAdsWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ startAt: null }, { startAt: { lte: now } }] },
    ],
  };
}

/**
 * Half-open overlap test, with NULL start as -infinity and NULL end as
 * +infinity. Two windows collide iff each starts before the other ends.
 */
export function windowsOverlap(
  a: { startAt: Date | null; expiresAt: Date | null },
  b: { startAt: Date | null; expiresAt: Date | null },
): boolean {
  const aStart = a.startAt ? a.startAt.getTime() : -Infinity;
  const aEnd = a.expiresAt ? a.expiresAt.getTime() : Infinity;
  const bStart = b.startAt ? b.startAt.getTime() : -Infinity;
  const bEnd = b.expiresAt ? b.expiresAt.getTime() : Infinity;

  return aStart < bEnd && bStart < aEnd;
}

/** Prisma filter for rows whose window could overlap [startAt, expiresAt). */
export function overlappingWindowFilter(window: {
  startAt: Date | null;
  expiresAt: Date | null;
}): Prisma.MerchantAdsWhereInput {
  return {
    AND: [
      // other.startAt < this.expiresAt
      window.expiresAt ? { OR: [{ startAt: null }, { startAt: { lt: window.expiresAt } }] } : {},
      // this.startAt < other.expiresAt
      window.startAt ? { OR: [{ expiresAt: null }, { expiresAt: { gt: window.startAt } }] } : {},
    ],
  };
}

/**
 * Rejects anything Intl cannot resolve, so a typo'd zone fails at the write
 * boundary rather than at render time on someone else's screen.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
