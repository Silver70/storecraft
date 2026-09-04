/**
 * Applies the committed migrations to whichever database DATABASE_URL points at.
 *
 * Usage:
 *   npx tsx src/shared/database/migrate.ts
 *
 * Reads DIRECT_DATABASE_URL if present (Neon requires a direct, non-pooled
 * connection for DDL), otherwise DATABASE_URL. The driver is chosen from the
 * URL, so this works against both Neon and a local Postgres server.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { migrate as migrateNeon } from 'drizzle-orm/neon-http/migrator';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { isNeonUrl } from './drizzle.factory';

const MIGRATIONS_FOLDER = resolve(__dirname, 'migrations');

export async function runMigrations(url: string): Promise<void> {
  if (isNeonUrl(url)) {
    await migrateNeon(drizzleNeon(neon(url)), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    return;
  }

  const pool = new Pool({ connectionString: url });
  try {
    await migrateNodePg(drizzleNodePg(pool), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
  } finally {
    await pool.end();
  }
}

async function main() {
  dotenv.config({ path: resolve(process.cwd(), '.env') });

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('No database URL configured');
    process.exit(1);
  }

  try {
    console.log('Running migrations...');
    await runMigrations(url);
    console.log('Migrations applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
