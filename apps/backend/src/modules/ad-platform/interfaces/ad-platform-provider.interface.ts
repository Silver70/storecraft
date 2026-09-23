import type {
  AdPlatform,
  AdPlatformState,
} from '../../../shared/database/schema';

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
 * The conversion happens in the adapter, at the edge, because a vendor reports
 * decimals and this codebase holds money as integers. By the time a value has
 * this type it is an integer, and no float reaches a service, a repository or a
 * report.
 *
 * Three figures, and they are measurements: what the ad account was charged,
 * how many times the ad was shown, and how many people it sent somewhere. The
 * platform's own **revenue, conversions and ROAS are not here** and are not
 * read. They were claims made on an attribution window that is not ours, held
 * in a table of their own and printed beside our figures with a paragraph
 * explaining the disagreement — which asked a merchant to arbitrate between two
 * numbers instead of giving them one.
 */
export interface ReportedAdDay {
  /** `YYYY-MM-DD`, as the platform dated it. */
  readonly day: string;
  /** In minor units of the tree's currency. */
  readonly spend: number;
  readonly impressions: number;
  readonly clicks: number;
}

/**
 * One ad at the platform, with every day of the requested range it reported.
 *
 * The descriptive fields are here because a platform ad id recognises nothing.
 * The name, the creative and the flight are what let a merchant tell which of
 * their own ads a row is about.
 */
export interface ReportedAd {
  /** The ad's id at the platform. The key everything about it is held under. */
  readonly externalAdId: string;
  readonly name: string | null;
  /** The creative, as a URL the platform hosts. Null where it offers none. */
  readonly creativeUrl: string | null;
  /**
   * When the platform says the ad ran. Either may be absent — platforms
   * routinely report a start and no end for anything still delivering.
   */
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /**
   * What the platform says about the ad right now — approved, rejected, in
   * review, delivering, paused — or null where it says nothing.
   *
   * This is the platform's fact and it is stored beside ours, never instead of
   * it: nothing downstream of here may write `ads.status` from this value. The
   * merchant learning from their own dashboard that an ad was rejected is the
   * whole point, and it only works because an Ad that is active here stays
   * active here when this says `rejected`.
   *
   * Null is an ordinary answer. A platform that does not report a review state
   * reports none, and an Ad simply carries no platform state.
   */
  readonly platformState: AdPlatformState | null;
  /**
   * Where the ad ran, as a label the merchant will recognise — "Instagram
   * Stories". Null where the platform names none.
   *
   * **A label, not a dimension.** One ad runs in several placements at once, so
   * an adapter with several to report joins them into one readable label rather
   * than returning a list: nothing above reports by, filters by or groups by
   * this, and a list would be an invitation to start.
   */
  readonly placement: string | null;
  readonly days: readonly ReportedAdDay[];
}

/**
 * What the platform says is running and what it says each ad did.
 *
 * `currency` is the ad account's own and is allowed to differ from the Store's.
 * It is carried here so every figure can be stored as the currency it actually
 * is — no rate is fetched, inferred or hard-coded anywhere in this feature.
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
