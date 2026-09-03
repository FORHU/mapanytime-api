import fs from 'fs';
import path from 'path';
import {
  SELLER_FEATURES,
  isSellerFeature,
} from '../../src/modules/organization/sellerPermissions.constant';

/**
 * Drift guard on the `requireSellerFeature` gates wired into route files.
 *
 * The failure mode this catches is silent in both directions. A typo'd code can
 * never be held by anyone, so the route becomes unreachable for every member
 * while still passing type-check (the argument is a string literal narrowed to
 * `SellerFeature`, but a raw cast or a widened type slips through). And a code
 * in the catalogue that no route enforces is a checkbox in the team UI that
 * grants nothing — exactly the "nav-gating only" trap `returns`/`payouts` were
 * kept out of the catalogue to avoid.
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
  return [...source.matchAll(/requireSellerFeature\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
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

  it('enforces the three codes that gate real seller endpoints', () => {
    // `sales_review` and `customer_review` are deliberately nav-only: analytics
    // is a stub and reviews are read-only, so neither guards a mutation. If a
    // write endpoint appears for either, gate it and move it up to this list.
    expect([...enforcedCodes].sort()).toEqual(['orders', 'products', 'promotions']);
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

  it('keeps every catalogue code either enforced or knowingly nav-only', () => {
    const navOnly = ['sales_review', 'customer_review'];
    const accountedFor = new Set([...enforcedCodes, ...navOnly]);

    expect(SELLER_FEATURES.filter((code) => !accountedFor.has(code))).toEqual([]);
  });
});
