import { checkoutReturnUrlProblems } from '../../src/config';

/**
 * Xendit will not create a payment session unless the success/cancel return
 * URL satisfies three separate rules, and its rejection names only one of them
 * — every failure comes back as `400 INVALID_URL / "Please provide a valid
 * HTTPS URL"`, which points at the scheme even when the real problem is a port.
 *
 * Each expectation below was measured against the live Xendit sandbox on
 * 2026-08-25 rather than read from documentation. They are pinned here because
 * the rules are not guessable: `:443` is rejected despite being the default
 * port for https, and `localhost` is rejected while a bare loopback IP is not.
 */
describe('checkoutReturnUrlProblems', () => {
  describe('URLs the sandbox accepted (201)', () => {
    it.each([
      ['https://app.mapanytime.test', 'domain, no port'],
      ['https://127.0.0.1', 'bare loopback IPv4'],
      ['https://100.124.116.30', 'bare IPv4 — a Tailscale address for device testing'],
      ['https://user:pw@app.mapanytime.test', 'userinfo is not a port'],
      ['https://[::1]', 'IPv6 literal colons are not a port'],
    ])('accepts %s (%s)', (url) => {
      expect(checkoutReturnUrlProblems(url)).toEqual([]);
    });
  });

  describe('URLs the sandbox rejected (400)', () => {
    it('rejects the "localhost" hostname even over https', () => {
      expect(checkoutReturnUrlProblems('https://localhost')).toEqual([
        'the hostname "localhost" is rejected',
      ]);
    });

    it('rejects a non-default port', () => {
      expect(checkoutReturnUrlProblems('https://100.124.116.30:4002')).toEqual([
        'it must not carry a port (found :4002)',
      ]);
    });

    /**
     * The case a scheme-only check misses. `new URL()` normalises the default
     * port away, so `URL.port` is empty here — reading it alone would let this
     * through to a 400 blaming the scheme.
     */
    it('rejects an explicitly written :443, which URL.port hides', () => {
      expect(new URL('https://app.mapanytime.test:443').port).toBe('');
      expect(checkoutReturnUrlProblems('https://app.mapanytime.test:443')).toEqual([
        'it must not carry a port (found :443)',
      ]);
    });

    it('rejects a port after an IPv6 literal', () => {
      expect(checkoutReturnUrlProblems('https://[::1]:443')).toEqual([
        'it must not carry a port (found :443)',
      ]);
    });

    it('rejects a plain-http scheme', () => {
      expect(checkoutReturnUrlProblems('http://app.mapanytime.test')).toEqual([
        'the scheme must be https',
      ]);
    });

    /** What `.env.example` used to ship: wrong on all three counts. */
    it('reports every broken rule at once, not just the first', () => {
      expect(checkoutReturnUrlProblems('http://localhost:3000')).toEqual([
        'the scheme must be https',
        'it must not carry a port (found :3000)',
        'the hostname "localhost" is rejected',
      ]);
    });
  });

  describe('unusable input', () => {
    it('reports an unset value', () => {
      expect(checkoutReturnUrlProblems('')).toEqual(['it is not set']);
    });

    it('reports a value that is not a URL at all', () => {
      expect(checkoutReturnUrlProblems('not a url')).toEqual(['"not a url" is not a valid URL']);
    });
  });
});
