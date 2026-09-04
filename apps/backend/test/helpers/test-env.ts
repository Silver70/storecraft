/**
 * Loads the test environment and refuses to run against anything but a local
 * database.
 *
 * The committed `.env` points at the hosted Neon database. This suite seeds and
 * then deletes rows, so pointing it at a shared database would destroy real
 * data. Every entry point into the suite goes through `loadTestEnv()`, which
 * applies `.env.test` with `override: true` — a stray shell variable or a
 * `.env` cannot redirect a test run — and then asserts the host is local.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';

const BACKEND_ROOT = resolve(__dirname, '../..');

/**
 * Every Organization the suite creates carries this slug prefix, so a run that
 * died before its teardown leaves rows that the next run can recognise and
 * sweep. Nothing outside the tests ever uses it.
 */
export const TEST_ORG_SLUG_PREFIX = 'e2e-test-';

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
]);

export function loadTestEnv(): string {
  process.env.NODE_ENV = 'test';
  dotenv.config({ path: resolve(BACKEND_ROOT, '.env.test'), override: true });
  // Loaded last so it wins: .env.test.local is gitignored, for a developer
  // whose local Postgres wants different credentials.
  dotenv.config({
    path: resolve(BACKEND_ROOT, '.env.test.local'),
    override: true,
  });

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set — is apps/backend/.env.test missing?',
    );
  }
  assertLocalDatabase(url);
  return url;
}

export function assertLocalDatabase(databaseUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to run the integration suite against "${hostname}". ` +
        'These tests create and delete rows and must only ever point at a ' +
        'local Postgres server. Fix DATABASE_URL in apps/backend/.env.test.',
    );
  }
}

/** The same server, but the `postgres` maintenance database. */
export function maintenanceUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

export function databaseName(databaseUrl: string): string {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!name) throw new Error('DATABASE_URL has no database name');
  return name;
}
