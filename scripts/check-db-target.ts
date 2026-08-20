/* eslint-disable no-console */
/**
 * Say out loud which database is about to be written to, and stop when the
 * target and the environment disagree.
 *
 * `.env` in this repo has had `DATABASE_URL` pointing at localhost and at the
 * staging RDS instance on the same day, with the other commented out one line
 * above. There is nothing in a `prisma migrate dev` or `db:seed` invocation
 * that tells you which one is live until after it has run. See FLAGS.md F5.
 *
 * Run with `--require-local` before any destructive local command; run bare to
 * simply print the target.
 */

import dotenv from 'dotenv';

dotenv.config();

const url = process.env.DATABASE_URL ?? '';
const requireLocal = process.argv.includes('--require-local');

if (!url) {
  console.error('✖ DATABASE_URL is not set. Refusing to continue.');
  process.exit(1);
}

let host = '(unparseable)';
let database = '(unknown)';
try {
  const parsed = new URL(url);
  host = parsed.hostname;
  database = parsed.pathname.replace(/^\//, '') || '(unknown)';
} catch {
  console.error(`✖ DATABASE_URL is not a valid URL. Refusing to continue.`);
  process.exit(1);
}

const isLocal = host === 'localhost' || host === '127.0.0.1' || host === 'db';

console.log(`  Database target: ${database} @ ${host}`);
console.log(`  NODE_ENV:        ${process.env.NODE_ENV ?? '(unset)'}`);

if (requireLocal && !isLocal) {
  console.error('');
  console.error(`✖ This command writes to the database, and ${host} is not a local host.`);
  console.error('  Check line 5 of .env — the staging RDS URL lives one line below it.');
  console.error('  If you genuinely meant to target a remote database, run the underlying');
  console.error('  prisma command directly.');
  process.exit(1);
}

if (isLocal) {
  console.log('  ✓ Local database. Safe to proceed.');
} else {
  console.log(`  ⚠ REMOTE database (${host}). Proceed only if that is what you meant.`);
}
