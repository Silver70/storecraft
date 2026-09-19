import type { AdPlatform } from '../../../shared/database/schema';

/**
 * The one place this codebase reaches an ad platform, and the second
 * collaborator after `PaymentProvider` that would otherwise reach a third party
 * over the network. It sits behind an interface for the same reason that one
 * does: so it can be swapped, faked in tests, and — the whole premise of this
 * feature — lost without losing the product.
 *
 * **The vendor's name does not appear here, and must not.** No service,
 * repository, controller, table, column or domain type in this codebase is
 * named after whoever implements this. One adapter file knows who they are; if
 * that changes, only that file changes.
 *
 * ## There is no write method, and that is the design
 *
 * Nothing here creates, boosts, edits, pauses or budgets an ad. Mirroring is
 * enforced by the absence of the capability rather than by a rule a future
 * reader has to remember — a merchant connecting a read-only integration cannot
 * be charged a penny by anything we call. Adding a write method is a product
 * decision, not an implementation detail, and would start by editing this
 * comment.
 *
 * Reading the ad tree and its daily metrics is deliberately not here yet
 * either: this stage proves a merchant can grant access and that the seam
 * holds. The sync adds its own read method when there is something to sync.
 */
export const AD_PLATFORM_PROVIDER = 'AD_PLATFORM_PROVIDER';

/**
 * A credential scoped to one Store, and the provider's handle for that Store.
 *
 * Passed to every provider call rather than configured once on the adapter,
 * because "which Store is this for" must be impossible to forget. A provider
 * whose account-level key would work for every Store is precisely the failure
 * this shape exists to prevent.
 *
 * `secret` is plaintext in memory for the duration of one call. It is never
 * returned by a read, never logged, and never serialized into a response.
 */
export interface StoreCredential {
  readonly providerRef: string;
  readonly secret: string;
}

export interface IssueCredentialInput {
  /** Our Store id, so the provider's scope can be traced back to one Store. */
  readonly storeId: string;
  readonly storeName: string;
}

export interface BeginConnectionInput {
  readonly credential: StoreCredential;
  readonly platform: AdPlatform;
  /**
   * Where the platform sends the merchant when they are finished — whether they
   * approved, denied, or closed the tab and came back later.
   */
  readonly returnUrl: string;
}

export interface BeginConnectionResult {
  /**
   * The platform's own hosted approval and account-selection screens. We do not
   * build a per-platform account picker: the merchant approves with their own
   * credentials, on the platform's screen, seeing what the platform says they
   * are granting.
   */
  readonly approvalUrl: string;
}

export interface CompleteConnectionInput {
  readonly credential: StoreCredential;
  readonly platform: AdPlatform;
  /** Whatever the platform put on the return trip. Opaque to everything above. */
  readonly callbackParams: Readonly<Record<string, string>>;
}

/** What the merchant chose on the platform's own account-selection screen. */
export interface ConnectedAccount {
  readonly externalAccountId: string;
  readonly accountName: string | null;
  /**
   * The ad account's own currency, which is allowed to differ from the Store's.
   * Recorded, never converted (ADR-0005).
   */
  readonly currency: string | null;
}

export interface AdPlatformProvider {
  /**
   * Issues a credential scoped to one Store, creating the provider-side scope
   * if this is the Store's first connection.
   */
  issueStoreCredential(input: IssueCredentialInput): Promise<StoreCredential>;

  beginConnection(input: BeginConnectionInput): Promise<BeginConnectionResult>;

  /**
   * Resolves what the merchant actually approved.
   *
   * Returns `null` when they approved nothing — denied, abandoned, or came back
   * without choosing an account. That is a normal outcome, not an error: the
   * merchant is returned to a page that says so rather than to a dead end.
   */
  completeConnection(
    input: CompleteConnectionInput,
  ): Promise<ConnectedAccount | null>;

  /** Unlinks one platform from a Store's scope, leaving the others alone. */
  disconnect(credential: StoreCredential, platform: AdPlatform): Promise<void>;

  /**
   * Destroys the Store's scope at the provider. Called when the Store's last
   * connection goes, so a credential never outlives a reason to hold one.
   */
  revokeStoreCredential(credential: StoreCredential): Promise<void>;
}
