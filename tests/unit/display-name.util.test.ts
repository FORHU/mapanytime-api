import { displayName } from '../../src/utils/display-name.util';

// Must match the backfill in the better_auth_core migration (#122).
describe('displayName', () => {
  it('joins first and last name', () => {
    expect(displayName({ email: 'a@x.ph', firstName: 'Juan', lastName: 'Dela Cruz' })).toBe(
      'Juan Dela Cruz',
    );
  });

  it('uses whichever part exists, trimmed', () => {
    expect(displayName({ email: 'a@x.ph', firstName: '  Juan ', lastName: null })).toBe('Juan');
    expect(displayName({ email: 'a@x.ph', lastName: 'Cruz' })).toBe('Cruz');
  });

  it("falls back to the email's local part, so it is never empty", () => {
    expect(displayName({ email: 'juan.dc@x.ph', firstName: ' ', lastName: '' })).toBe('juan.dc');
    expect(displayName({ email: 'juan.dc@x.ph' })).toBe('juan.dc');
  });
});
