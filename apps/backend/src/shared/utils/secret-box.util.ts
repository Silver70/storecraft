/**
 * Sealing a secret before it is written to a row, and opening it at the one
 * call site that needs the plaintext.
 *
 * A third party's credential is not a password: we have to send it back to
 * them, so it cannot be hashed the way an admin password or an API key is.
 * Reversible encryption is therefore the only option, and the point of this
 * module is to make the reversal deliberate and rare — a column holding a
 * `sealed_*` value cannot be read by accident, copied into a log line, or
 * returned by a read that forgot to omit it, because what comes out is
 * ciphertext until someone names the key.
 *
 * AES-256-GCM, so a tampered row fails to open rather than opening as garbage.
 * The nonce is fresh per seal, and the format carries a version prefix so a
 * later key rotation or cipher change can be told apart from a corrupt value.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

/** A 32-byte key, read from 64 hex characters of configuration. */
export type SealingKey = Buffer & { readonly __sealingKey?: unique symbol };

export class SecretSealingError extends Error {}

/**
 * Reads the configured key, or explains precisely what is missing.
 *
 * Deliberately not defaulted. A generated-at-boot key would seal rows this
 * process can open and the next one cannot, which surfaces as a connection that
 * silently stops working rather than as a startup failure.
 */
export function parseSealingKey(raw: string | undefined): SealingKey {
  if (!raw) {
    throw new SecretSealingError(
      'AD_PLATFORM_ENCRYPTION_KEY is not set. Ad-platform credentials are stored encrypted and cannot be written without it — generate one with `openssl rand -hex 32`.',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new SecretSealingError(
      'AD_PLATFORM_ENCRYPTION_KEY must be 64 hex characters (32 bytes).',
    );
  }
  return Buffer.from(raw, 'hex');
}

/** Derives a separate key for a separate job, so one secret is not two keys. */
export function deriveKey(key: SealingKey, label: string): Buffer {
  return createHmac('sha256', key).update(label).digest();
}

export function seal(plaintext: string, key: SealingKey): string {
  if (key.length !== KEY_BYTES) {
    throw new SecretSealingError('Sealing key must be 32 bytes.');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    VERSION,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function unseal(sealed: string, key: SealingKey): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretSealingError('Sealed value is not in a recognised format.');
  }
  const [, nonce, tag, ciphertext] = parts;
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(nonce, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Never re-thrown with the cipher's own message, which differs between a
    // wrong key and a tampered tag and would say which.
    throw new SecretSealingError(
      'Sealed value could not be opened with the configured key.',
    );
  }
}
