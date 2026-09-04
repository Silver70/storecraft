/**
 * Creates the local test database if it does not exist and brings it up to the
 * committed migrations, once per `npm run test:e2e` run.
 *
 * This is what makes the suite runnable from a cold clone with nothing but a
 * local Postgres server, and re-runnable afterwards without manual cleanup.
 */
import { Client } from 'pg';
import { runMigrations } from '../src/shared/database/migrate';
import {
  TEST_ADMIN_EMAIL_DOMAIN,
  TEST_ORG_SLUG_PREFIX,
  databaseName,
  loadTestEnv,
  maintenanceUrl,
} from './helpers/test-env';

export default async function globalSetup(): Promise<void> {
  const databaseUrl = loadTestEnv();
  const name = databaseName(databaseUrl);

  const admin = new Client({ connectionString: maintenanceUrl(databaseUrl) });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (!rowCount) {
      // Identifiers can't be parameterised; the name comes from our own
      // .env.test, and quoting keeps it a single identifier regardless.
      //
      // template0 rather than the default template1: on a machine whose glibc
      // has been upgraded since the cluster was created, template1 carries a
      // stale collation version and CREATE DATABASE refuses to copy it.
      // template0 is pristine, so this works without touching any database the
      // developer already has.
      await admin.query(
        `CREATE DATABASE "${name.replace(/"/g, '""')}" TEMPLATE template0`,
      );
    }
  } finally {
    await admin.end();
  }

  await runMigrations(databaseUrl);
  await sweepStaleFixtures(databaseUrl);
}

/**
 * Removes fixtures left behind by a run that died before its teardown. Without
 * it a crashed run would leave rows that accumulate silently — the suite is
 * meant to need no manual cleanup, ever.
 *
 * Organizations are enough for everything tenant-scoped, which cascades from
 * them. Admin users are the exception: they are global identities carrying no
 * `organization_id`, so they are swept by their reserved email domain.
 */
async function sweepStaleFixtures(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DELETE FROM organizations WHERE slug LIKE $1', [
      `${TEST_ORG_SLUG_PREFIX}%`,
    ]);
    await client.query('DELETE FROM admin_users WHERE email LIKE $1', [
      `%@${TEST_ADMIN_EMAIL_DOMAIN}`,
    ]);
  } finally {
    await client.end();
  }
}
