import { createHmac, timingSafeEqual } from 'crypto';
import type { AdPlatform } from '../../../shared/database/schema';

/**
 * The note we pin to a merchant before sending them to an ad platform, and read
 * back when they return.
 *
 * The return trip is a browser redirect from a third party, so it carries no
 * admin token and no store header — the two things every other admin request is
 * trusted by. This is what stands in for them: a signed statement of which
 * Organization, Store and platform the trip was started for, made by us and
 * unforgeable by anyone who cannot sign with our key.
 *
 * It is short-lived rather than single-use. Completing a connection twice with
 * the same note produces the same connection row, so the worst a replayed note
 * can do inside its window is ask the provider again what the merchant already
 * approved — and it can never name a Store the merchant did not start from.
 */
export interface ConnectionHandoff {
  readonly organizationId: string;
  readonly storeId: string;
  readonly platform: AdPlatform;
  /** Where in the admin to land the merchant. A path, never a URL. */
  readonly returnPath: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export class HandoffError extends Error {}

/** How long a merchant has to finish approving before the note goes stale. */
export const HANDOFF_TTL_MS = 30 * 60 * 1000;

/**
 * A path inside our own admin, and nothing else.
 *
 * The return destination arrives from a request body and is later put in a
 * `Location` header, which is the exact shape of an open redirect. Anything
 * that could leave our origin — an absolute URL, a protocol-relative `//host`,
 * a backslash some browsers normalize into one — is refused rather than
 * sanitized.
 */
export function isSafeReturnPath(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\') &&
    !value.includes('\\') &&
    !value.includes('\n') &&
    !value.includes('\r')
  );
}

export function signHandoff(handoff: ConnectionHandoff, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(handoff), 'utf8').toString(
    'base64url',
  );
  return `${payload}.${sign(payload, key)}`;
}

export function verifyHandoff(
  token: string,
  key: Buffer,
  now: number = Date.now(),
): ConnectionHandoff {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    throw new HandoffError('Malformed connection handoff.');
  }

  const expected = Buffer.from(sign(payload, key), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HandoffError('Connection handoff signature does not verify.');
  }

  let parsed: ConnectionHandoff;
  try {
    parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as ConnectionHandoff;
  } catch {
    throw new HandoffError('Malformed connection handoff.');
  }

  if (
    typeof parsed.organizationId !== 'string' ||
    typeof parsed.storeId !== 'string' ||
    typeof parsed.platform !== 'string' ||
    typeof parsed.returnPath !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    throw new HandoffError('Malformed connection handoff.');
  }
  if (!isSafeReturnPath(parsed.returnPath)) {
    throw new HandoffError('Connection handoff names an unsafe return path.');
  }
  if (parsed.expiresAt <= now) {
    throw new HandoffError('Connection handoff has expired.');
  }

  return parsed;
}

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}
