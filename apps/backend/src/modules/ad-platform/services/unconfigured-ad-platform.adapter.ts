import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  AdPlatformProvider,
  AdTree,
  BeginConnectionResult,
  ConnectedAccount,
  ProviderHealth,
  StoreCredential,
} from '../interfaces/ad-platform-provider.interface';

/**
 * The seam with nobody behind it.
 *
 * `ayrshare.adapter.ts` was deleted rather than ported — it was a vendor nobody
 * chose, substituted for the one the spec named — and the adapter that replaces
 * it is not written yet. Something has to be bound to `AD_PLATFORM_PROVIDER` in
 * the meantime or the module cannot be constructed, so this is bound: every
 * method refuses, in one sentence, and no method pretends.
 *
 * **It is not a fake and must never be used as one.** The in-memory fake lives
 * in the end-to-end helpers and is swapped in at this same token; a test that
 * reached this class would be testing that nothing is configured. What this
 * exists for is the running application between the adapter's deletion and its
 * replacement: a merchant pressing Connect is told the integration is not
 * available rather than meeting a 500 from an unresolved dependency.
 *
 * Deleting this file is part of adding the real adapter, not a follow-up to it.
 */
@Injectable()
export class UnconfiguredAdPlatformAdapter implements AdPlatformProvider {
  private refuse(): never {
    throw new ServiceUnavailableException(
      'No ad platform integration is configured for this deployment.',
    );
  }

  issueStoreCredential(): Promise<StoreCredential> {
    this.refuse();
  }

  beginConnection(): Promise<BeginConnectionResult> {
    this.refuse();
  }

  completeConnection(): Promise<ConnectedAccount | null> {
    this.refuse();
  }

  disconnect(): Promise<void> {
    this.refuse();
  }

  revokeStoreCredential(): Promise<void> {
    this.refuse();
  }

  fetchAdTree(): Promise<AdTree> {
    this.refuse();
  }

  health(): Promise<ProviderHealth> {
    this.refuse();
  }
}
