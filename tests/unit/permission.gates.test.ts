import fs from 'fs';
import path from 'path';
import {
  PERMISSIONS,
  SYSTEM_PERMISSIONS,
  NON_ADMIN_HELD_PERMISSIONS,
  NON_ADMIN_ROLE_PERMISSIONS,
  PermissionCode,
} from '../../src/constants/permissions.constant';

/**
 * Guards on the permission gates wired into the route files.
 *
 * `requirePermission` short-circuits on `isAdmin`, so replacing a `requireAdmin`
 * gate with a permission code can only ever *widen* access — never narrow it.
 * The failure mode is therefore silent: gate an administrator-only router with
 * a code the SELLER role already holds and every seller gains access, with no
 * type error and no failing request test.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const MODULES_DIR = path.join(REPO_ROOT, 'src/modules');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const routeFiles = walk(MODULES_DIR).filter((f) => f.endsWith('.route.ts'));

/** Every `requirePermission('code')` / `requirePermission(PERMISSIONS.X)` call in a file. */
const gatesIn = (file: string): string[] => {
  const source = fs.readFileSync(file, 'utf8');
  const gates: string[] = [];

  for (const match of source.matchAll(/requirePermission\(\s*PERMISSIONS\.([A-Z_]+)\s*\)/g)) {
    const key = match[1] as keyof typeof PERMISSIONS;
    gates.push(PERMISSIONS[key]);
  }
  // A raw string literal bypasses the constant, so catch those too.
  for (const match of source.matchAll(/requirePermission\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    gates.push(match[1]);
  }
  return gates;
};

const gatedRoutes = routeFiles
  .map((file) => ({ file: path.relative(REPO_ROOT, file), codes: gatesIn(file) }))
  .filter((entry) => entry.codes.length > 0);

describe('permission gates', () => {
  it('is actually wired into routes', () => {
    // The permission system sat administrable-but-unenforced for a long time:
    // requirePermission existed and was referenced by exactly zero routes.
    expect(gatedRoutes.length).toBeGreaterThan(0);
  });

  it('only references codes that the seeder creates', () => {
    const seeded = new Set<string>(SYSTEM_PERMISSIONS.map((p) => p.code));
    const unknown = gatedRoutes.flatMap(({ file, codes }) =>
      codes.filter((c) => !seeded.has(c)).map((c) => `${file}: ${c}`),
    );

    // A gate on an unseeded code is a permanent 403 for every non-admin.
    expect(unknown).toEqual([]);
  });

  it('never gates an admin surface with a code a non-admin role holds', () => {
    const nonAdminHeld = new Set<string>(NON_ADMIN_HELD_PERMISSIONS);
    const escalations = gatedRoutes.flatMap(({ file, codes }) =>
      codes.filter((c) => nonAdminHeld.has(c)).map((c) => `${file}: ${c}`),
    );

    // If a genuinely seller-facing router is ever gated with stores.manage,
    // this assertion is the place to record that decision explicitly.
    expect(escalations).toEqual([]);
  });

  it('keeps the constant catalogue and the exported code map in step', () => {
    const catalogue = SYSTEM_PERMISSIONS.map((p) => p.code).sort();
    const map = Object.values(PERMISSIONS).sort();
    expect(catalogue).toEqual(map);
  });

  it('marks every non-admin-held code as a real permission', () => {
    const seeded = new Set<PermissionCode>(SYSTEM_PERMISSIONS.map((p) => p.code));
    NON_ADMIN_HELD_PERMISSIONS.forEach((code) => expect(seeded.has(code)).toBe(true));
  });
});

describe('the seeder and the gate catalogue', () => {
  it('seeds non-admin roles exactly the codes NON_ADMIN_HELD_PERMISSIONS claims', () => {
    // roles.seeder.ts assigns non-admin roles their codes straight out of
    // NON_ADMIN_ROLE_PERMISSIONS (admin roles get every seeded permission
    // instead, via ADMIN_ROLES, and are not part of this claim) — so the
    // union of that map's values is exactly what the seeder grants them.
    const assigned = new Set<string>(Object.values(NON_ADMIN_ROLE_PERMISSIONS).flat());

    expect([...assigned].sort()).toEqual([...NON_ADMIN_HELD_PERMISSIONS].sort());
  });
});
