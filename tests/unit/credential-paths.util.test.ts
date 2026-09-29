import { isCredentialPath, resetEmailKey } from '../../src/utils/credential-paths.util';

describe('isCredentialPath', () => {
  it.each([
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/refresh-token',
    '/api/v1/auth/forgot-password',
    '/api/v1/auth/reset-password',
  ])('matches %s', (path) => {
    expect(isCredentialPath(path)).toBe(true);
  });

  it('matches below a credential path, as app.use mounts it', () => {
    expect(isCredentialPath('/api/v1/auth/login/')).toBe(true);
  });

  it.each([
    '/api/v1/stores/nearby',
    '/api/v1/auth/logout',
    '/api/v1/auth/login-history',
    '/api/v1/auth/google',
  ])('does not match %s', (path) => {
    expect(isCredentialPath(path)).toBe(false);
  });
});

describe('resetEmailKey', () => {
  it('normalizes spellings of one address to one key', () => {
    expect(resetEmailKey({ email: '  Victim@Example.COM ' })).toBe('victim@example.com');
  });

  it.each([undefined, null, {}, { email: 42 }, { email: ['a@b.c'] }, { email: '   ' }])(
    'has no key for %p',
    (body) => {
      expect(resetEmailKey(body)).toBeUndefined();
    },
  );
});
