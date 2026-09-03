import { SellerOrgRole } from '@prisma/client';
import {
  ALL_SELLER_FEATURES,
  SELLER_FEATURES,
  defaultPermissionsForRole,
  isSellerFeature,
  normalizePermissions,
} from '../../src/modules/organization/sellerPermissions.constant';

describe('seller feature catalogue', () => {
  it('covers every role in the SellerOrgRole enum', () => {
    // A role added to the enum without a default here would resolve to
    // `undefined` and crash normalizePermissions at runtime.
    for (const role of Object.values(SellerOrgRole)) {
      expect(defaultPermissionsForRole(role)).toBeInstanceOf(Array);
    }
  });

  it('excludes returns and payouts, which no staff-reachable endpoint serves', () => {
    // Both /v1/returns/seller/* and /v1/settlements/me resolve the caller's own
    // Sellers row, which org staff never have. A code here would promise access
    // the API refuses.
    expect(ALL_SELLER_FEATURES).not.toContain('returns');
    expect(ALL_SELLER_FEATURES).not.toContain('payouts');
  });

  it('recognises only its own codes', () => {
    expect(isSellerFeature('orders')).toBe(true);
    expect(isSellerFeature('returns')).toBe(false);
    expect(isSellerFeature('')).toBe(false);
  });
});

describe('defaultPermissionsForRole', () => {
  it('gives a MANAGER every feature', () => {
    expect(defaultPermissionsForRole(SellerOrgRole.MANAGER)).toEqual([...SELLER_FEATURES]);
  });

  it('gives a SELLER_USER only orders and products', () => {
    expect(defaultPermissionsForRole(SellerOrgRole.SELLER_USER)).toEqual(['orders', 'products']);
  });

  it('gives a SELLER_ADMIN an empty list, since admin access is implicit', () => {
    expect(defaultPermissionsForRole(SellerOrgRole.SELLER_ADMIN)).toEqual([]);
  });

  it('returns a fresh array so a caller cannot mutate the catalogue', () => {
    const first = defaultPermissionsForRole(SellerOrgRole.MANAGER);
    first.pop();

    expect(defaultPermissionsForRole(SellerOrgRole.MANAGER)).toEqual([...SELLER_FEATURES]);
  });
});

describe('normalizePermissions', () => {
  it('applies the role default when the caller expressed no opinion', () => {
    expect(normalizePermissions(SellerOrgRole.SELLER_USER, undefined)).toEqual([
      'orders',
      'products',
    ]);
  });

  it('honours an explicit empty list instead of re-inflating it', () => {
    // Defaults are resolved here, at write time, precisely so that "no
    // features" stays expressible.
    expect(normalizePermissions(SellerOrgRole.MANAGER, [])).toEqual([]);
  });

  it('keeps an explicit list verbatim', () => {
    expect(normalizePermissions(SellerOrgRole.SELLER_USER, ['promotions'])).toEqual(['promotions']);
  });

  it('de-duplicates', () => {
    expect(normalizePermissions(SellerOrgRole.SELLER_USER, ['orders', 'orders'])).toEqual([
      'orders',
    ]);
  });

  it('always stores an empty list for an admin, whatever was requested', () => {
    expect(normalizePermissions(SellerOrgRole.SELLER_ADMIN, ['orders'])).toEqual([]);
  });

  it('rejects an unknown code with a 400 naming it', () => {
    expect(() => normalizePermissions(SellerOrgRole.SELLER_USER, ['orders', 'nope'])).toThrow(
      expect.objectContaining({ status: 400, message: expect.stringContaining('nope') }),
    );
  });

  it('does not let an admin smuggle an unknown code through the admin short-circuit', () => {
    expect(() => normalizePermissions(SellerOrgRole.SELLER_ADMIN, ['nope'])).not.toThrow();
    expect(normalizePermissions(SellerOrgRole.SELLER_ADMIN, ['nope'])).toEqual([]);
  });
});
