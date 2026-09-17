import crypto from 'crypto';
import { ACCESS_TOKEN_SECRET, MAPANYTIME_WEB_APP_EMAIL_URL } from '../../config';

/**
 * The page the buyer's browser lands on after paying, and the token that makes
 * it safe to serve without authentication.
 *
 * The browser coming back from GCash is not the Flutter app's Dio client and
 * carries no bearer token, so this page cannot sit behind `authenticate` and
 * `assertOrderAccess` does not apply to it. A signature over the order id —
 * generated when the checkout session is created, so only a buyer we actually
 * sent to Xendit can hold one — stands in for that, with no server-side session
 * state to expire or clean up.
 */

/** Terminal payment states. Mirrors `SETTLED` in the web app's useOrderResult. */
const SETTLED = ['COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'];

/** How many self-refreshes to allow before telling the buyer to look later. */
const MAX_REFRESHES = 40;

/**
 * Deliberately wider than `cuid()`, which is what `Orders.id` is today. The
 * point of this test is to reject anything carrying HTML metacharacters before
 * it reaches the page, not to pin the id format — so a later move to cuid2 or
 * uuid does not silently start rejecting every return.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function isSafeOrderId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

/**
 * Domain-separated so a signature minted here can never be replayed against
 * anything else signing with the same key.
 */
export function signOrderReturnToken(orderId: string): string {
  return crypto
    .createHmac('sha256', ACCESS_TOKEN_SECRET)
    .update(`payment-return:${orderId}`)
    .digest('hex');
}

export function verifyOrderReturnToken(orderId: string, token: unknown): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;

  const received = Buffer.from(token);
  const expected = Buffer.from(signOrderReturnToken(orderId));
  if (received.length !== expected.length) return false;

  return crypto.timingSafeEqual(received, expected);
}

/** The absolute URL Xendit should send the buyer back to. */
export function buildReturnUrl(base: string, orderId: string, status: 'success' | 'cancelled') {
  const token = signOrderReturnToken(orderId);
  return `${base}/api/v1/payments/xendit/return?orderId=${orderId}&status=${status}&t=${token}`;
}

/**
 * `invalid` is never returned by `resolveReturnOutcome` — it is what the handler
 * renders for a link whose signature does not check out. Deliberately its own
 * state rather than reusing `failed`, which asserts "nothing was charged" and
 * would be a lie on a tampered link for an order that did pay.
 */
export type ReturnOutcome = 'paid' | 'waiting' | 'failed' | 'cancelled' | 'invalid';

/**
 * Reconciles what the gateway claimed in the URL with what the database knows.
 *
 * The query string is attacker-controlled — anyone holding the link can edit
 * `status` — so it never decides "paid". It only disambiguates an unsettled
 * payment, which means "no webhook yet" after a success and "buyer walked away"
 * after a cancel. Same precedence as `resolveOutcome` in the web app.
 */
export function resolveReturnOutcome(
  paymentStatus: string | undefined,
  orderStatus: string | undefined,
  returned: string | undefined,
): ReturnOutcome {
  if (paymentStatus === 'COMPLETED') return 'paid';
  if (paymentStatus === 'FAILED') return 'failed';
  if (paymentStatus === 'CANCELLED' || paymentStatus === 'REFUNDED') return 'cancelled';

  // No failure webhook is emitted for an expired session, so a payment that is
  // still PENDING against an order the sweeper already failed is the only
  // failure signal that ever arrives for the abandon case.
  if (orderStatus === 'FAILED') return 'failed';
  if (orderStatus === 'CANCELLED') return 'cancelled';

  if (returned === 'cancelled') return 'cancelled';
  return 'waiting';
}

export function isSettled(paymentStatus: string | undefined): boolean {
  return paymentStatus !== undefined && SETTLED.includes(paymentStatus);
}

/**
 * Where "View order details" should point, or nothing at all.
 *
 * A loopback origin is worthless *on this page* in a way it is not elsewhere.
 * This page is by construction opened on someone else's device — a payment
 * gateway redirected a buyer's browser to it — so `localhost` resolves to that
 * buyer's phone and refuses the connection. `MAPANYTIME_WEB_APP_EMAIL_URL` is
 * documented as the origin a browser *on the developer's machine* can open,
 * which is exactly the wrong guarantee here, and it cannot simply be repointed
 * because `organization.service.ts` also builds emailed set-up links from it.
 *
 * So the link is dropped rather than rendered dead. In production that origin
 * is the public https host and the link works normally.
 */
export function buildContinueUrl(base: string, orderId: string): string {
  if (!base || !orderId) return '';

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return '';
  }

  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
    return '';
  }

  const origin = base.replace(/\/$/, '');
  return `${origin}/orders/${encodeURIComponent(orderId)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const COPY: Record<ReturnOutcome, { title: string; body: string; glyph: string; tone: string }> = {
  paid: {
    title: 'Payment confirmed',
    body: 'Your order is being prepared. You can close this page and return to the app.',
    glyph: '&#10003;',
    tone: '#059669',
  },
  waiting: {
    title: 'Confirming your payment',
    body: 'Your e-wallet is still telling us about this payment. This page updates itself — there is no need to pay again.',
    glyph: '&#8230;',
    tone: '#d97706',
  },
  cancelled: {
    title: 'Payment cancelled',
    body: 'Nothing was charged. You can try again from the app.',
    glyph: '&#215;',
    tone: '#6b7280',
  },
  failed: {
    title: 'Payment failed',
    body: "The gateway couldn't complete this payment. Nothing was charged — try a different method from the app.",
    glyph: '!',
    tone: '#dc2626',
  },
  invalid: {
    title: 'This link is not valid',
    body: 'Open your order in the app to see its current payment status.',
    glyph: '?',
    tone: '#6b7280',
  },
};

/**
 * A whole page in one string: no view engine in this service, and no external
 * stylesheet or font either. This renders inside an in-app browser on mobile
 * data immediately after a payment, which is the worst possible moment to
 * depend on a CDN round-trip.
 */
export function renderReturnPage(options: {
  outcome: ReturnOutcome;
  orderId: string;
  refreshUrl?: string;
}): string {
  const { outcome, orderId, refreshUrl } = options;
  const copy = COPY[outcome];
  // An unverified link gets no order id echoed back and no link onward — it has
  // not established that its holder is entitled to either.
  const continueUrl = buildContinueUrl(MAPANYTIME_WEB_APP_EMAIL_URL, orderId);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshUrl ? `<meta http-equiv="refresh" content="3;url=${escapeHtml(refreshUrl)}">` : ''}
<title>${escapeHtml(copy.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f5f5f4; color:#1c1917; padding:24px;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { background:#fff; border-radius:16px; padding:32px 24px; max-width:380px; width:100%;
          box-shadow:0 1px 3px rgba(0,0,0,.1),0 8px 24px rgba(0,0,0,.06); text-align:center; }
  .badge { width:64px; height:64px; border-radius:50%; margin:0 auto 20px;
           display:flex; align-items:center; justify-content:center;
           font-size:30px; font-weight:700; color:#fff; background:${copy.tone}; }
  h1 { font-size:21px; margin:0 0 10px; }
  p { margin:0 0 20px; color:#57534e; font-size:14.5px; }
  .meta { border-top:1px solid #e7e5e4; padding-top:14px; font-size:12px; color:#a8a29e;
          word-break:break-all; }
  a.cta { display:block; padding:13px; border-radius:11px; background:#1c1917; color:#fff;
          text-decoration:none; font-weight:600; font-size:14.5px; margin-bottom:14px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0c0a09; color:#fafaf9; }
    .card { background:#1c1917; box-shadow:none; }
    p { color:#a8a29e; }
    .meta { border-color:#292524; }
    a.cta { background:#fafaf9; color:#1c1917; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">${copy.glyph}</div>
    <h1>${escapeHtml(copy.title)}</h1>
    <p>${copy.body}</p>
    ${continueUrl ? `<a class="cta" href="${escapeHtml(continueUrl)}">View order details</a>` : ''}
    ${orderId ? `<div class="meta">Order ${escapeHtml(orderId)}</div>` : ''}
  </div>
</body>
</html>`;
}

export { MAX_REFRESHES };
