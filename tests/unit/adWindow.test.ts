import {
  deriveAdState,
  isAdLive,
  liveWindowFilter,
  windowsOverlap,
  type AdWindow,
} from '../../src/modules/merchantAds/adWindow';

const T = (iso: string) => new Date(iso);

const START = T('2026-09-03T01:00:00.000Z');
const END = T('2026-09-06T10:00:00.000Z');

const win = (over: Partial<AdWindow> = {}): AdWindow => ({
  startAt: START,
  expiresAt: END,
  isActive: true,
  ...over,
});

describe('deriveAdState — half-open window [startAt, expiresAt)', () => {
  it('is SCHEDULED one millisecond before the start', () => {
    expect(deriveAdState(win(), new Date(START.getTime() - 1))).toBe('SCHEDULED');
  });

  it('is LIVE exactly at the start instant — start is inclusive', () => {
    expect(deriveAdState(win(), START)).toBe('LIVE');
  });

  it('is LIVE one millisecond before the end', () => {
    expect(deriveAdState(win(), new Date(END.getTime() - 1))).toBe('LIVE');
  });

  it('is ENDED exactly at the end instant — end is exclusive', () => {
    expect(deriveAdState(win(), END)).toBe('ENDED');
  });
});

describe('deriveAdState — NULL boundaries', () => {
  it('treats a NULL start as already started, so pre-scheduling rows keep working', () => {
    expect(deriveAdState(win({ startAt: null }), T('2000-01-01T00:00:00.000Z'))).toBe('LIVE');
  });

  it('treats a NULL end as never ending', () => {
    expect(deriveAdState(win({ expiresAt: null }), T('2999-01-01T00:00:00.000Z'))).toBe('LIVE');
  });

  it('is LIVE when both boundaries are NULL and the seller has not paused it', () => {
    expect(deriveAdState({ startAt: null, expiresAt: null, isActive: true })).toBe('LIVE');
  });
});

describe('deriveAdState — precedence between the window and the pause switch', () => {
  it('reports PAUSED inside the window when the seller has paused it', () => {
    expect(deriveAdState(win({ isActive: false }), T('2026-09-04T00:00:00.000Z'))).toBe('PAUSED');
  });

  it('reports ENDED over PAUSED, so un-pausing cannot resurrect an expired ad', () => {
    expect(deriveAdState(win({ isActive: false }), T('2026-09-07T00:00:00.000Z'))).toBe('ENDED');
  });

  it('reports SCHEDULED over PAUSED, so a paused future ad still shows its start', () => {
    expect(deriveAdState(win({ isActive: false }), T('2026-09-01T00:00:00.000Z'))).toBe(
      'SCHEDULED',
    );
  });

  it('never reports LIVE for a paused ad', () => {
    expect(isAdLive(win({ isActive: false }), T('2026-09-04T00:00:00.000Z'))).toBe(false);
  });
});

/**
 * liveWindowFilter is the SQL twin of deriveAdState's LIVE branch. Drift
 * between an in-memory derivation and a database filter is exactly the bug
 * this pairing exists to catch, so the two are asserted to agree rather than
 * each being checked in isolation.
 */
describe('liveWindowFilter agrees with deriveAdState', () => {
  const matchesFilter = (ad: AdWindow, now: Date): boolean => {
    const f = liveWindowFilter(now) as {
      isActive: boolean;
      AND: { OR: Record<string, unknown>[] }[];
    };

    if (ad.isActive !== f.isActive) return false;

    const [endClause, startClause] = f.AND;

    const endOk = endClause.OR.some((c) => {
      if ('expiresAt' in c && c.expiresAt === null) return ad.expiresAt === null;
      const gt = (c.expiresAt as { gt: Date }).gt;
      return ad.expiresAt !== null && ad.expiresAt > gt;
    });

    const startOk = startClause.OR.some((c) => {
      if ('startAt' in c && c.startAt === null) return ad.startAt === null;
      const lte = (c.startAt as { lte: Date }).lte;
      return ad.startAt !== null && ad.startAt <= lte;
    });

    return endOk && startOk;
  };

  const instants = [
    T('2026-09-03T00:59:59.999Z'), // just before start
    START, // exactly at start
    T('2026-09-04T12:00:00.000Z'), // mid-window
    T('2026-09-06T09:59:59.999Z'), // just before end
    END, // exactly at end
    T('2026-09-07T00:00:00.000Z'), // after end
  ];

  const cases: AdWindow[] = [
    win(),
    win({ isActive: false }),
    win({ startAt: null }),
    win({ expiresAt: null }),
    { startAt: null, expiresAt: null, isActive: true },
  ];

  it.each(
    cases.flatMap((ad, i) => instants.map((now) => [i, now.toISOString(), ad, now] as const)),
  )('case %i at %s', (_i, _iso, ad, now) => {
    expect(matchesFilter(ad, now)).toBe(deriveAdState(ad, now) === 'LIVE');
  });
});

describe('windowsOverlap', () => {
  const w = (s: string | null, e: string | null) => ({
    startAt: s ? T(s) : null,
    expiresAt: e ? T(e) : null,
  });

  it('does not treat back-to-back windows as overlapping', () => {
    const a = w('2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
    const b = w('2026-09-02T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
    expect(windowsOverlap(a, b)).toBe(false);
  });

  it('detects a one-millisecond overlap', () => {
    const a = w('2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.001Z');
    const b = w('2026-09-02T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
    expect(windowsOverlap(a, b)).toBe(true);
  });

  it('detects containment in both directions', () => {
    const outer = w('2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
    const inner = w('2026-09-03T00:00:00.000Z', '2026-09-04T00:00:00.000Z');
    expect(windowsOverlap(outer, inner)).toBe(true);
    expect(windowsOverlap(inner, outer)).toBe(true);
  });

  it('treats a NULL start as -infinity', () => {
    const openStart = w(null, '2026-09-02T00:00:00.000Z');
    const later = w('2026-09-01T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
    expect(windowsOverlap(openStart, later)).toBe(true);
  });

  it('treats a NULL end as +infinity', () => {
    const openEnd = w('2026-09-01T00:00:00.000Z', null);
    const later = w('2030-01-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z');
    expect(windowsOverlap(openEnd, later)).toBe(true);
  });

  it('two fully open windows always overlap', () => {
    expect(windowsOverlap(w(null, null), w(null, null))).toBe(true);
  });
});
