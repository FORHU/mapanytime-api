import fs from 'fs';
import path from 'path';
import { swaggerSpec, SWAGGER_APIS } from '../../src/utils/swagger';

/**
 * Regression guard for the OpenAPI spec.
 *
 * `swagger-jsdoc` resolves its `apis` entries as filesystem globs at startup
 * and fails *silently* on a glob that matches nothing — it simply contributes
 * no endpoints. That happened once: the globs pointed at `src/routes/` and
 * `src/controllers/` after those folders were removed, and `/api-docs` served
 * 0 endpoints while tsc, eslint and the whole test suite stayed green.
 *
 * Nothing type-checks a string path, so it takes a test that touches the disk.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const SWAGGER_YAML_DIR = path.join(REPO_ROOT, 'src/swagger');

type SpecWithPaths = { paths?: Record<string, unknown> };
const specPaths = (swaggerSpec as SpecWithPaths).paths ?? {};

/** Recursively collect every file under `dir`. */
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

/**
 * Resolve one of the `apis` globs against the filesystem.
 *
 * Deliberately hand-rolled rather than pulled from the `glob` package: `glob`
 * is only present here transitively (via swagger-jsdoc and jest), so depending
 * on it in a test would couple this guard to somebody else's dependency tree.
 * Only the two shapes actually used are supported — `./dir/*.ext` and
 * `./dir/**‍/*.suffix.ts`.
 */
const resolveGlob = (pattern: string): string[] => {
  const normalized = pattern.replace(/^\.\//, '');
  const firstWildcard = normalized.indexOf('*');
  const staticPrefix = normalized.slice(0, firstWildcard);
  const baseDir = path.join(REPO_ROOT, staticPrefix);

  if (!fs.existsSync(baseDir)) return [];

  const remainder = normalized.slice(firstWildcard);
  const recursive = remainder.startsWith('**/');
  const filePattern = remainder.replace(/^\*\*\//, '');

  // `*` matches within a single filename segment only.
  const fileRegex = new RegExp(
    `^${filePattern.split('*').map(escapeRegExp).join('[^/\\\\]*')}$`,
  );

  const candidates = recursive
    ? walk(baseDir)
    : fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => path.join(baseDir, e.name));

  return candidates.filter((file) => fileRegex.test(path.basename(file)));
};

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Top-level keys under `paths:` in a swagger YAML file, e.g. `/v1/auth/login`. */
const declaredPathsIn = (yamlFile: string): string[] => {
  const lines = fs.readFileSync(yamlFile, 'utf8').split(/\r?\n/);
  const pathsIndex = lines.findIndex((line) => /^paths:\s*$/.test(line));
  if (pathsIndex === -1) return [];

  const collected: string[] = [];
  for (const line of lines.slice(pathsIndex + 1)) {
    // A new top-level key (column 0, non-comment) ends the paths block.
    if (/^[^\s#]/.test(line)) break;
    const match = line.match(/^ {2}(\/\S*?):\s*$/);
    if (match) collected.push(match[1]);
  }
  return collected;
};

describe('OpenAPI spec', () => {
  it('serves a non-empty set of paths', () => {
    // The exact failure that shipped undetected: a spec with zero endpoints.
    expect(Object.keys(specPaths).length).toBeGreaterThan(0);
  });

  it('every configured glob still matches at least one file on disk', () => {
    const unmatched = SWAGGER_APIS.filter((pattern) => resolveGlob(pattern).length === 0);
    expect(unmatched).toEqual([]);
  });

  describe('YAML specs', () => {
    // src/swagger/*.yaml is currently the *only* source of endpoints: no file
    // under src/modules/ carries an @swagger JSDoc block. If that changes, the
    // module globs start contributing and this stays valid either way.
    const yamlFiles = resolveGlob('./src/swagger/*.yaml');

    it('finds the YAML spec directory', () => {
      expect(fs.existsSync(SWAGGER_YAML_DIR)).toBe(true);
      expect(yamlFiles.length).toBeGreaterThan(0);
    });

    it.each(yamlFiles.map((file) => [path.basename(file), file]))(
      '%s contributes all of its declared paths to the spec',
      (_name, file) => {
        const declared = declaredPathsIn(file);
        expect(declared.length).toBeGreaterThan(0);

        const missing = declared.filter((p) => !(p in specPaths));
        expect(missing).toEqual([]);
      },
    );
  });

  it('exposes the documented security scheme', () => {
    const components = (swaggerSpec as { components?: { securitySchemes?: object } }).components;
    expect(components?.securitySchemes).toHaveProperty('BearerAuth');
  });
});
