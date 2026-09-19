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
 * `fetchAdTree` is the only read of substance, and it is a read: it names a
 * date range and returns what the platform says happened in it. It cannot
 * change anything at the platform, and no call here can.
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

/** Whether the platform is answering, and how much history it will answer with. */
export interface ProviderHealth {
  readonly reachable: boolean;
  /**
   * How far back this platform reports, in days.
   *
   * The backfill asks for the history the platform offers and not a day more:
   * a request past the window returns nothing extra and spends a quota that is
   * shared across every customer of the provider to learn that.
   */
  readonly maxBackfillDays: number;
}

export interface FetchAdTreeInput {
  readonly credential: StoreCredential;
  readonly platform: AdPlatform;
  /** The ad account the merchant approved, as the platform spells it. */
  readonly externalAccountId: string;
  /** Inclusive `YYYY-MM-DD`, already resolved in the Store's timezone. */
  readonly from: string;
  /** Inclusive `YYYY-MM-DD`. The day the merchant is currently spending in. */
  readonly to: string;
}

/**
 * One ad's figures for one day, **already in minor units**.
 *
 * The conversion happens in the adapter, at the edge, because the vendor
 * reports decimals and this codebase holds money as integers. By the time a
 * value has this type it is an integer, and no float reaches a service, a
 * repository or a report.
 */
export interface ReportedAdDay {
  /** `YYYY-MM-DD`, as the platform dated it. */
  readonly day: string;
  /** In minor units of the tree's currency. */
  readonly spend: number;
  readonly impressions: number;
  readonly clicks: number;
  /** On the *platform's* attribution window, which is not our Lookback Window. */
  readonly conversions: number;
  /** What the platform claims the ad earned, in minor units. */
  readonly reportedRevenue: number;
  /**
   * The platform's own ROAS in basis points — 25000 is 2.5x — or null where it
   * states none. Null is not zero, and nothing recomputes it from the two
   * figures above: this is a claim the platform made, not arithmetic of ours.
   */
  readonly reportedRoasBp: number | null;
}

/** One ad at the platform, with every day of the requested range it reported. */
export interface ReportedAd {
  /** The ad's id at the platform. The key everything about it is held under. */
  readonly externalAdId: string;
  readonly name: string | null;
  readonly days: readonly ReportedAdDay[];
}

/**
 * What the platform says is running and what it says each ad did.
 *
 * `currency` is the ad account's own and is allowed to differ from the Store's.
 * It is carried here so every figure can be stored as the currency it actually
 * is — no rate is fetched, inferred or hard-coded anywhere in this feature
 * (ADR-0005).
 */
export interface AdTree {
  readonly currency: string;
  readonly ads: readonly ReportedAd[];
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

  /**
   * What the platform says its ads did, per ad per day, over a date range.
   *
   * A pure read. It names a range rather than "everything since last time"
   * because the caller owns that decision: a first connection asks for history
   * so the feature is useful on day one, and every sync after it re-asks for a
   * trailing window, since platforms restate figures days after the fact.
   *
   * Asking twice for the same range is expected and must be safe — the
   * idempotency that makes it safe is enforced above, in the write.
   */
  fetchAdTree(input: FetchAdTreeInput): Promise<AdTree>;

  /**
   * Whether the provider is answering, and how much history it offers.
   *
   * Asked before a backfill rather than on every sync: it decides how far back
   * day one reaches, and a call whose only purpose is to be reassuring is a
   * call against a shared quota.
   */
  health(platform: AdPlatform): Promise<ProviderHealth>;
}
