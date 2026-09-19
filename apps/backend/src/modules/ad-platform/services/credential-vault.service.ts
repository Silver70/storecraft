import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  deriveKey,
  parseSealingKey,
  seal,
  unseal,
  type SealingKey,
} from '../../../shared/utils/secret-box.util';

/** Key separation: signing a return trip must never open a credential. */
const HANDOFF_LABEL = 'ad-platform:connection-handoff';

/**
 * The only thing in the codebase that turns a Store's sealed credential back
 * into a secret.
 *
 * It exists as its own collaborator so that the number of call sites able to
 * produce plaintext is a thing you can count — grep for `open` and the list is
 * the list. Everything else handles ciphertext, which is safe to select, safe
 * to hold in a row, and useless in a log line.
 *
 * The key is read lazily rather than in the constructor: a deployment with no
 * ad-platform integration configured still boots, and only a merchant who tries
 * to connect one gets told what is missing.
 */
@Injectable()
export class CredentialVault {
  private cached?: SealingKey;

  constructor(private readonly config: ConfigService) {}

  seal(plaintext: string): string {
    return seal(plaintext, this.key());
  }

  open(sealed: string): string {
    return unseal(sealed, this.key());
  }

  /** The signing key for the note a merchant carries to the platform and back. */
  handoffKey(): Buffer {
    return deriveKey(this.key(), HANDOFF_LABEL);
  }

  private key(): SealingKey {
    this.cached ??= parseSealingKey(
      this.config.get<string>('AD_PLATFORM_ENCRYPTION_KEY'),
    );
    return this.cached;
  }
}
