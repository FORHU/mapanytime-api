import { SELLER_ORG_ROLES, SYSTEM_ROLES } from '../../src/constants/roles.constant';
import { PERMISSIONS, SYSTEM_PERMISSIONS } from '../../src/constants/permissions.constant';
import {
  ALL_SELLER_FEATURES,
  SELLER_FEATURES,
  defaultPermissionsForRole,
  isSellerFeature,
  normalizePermissions,
} from '../../src/modules/organization/sellerPermissions.constant';

describe('seller feature catalogue', () => {
  it('covers every seller organization role', () => {
    // A role added to SELLER_ORG_ROLES without a default would resolve to
    // `undefined` and crash normalizePermissions at runtime.
    for (const role of SELLER_ORG_ROLES) {
      expect(defaultPermissionsForRole(role)).toBeInstanceOf(Array);
    }
  });

  it('draws its codes from the one platform catalogue', () => {
    // The whole point of the merge: these are not a second vocabulary. Every
    // seller code must also be a row the RBAC seeder creates, or a member could
    // hold a permission that does not exist in the Permissions table.
    const seeded = new Set(SYSTEM_PERMISSIONS.map((p) => p.code));
    for (const code of ALL_SELLER_FEATURES) {
      expect(seeded.has(code)).toBe(true);
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
    expect(isSellerFeature(PERMISSIONS.ORDERS_PROCESS)).toBe(true);
    // A platform-admin code is a real permission, but not a seller feature.
    expect(isSellerFeature(PERMISSIONS.USERS_MANAGE)).toBe(false);
    // The pre-merge slugs must not keep working, or a stale client would
    // silently write codes nothing checks.
    expect(isSellerFeature('orders')).toBe(false);
    expect(isSellerFeature('sales_review')).toBe(false);
    expect(isSellerFeature('')).toBe(false);
  });
});

describe('defaultPermissionsForRole', () => {
  it('gives a SELLER_MANAGER every feature', () => {
    expect(defaultPermissionsForRole(SYSTEM_ROLES.SELLER_MANAGER)).toEqual([...SELLER_FEATURES]);
  });

  it('gives a SELLER_MEMBER order processing and read-only catalog access', () => {
    expect(defaultPermissionsForRole(SYSTEM_ROLES.SELLER_MEMBER)).toEqual([
      PERMISSIONS.ORDERS_PROCESS,
      PERMISSIONS.PRODUCTS_VIEW,
    ]);
  });

  it('does not give a SELLER_MEMBER write access to the catalog', () => {
    expect(defaultPermissionsForRole(SYSTEM_ROLES.SELLER_MEMBER)).not.toContain(
      PERMISSIONS.PRODUCTS_EDIT,
    );
  });

  it('gives a SELLER_ADMIN an empty list, since admin access is implicit', () => {
    expect(defaultPermissionsForRole(SYSTEM_ROLES.SELLER_ADMIN)).toEqual([]);
  });

  it('returns a fresh array so a caller cannot mutate the catalogue', () => {
    const first = defaultPermissionsForRole(SYSTEM_ROLES.SELLER_MANAGER);
    first.pop();

    expect(defaultPermissionsForRole(SYSTEM_ROLES.SELLER_MANAGER)).toEqual([...SELLER_FEATURES]);
  });
});

describe('normalizePermissions', () => {
  it('applies the role default when the caller expressed no opinion', () => {
    expect(normalizePermissions(SYSTEM_ROLES.SELLER_MEMBER, undefined)).toEqual([
      PERMISSIONS.ORDERS_PROCESS,
      PERMISSIONS.PRODUCTS_VIEW,
    ]);
  });

  it('honours an explicit empty list instead of re-inflating it', () => {
    // Defaults are resolved here, at write time, precisely so that "no
    // features" stays expressible.
    expect(normalizePermissions(SYSTEM_ROLES.SELLER_MANAGER, [])).toEqual([]);
  });

  it('keeps an explicit list verbatim', () => {
    expect(normalizePermissions(SYSTEM_ROLES.SELLER_MEMBER, [PERMISSIONS.PROMOTIONS_ADD])).toEqual([
      PERMISSIONS.PROMOTIONS_ADD,
    ]);
  });

  it('de-duplicates', () => {
    expect(
      normalizePermissions(SYSTEM_ROLES.SELLER_MEMBER, [
        PERMISSIONS.ORDERS_PROCESS,
        PERMISSIONS.ORDERS_PROCESS,
      ]),
    ).toEqual([PERMISSIONS.ORDERS_PROCESS]);
  });

  it('always stores an empty list for an admin, whatever was requested', () => {
    expect(normalizePermissions(SYSTEM_ROLES.SELLER_ADMIN, [PERMISSIONS.ORDERS_PROCESS])).toEqual(
      [],
    );
  });

  it('rejects an unknown code with a 400 naming it', () => {
    expect(() =>
      normalizePermissions(SYSTEM_ROLES.SELLER_MEMBER, [PERMISSIONS.ORDERS_PROCESS, 'nope']),
    ).toThrow(expect.objectContaining({ status: 400, message: expect.stringContaining('nope') }));
  });

  it('rejects a platform code that is not a seller feature', () => {
    // Sharing one catalogue must not mean a member can be granted users.manage.
    expect(() =>
      normalizePermissions(SYSTEM_ROLES.SELLER_MEMBER, [PERMISSIONS.USERS_MANAGE]),
    ).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('does not let an admin smuggle an unknown code through the admin short-circuit', () => {
    expect(() => normalizePermissions(SYSTEM_ROLES.SELLER_ADMIN, ['nope'])).not.toThrow();
    expect(normalizePermissions(SYSTEM_ROLES.SELLER_ADMIN, ['nope'])).toEqual([]);
  });
});
