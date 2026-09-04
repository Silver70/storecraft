/**
 * Driver selection for the Drizzle client.
 *
 * Production runs against Neon, which is reachable only over its HTTP driver.
 * Local development and the integration test suite run against an ordinary
 * Postgres server, which that driver cannot talk to at all. The URL decides:
 * a `*.neon.tech` host gets the Neon HTTP driver, anything else gets a plain
 * node-postgres pool.
 *
 * node-postgres is the deliberate choice for the local driver (over postgres-js,
 * which is also installed for drizzle-kit): its `db.execute()` returns a result
 * object carrying `.rows` and `.rowCount`, the same shape the Neon driver
 * returns and the shape the dashboard and analytics raw-SQL queries already
 * read. postgres-js returns a bare array and would break every one of them.
 */
import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as https from 'https';
import * as schema from './schema';

export type DrizzleClient = ReturnType<typeof drizzleNeon>;

// Node.js undici (native fetch) times out on some networks due to IPv6 fallback.
// This shim forces IPv4 and uses the https module which connects reliably.
function httpsFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: (init?.method ?? 'GET').toUpperCase(),
        headers: init?.headers as Record<string, string> | undefined,
        family: 4,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve(
            new globalThis.Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: res.headers as Record<string, string>,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    const body = init?.body as string | undefined;
    if (body) req.write(body);
    req.end();
  });
}

neonConfig.fetchFunction = httpsFetch;

/** True when the URL points at Neon and must use the HTTP driver. */
export function isNeonUrl(databaseUrl: string): boolean {
  try {
    return new URL(databaseUrl).hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

/**
 * A pool for non-Neon URLs, or null when the Neon HTTP driver will be used.
 *
 * The session timezone is pinned to UTC, which is what Neon serves and what
 * every `timestamp` column in this schema means: the application writes Dates
 * through Drizzle, which serialises them as UTC. The one writer that does not
 * is `defaultNow()`, evaluated by the server in *its* timezone — so on a
 * developer machine whose Postgres runs in local time, `created_at` lands hours
 * away from the range every report filters on and the reports quietly return
 * nothing. Pinning the session makes local behave as production does.
 */
export function createPgPool(databaseUrl: string): Pool | null {
  if (isNeonUrl(databaseUrl)) return null;
  return new Pool({
    connectionString: databaseUrl,
    options: '-c timezone=UTC',
  });
}

/**
 * Builds the Drizzle client for whichever driver the URL selects.
 *
 * The node-postgres client is cast to the Neon client's type so the ~200 call
 * sites already typed against `DrizzleClient` are untouched. The two are
 * interchangeable across everything this codebase uses — query builders and
 * `execute()` results alike — and nothing uses the Neon-only `batch()`.
 */
export function createDrizzleClient(
  databaseUrl: string,
  pool: Pool | null,
): DrizzleClient {
  if (pool) {
    return drizzleNodePg(pool, { schema }) as unknown as DrizzleClient;
  }
  return drizzleNeon(neon(databaseUrl), { schema });
}
