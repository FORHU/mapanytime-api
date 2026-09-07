import { buildSellerCatalogue } from '../../src/modules/organization/sellerPermissions.constant';
import {
  SELLER_ORG_PERMISSIONS,
  NON_ADMIN_ROLE_PERMISSIONS,
} from '../../src/constants/permissions.constant';
import { SELLER_ORG_ROLES, SYSTEM_ROLES } from '../../src/constants/roles.constant';

/**
 * The vocabulary served to the team UI.
 *
 * The web used to keep a hand-copied version of this — feature codes, role
 * names, labels and per-role defaults — and the two drifted: the client was
 * still on a pre-migration vocabulary, so every role save came back 400 and the
 * checkbox grid offered codes no route had ever checked. The catalogue exists so
 * there is one source, and these cases pin it to the constants the gates and the
 * seeder actually read.
 */
describe('buildSellerCatalogue', () => {
  const catalogue = buildSellerCatalogue();

  it('serves exactly the seller feature codes, in gate order', () => {
    expect(catalogue.features.map((f) => f.code)).toEqual([...SELLER_ORG_PERMISSIONS]);
  });

  it('gives every feature a non-empty label', () => {
    // A missing label renders as a blank checkbox row, which reads as a bug in
    // the grid rather than a gap in this map.
    for (const feature of catalogue.features) {
      expect(feature.label.length).toBeGreaterThan(0);
    }
  });

  it('serves exactly the assignable roles, most privileged first', () => {
    // The create-staff form defaults a new hire to the last non-admin role, so
    // the ordering is load-bearing, not cosmetic.
    expect(catalogue.roles.map((r) => r.name)).toEqual([...SELLER_ORG_ROLES]);
  });

  it('flags only SELLER_ADMIN as an admin role', () => {
    const admins = catalogue.roles.filter((r) => r.isAdmin).map((r) => r.name);
    expect(admins).toEqual([SYSTEM_ROLES.SELLER_ADMIN]);
  });

  it('gives every role a non-empty label', () => {
    for (const role of catalogue.roles) {
      expect(role.label.length).toBeGreaterThan(0);
    }
  });

  it('matches the defaults the seeder and write path use', () => {
    // Same source as `normalizePermissions`, so what the form pre-ticks is what
    // the API would have written for an omitted list.
    expect(catalogue.defaultsByRole.SELLER_MANAGER).toEqual(
      NON_ADMIN_ROLE_PERMISSIONS.SELLER_MANAGER,
    );
    expect(catalogue.defaultsByRole.SELLER_MEMBER).toEqual(
      NON_ADMIN_ROLE_PERMISSIONS.SELLER_MEMBER,
    );
  });

  it('gives an admin an empty default, since they hold everything implicitly', () => {
    // Persisting a list for an admin would go stale the moment a code is added.
    expect(catalogue.defaultsByRole.SELLER_ADMIN).toEqual([]);
  });

  it('has a default entry for every role it offers', () => {
    for (const role of catalogue.roles) {
      expect(catalogue.defaultsByRole[role.name]).toBeDefined();
    }
  });

  it('never defaults a role to a code outside its own feature list', () => {
    const codes = new Set(catalogue.features.map((f) => f.code));
    for (const granted of Object.values(catalogue.defaultsByRole)) {
      for (const code of granted) {
        expect(codes.has(code)).toBe(true);
      }
    }
  });

  it('hands back fresh arrays so a caller cannot mutate the source constants', () => {
    buildSellerCatalogue().defaultsByRole.SELLER_MEMBER.pop();

    expect(buildSellerCatalogue().defaultsByRole.SELLER_MEMBER).toEqual(
      NON_ADMIN_ROLE_PERMISSIONS.SELLER_MEMBER,
    );
  });
});
