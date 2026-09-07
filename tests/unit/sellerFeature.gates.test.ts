import fs from 'fs';
import path from 'path';
import {
  SELLER_FEATURES,
  isSellerFeature,
} from '../../src/modules/organization/sellerPermissions.constant';
import { PERMISSIONS } from '../../src/constants/permissions.constant';

/**
 * Drift guard on the `requireSellerFeature` gates wired into route files.
 *
 * The failure mode this catches is silent in both directions. A typo'd code can
 * never be held by anyone, so the route becomes unreachable for every member
 * while still passing type-check (the argument is a string literal narrowed to
 * `SellerFeature`, but a raw cast or a widened type slips through). And a code
 * in the catalogue that no route enforces is a checkbox in the team UI that
 * grants nothing — exactly the "nav-gating only" trap `returns`/`payouts` were
 * kept out of the catalogue to avoid. Since the seller codes moved into the
 * shared PERMISSIONS catalogue, every gate must resolve to one of them.
 *
 * Modelled on permission.gates.test.ts, which does the same job for the
 * platform-level `requirePermission` codes.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const MODULES_DIR = path.join(REPO_ROOT, 'src/modules');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const routeFiles = walk(MODULES_DIR).filter((f) => f.endsWith('.route.ts'));

const gatesIn = (file: string): string[] => {
  const source = fs.readFileSync(file, 'utf8');
  const codes: string[] = [];

  for (const match of source.matchAll(/requireSellerFeature\(\s*PERMISSIONS\.([A-Z_]+)\s*\)/g)) {
    codes.push(PERMISSIONS[match[1] as keyof typeof PERMISSIONS]);
  }
  // A raw string literal bypasses the constant, so catch those too — that is
  // exactly the path a stale pre-merge slug like 'products' would come back in.
  for (const match of source.matchAll(/requireSellerFeature\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    codes.push(match[1]);
  }
  return codes;
};

const gatedRoutes = routeFiles
  .map((file) => ({ file: path.relative(REPO_ROOT, file), codes: gatesIn(file) }))
  .filter((entry) => entry.codes.length > 0);

const enforcedCodes = new Set(gatedRoutes.flatMap((entry) => entry.codes));

describe('seller feature gates', () => {
  it('is actually wired into routes', () => {
    expect(gatedRoutes.length).toBeGreaterThan(0);
  });

  it('only references codes that exist in the catalogue', () => {
    const unknown = gatedRoutes.flatMap((entry) =>
      entry.codes.filter((code) => !isSellerFeature(code)).map((code) => `${entry.file}: ${code}`),
    );

    expect(unknown).toEqual([]);
  });

  it('enforces every seller code on a real endpoint', () => {
    // The pre-merge catalogue carried `sales_review` and `customer_review`,
    // which gated nothing. They are gone, so the catalogue and the enforced set
    // are now the same list with nothing knowingly left over.
    expect([...enforcedCodes].sort()).toEqual([...SELLER_FEATURES].sort());
  });

  it('never gates a catalogue mutation on the read-only code', () => {
    // A SELLER_MEMBER holds products.view but not products.edit. Gating a write
    // route on the read code would hand every member write access to the
    // catalog, and nothing else in the suite would notice.
    for (const file of ['products/product.route.ts', 'inventory/inventory.route.ts']) {
      const source = fs.readFileSync(path.join(MODULES_DIR, file), 'utf8');
      const writeBlocks = source
        .split(/router\./)
        .filter((block) => /^(post|put|patch|delete)\(/.test(block));

      expect(writeBlocks.length).toBeGreaterThan(0);
      for (const block of writeBlocks) {
        expect(block).not.toContain('PERMISSIONS.PRODUCTS_VIEW');
      }
    }
  });

  it('leaves buyer-facing order routes ungated', () => {
    // /cash-pickup/confirm and /cancel both resolve a Buyers row and 403
    // without one. Gating either on a seller feature locks out every buyer.
    const orderRoute = fs.readFileSync(path.join(MODULES_DIR, 'orders/order.route.ts'), 'utf8');

    for (const line of orderRoute.split('\n')) {
      if (line.includes("'/cash-pickup/confirm'") || line.includes("'/cancel'")) {
        expect(line).not.toContain('requireSellerFeature');
      }
    }
  });

  it('leaves no catalogue code unenforced', () => {
    expect(SELLER_FEATURES.filter((code) => !enforcedCodes.has(code))).toEqual([]);
  });
});
