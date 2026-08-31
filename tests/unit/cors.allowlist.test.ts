import {
  ORIGIN_SHAPE,
  buildAllowlist,
  webAppOrigins,
  isOriginAllowed,
  parseAllowedOrigins,
  rejectOrigin,
} from '../../src/middleware/cors.middleware';

/**
 * F94: production booted with a `CORS_ORIGIN` that matched neither front-end
 * origin, so every browser request was refused while curl, Postman and the
 * Flutter app all reported the API healthy. Nothing failed loudly — the
 * rejection surfaced as a 500 and the process never said what it would accept.
 *
 * These pin the two halves that made it invisible: what the env var parses to,
 * and which callers the allowlist is not supposed to apply to.
 */
describe('parseAllowedOrigins', () => {
  it('splits on commas and trims surrounding whitespace', () => {
    expect(parseAllowedOrigins('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('strips a trailing slash, which never appears in a browser Origin header', () => {
    expect(parseAllowedOrigins('https://mapanytime.com/')).toEqual(['https://mapanytime.com']);
  });

  it('treats unset and empty as an empty allowlist rather than one blank origin', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins(' , ')).toEqual([]);
  });

  it('keeps the host distinct from its www form — they are separate origins', () => {
    const allowed = parseAllowedOrigins('https://mapanytime.com');
    expect(isOriginAllowed('https://www.mapanytime.com', allowed)).toBe(false);
  });

  it('keeps the scheme and port significant', () => {
    const allowed = parseAllowedOrigins('https://mapanytime.com');
    expect(isOriginAllowed('http://mapanytime.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://mapanytime.com:8443', allowed)).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  const allowed = ['https://mapanytime.com', 'https://www.mapanytime.com'];

  it('accepts an allowlisted origin', () => {
    expect(isOriginAllowed('https://www.mapanytime.com', allowed)).toBe(true);
  });

  it('refuses an origin that is not on the list', () => {
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
  });

  /**
   * The reason F94 was invisible to every non-browser check: no `Origin`
   * header means the request is not a browser cross-origin call at all, so the
   * allowlist has nothing to decide. curl, the Flutter client and
   * server-to-server callers all land here.
   */
  it('accepts a request with no Origin header whatever the allowlist says', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
    expect(isOriginAllowed('', allowed)).toBe(true);
  });

  /** Development convenience, and the reason this cannot reproduce locally. */
  it('accepts everything when the allowlist is empty', () => {
    expect(isOriginAllowed('https://anything.example', [])).toBe(true);
  });
});

describe('rejectOrigin', () => {
  it('carries a 403 so the error handler does not report a config fault as a crash', () => {
    expect(rejectOrigin('https://evil.example')).toMatchObject({
      status: 403,
      message: 'Origin not allowed by CORS: https://evil.example',
    });
  });
});

describe('ORIGIN_SHAPE', () => {
  it.each(['https://mapanytime.com', 'http://localhost:4000', 'https://a.b.c.example:8443'])(
    'accepts the bare origin %s',
    (origin) => {
      expect(ORIGIN_SHAPE.test(origin)).toBe(true);
    },
  );

  it.each([
    ['mapanytime.com', 'no scheme'],
    ['https://mapanytime.com/api/v1', 'carries a path'],
    ['*', 'a wildcard, which exact matching can never satisfy'],
  ])('flags %s (%s)', (value) => {
    expect(ORIGIN_SHAPE.test(value)).toBe(false);
  });
});

/**
 * F94's fix: a wrong CORS_ORIGIN must not be able to lock every browser out of
 * a healthy API. The web app URL is the one front-end address the code can
 * actually verify — `assertCheckoutReturnUrl` throws at boot in production
 * when it is unusable — so a running production process proves it is real.
 */
describe('webAppOrigins', () => {
  it('derives the origin and its www sibling from an apex URL', () => {
    expect(webAppOrigins('https://mapanytime.com')).toEqual([
      'https://mapanytime.com',
      'https://www.mapanytime.com',
    ]);
  });

  it('derives the apex from a www URL', () => {
    expect(webAppOrigins('https://www.mapanytime.com')).toEqual([
      'https://www.mapanytime.com',
      'https://mapanytime.com',
    ]);
  });

  it('drops any path, so a URL with one still yields a bare origin', () => {
    expect(webAppOrigins('https://mapanytime.com/checkout/return')).toEqual([
      'https://mapanytime.com',
      'https://www.mapanytime.com',
    ]);
  });

  /** Same predicate the boot check uses — these never reach production. */
  it.each([
    ['', 'unset'],
    ['http://mapanytime.com', 'not https'],
    ['https://localhost:3000', 'localhost and a port'],
    ['https://mapanytime.com:443', 'an explicit port'],
  ])('derives nothing from %s (%s)', (url) => {
    expect(webAppOrigins(url)).toEqual([]);
  });

  it('toggles only the www prefix and never widens to other subdomains', () => {
    const derived = webAppOrigins('https://shop.mapanytime.com');
    expect(derived).toEqual(['https://shop.mapanytime.com', 'https://www.shop.mapanytime.com']);
    expect(isOriginAllowed('https://evil.mapanytime.com', derived)).toBe(false);
  });
});

describe('buildAllowlist', () => {
  it('adds the front end to what the secret names', () => {
    expect(buildAllowlist('https://partner.example', 'https://mapanytime.com')).toEqual([
      'https://partner.example',
      'https://mapanytime.com',
      'https://www.mapanytime.com',
    ]);
  });

  it('keeps a wrong secret from locking the front end out — the F94 case', () => {
    const allowed = buildAllowlist('https://nonsense.invalid', 'https://mapanytime.com');
    expect(isOriginAllowed('https://www.mapanytime.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://mapanytime.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
  });

  it('does not duplicate an origin the secret already names', () => {
    expect(buildAllowlist('https://mapanytime.com', 'https://mapanytime.com')).toEqual([
      'https://mapanytime.com',
      'https://www.mapanytime.com',
    ]);
  });

  /**
   * An unset CORS_ORIGIN is the development-only open mode, and production
   * refuses to boot in it. Deriving origins must not quietly convert that into
   * a two-entry allowlist and change what local development does.
   */
  it('leaves the open development mode open', () => {
    expect(buildAllowlist('', 'https://mapanytime.com')).toEqual([]);
    expect(buildAllowlist(undefined, 'https://mapanytime.com')).toEqual([]);
  });
});
