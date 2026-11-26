import { auth } from '../../src/modules/auth/better-auth';

// SPIKE (#122): Better Auth ships ESM only; this proves Jest can load it from
// the CommonJS test environment.
describe('Better Auth (spike)', () => {
  it('loads and exposes the session API', () => {
    expect(typeof auth.api.getSession).toBe('function');
    expect(typeof auth.handler).toBe('function');
  });
});
