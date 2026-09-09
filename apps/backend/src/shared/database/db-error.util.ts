/**
 * Recognising a Postgres error through whatever the driver wrapped it in.
 *
 * Drizzle wraps every failed query in a `DrizzleQueryError` carrying the driver's
 * error as `cause`, so the `code` a caller wants is never on the error it
 * catches. That matters more than it looks: a check on `error.code` alone is not
 * a compile error and not a runtime error — it silently answers "no", and the
 * retry or the friendly conflict message it guards silently never happens.
 */

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** The `code` of an error or of anything it wraps, at any depth. */
function errorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;

  while (
    current !== null &&
    typeof current === 'object' &&
    !seen.has(current)
  ) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/**
 * Whether a write lost a race against a unique index.
 *
 * The caller's business is that the database — not the read that preceded the
 * write — is the authority on uniqueness. Two admins naming the same thing at
 * the same moment must not both win, and only the index can promise that.
 */
export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === UNIQUE_VIOLATION;
}
