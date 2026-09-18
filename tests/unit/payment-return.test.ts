import {
  isSafeOrderId,
  signOrderReturnToken,
  verifyOrderReturnToken,
  buildReturnUrl,
  buildContinueUrl,
  resolveReturnOutcome,
  renderReturnPage,
} from '../../src/modules/payments/payment-return';

/**
 * The post-payment return page is the one endpoint in the payments module that
 * is reachable without a bearer token — the browser coming back from GCash is
 * not the app's HTTP client and has none to send. Everything that stands in for
 * authentication there is tested here.
 */
describe('return link signing', () => {
  const orderId = 'clh3k2j4b0000qzrmn831i7rn';

  it('accepts a token it just minted', () => {
    expect(verifyOrderReturnToken(orderId, signOrderReturnToken(orderId))).toBe(true);
  });

  it('rejects a token minted for a different order', () => {
    const other = signOrderReturnToken('clh3k2j4b0000qzrmn831i7ra');
    expect(verifyOrderReturnToken(orderId, other)).toBe(false);
  });

  it.each<[unknown, string]>([
    ['', 'empty'],
    [undefined, 'absent'],
    [null, 'null'],
    ['deadbeef', 'too short to be a sha256 digest'],
    [123, 'not a string'],
  ])('rejects %p (%s)', (token) => {
    expect(verifyOrderReturnToken(orderId, token)).toBe(false);
  });

  /**
   * A same-length forgery is the case a length check alone would wave through,
   * and the one the timing-safe compare exists for.
   */
  it('rejects a same-length digest that is not the right one', () => {
    const forged = 'a'.repeat(signOrderReturnToken(orderId).length);
    expect(verifyOrderReturnToken(orderId, forged)).toBe(false);
  });

  it('puts a verifiable token on the URL it builds', () => {
    const url = new URL(buildReturnUrl('https://api.test', orderId, 'success'));

    expect(url.pathname).toBe('/api/v1/payments/xendit/return');
    expect(url.searchParams.get('status')).toBe('success');
    expect(verifyOrderReturnToken(orderId, url.searchParams.get('t'))).toBe(true);
  });
});

describe('isSafeOrderId', () => {
  it('accepts a cuid, which is what Orders.id is', () => {
    expect(isSafeOrderId('clh3k2j4b0000qzrmn831i7rn')).toBe(true);
  });

  /**
   * The id is echoed into the page, so this is the guard that keeps a query
   * string from reaching the HTML at all.
   */
  it.each<[string, string]>([
    ['<script>alert(1)</script>', 'markup'],
    ['"onload="alert(1)', 'attribute break-out'],
    ['short', 'below the length floor'],
    ['../../etc/passwd', 'path traversal'],
    ['', 'empty'],
  ])('rejects %p (%s)', (value) => {
    expect(isSafeOrderId(value)).toBe(false);
  });

  it.each<[unknown]>([[undefined], [null], [42], [{}]])('rejects the non-string %p', (value) => {
    expect(isSafeOrderId(value)).toBe(false);
  });
});

/**
 * The query string is attacker-controlled — anyone holding the link can edit
 * `status=` — so it must never be able to promote a payment to "paid".
 */
describe('resolveReturnOutcome', () => {
  it('reports paid only when the database says COMPLETED', () => {
    expect(resolveReturnOutcome('COMPLETED', 'PROCESSING', 'success')).toBe('paid');
  });

  it('does not let ?status=success override an unsettled payment', () => {
    expect(resolveReturnOutcome('PENDING', 'PENDING', 'success')).toBe('waiting');
  });

  it('does not let ?status=success override a failed payment', () => {
    expect(resolveReturnOutcome('FAILED', 'FAILED', 'success')).toBe('failed');
  });

  it('treats a cancelled return as cancelled while still pending', () => {
    expect(resolveReturnOutcome('PENDING', 'PENDING', 'cancelled')).toBe('cancelled');
  });

  /**
   * No webhook is emitted when a session merely expires, so an order the
   * sweeper has already failed is the only failure signal that ever arrives
   * for a buyer who walked away.
   */
  it('reads a failed order as failure even while the payment row says PENDING', () => {
    expect(resolveReturnOutcome('PENDING', 'FAILED', 'success')).toBe('failed');
  });

  it('falls back to waiting when nothing is known yet', () => {
    expect(resolveReturnOutcome(undefined, undefined, undefined)).toBe('waiting');
  });
});

/**
 * This page is only ever reached because a gateway redirected someone's browser
 * to it, so any link it hands out is followed from another device. That makes a
 * loopback origin — which is what the configured web origin is in local
 * development — a link that can only fail.
 */
describe('buildContinueUrl', () => {
  const orderId = 'clh3k2j4b0000qzrmn831i7rn';

  it.each([
    ['http://localhost:4000', 'localhost, as configured locally'],
    ['http://127.0.0.1:4000', 'loopback IPv4'],
    ['http://[::1]:4000', 'loopback IPv6'],
  ])('renders no link for %s (%s)', (base) => {
    expect(buildContinueUrl(base, orderId)).toBe('');
  });

  it.each([
    ['', 'no configured origin'],
    ['not a url', 'an unparseable origin'],
  ])('renders no link for %p (%s)', (base) => {
    expect(buildContinueUrl(base, orderId)).toBe('');
  });

  it('renders no link without an order id', () => {
    expect(buildContinueUrl('https://mapanytime.com', '')).toBe('');
  });

  it('links to the order on a real public origin', () => {
    expect(buildContinueUrl('https://mapanytime.com', orderId)).toBe(
      `https://mapanytime.com/orders/${orderId}`,
    );
  });

  it('does not double the slash when the origin carries one', () => {
    expect(buildContinueUrl('https://mapanytime.com/', orderId)).toBe(
      `https://mapanytime.com/orders/${orderId}`,
    );
  });
});

describe('renderReturnPage', () => {
  const orderId = 'clh3k2j4b0000qzrmn831i7rn';

  it('self-refreshes only while the answer can still change', () => {
    const waiting = renderReturnPage({ outcome: 'waiting', orderId, refreshUrl: '?n=2' });
    const paid = renderReturnPage({ outcome: 'paid', orderId });

    expect(waiting).toContain('http-equiv="refresh"');
    expect(paid).not.toContain('http-equiv="refresh"');
  });

  it('escapes the refresh URL it is handed', () => {
    const page = renderReturnPage({
      outcome: 'waiting',
      orderId,
      refreshUrl: '?t="><script>alert(1)</script>',
    });

    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('echoes no order id and offers no onward link on an unverified link', () => {
    const page = renderReturnPage({ outcome: 'invalid', orderId: '' });

    expect(page).not.toContain('class="cta"');
    expect(page).not.toContain('class="meta"');
  });

  it('never depends on an external asset', () => {
    const page = renderReturnPage({ outcome: 'paid', orderId });

    expect(page).not.toMatch(/<script\b/);
    expect(page).not.toMatch(/src=|<link\b/);
  });
});
