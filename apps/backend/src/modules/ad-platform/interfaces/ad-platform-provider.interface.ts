import type { AdPlatform } from '../../../shared/database/schema';

/**
 * The one place this codebase reaches an ad platform, and the second
 * collaborator after `PaymentProvider` that would otherwise reach a third party
 * over the network.
 *
 * **The vendor's name does not appear here, and must not.** No service,
 * repository, controller, table, column or domain type in this codebase is
 * named after whoever implements this. One adapter file knows who they are; if
 * that changes, only that file changes.
 *
 * ## Why the seam survives a vendor that is not replaceable
 *
 * ADR-0006 settles that Campaigns *are* the platform's campaigns, reached
 * through one named vendor, and that there is no fallback. So this interface is
 * no longer insurance against losing them. It earns its place for one reason:
 * it is where the in-memory fake is swapped in, so the end-to-end suite drives
 * the real sync, the real database and the real admin API without anything
 * reaching the network. Keep the surface small enough that the fake and the
 * adapter cannot drift, and assert it — see the contract spec beside this file.
 *
 * ## It is not read-only any more
 *
 * It was, deliberately: a merchant connecting a mirror could not be charged a
 * penny by anything we called. That premise is gone with ADR-0006 — a merchant
 * creates campaigns here and they spend real money — so the guarantee is now
 * that every write is one the merchant asked for and could review first, rather
 * than that no write exists. The connection flow already writes: it creates a
 * scope at the provider, and it creates a pixel on the ad account when there is
 * none to find.
 */
export const AD_PLATFORM_PROVIDER = 'AD_PLATFORM_PROVIDER';

/**
 * A credential scoped to one Store, and the provider's handle for that Store.
 *
 * Passed to every provider call rather than configured once on the adapter,
 * because "which Store is this for" must be impossible to forget. A provider
 * whose account-level key would work for every Store is precisely the failure
 * this shape exists to prevent — and this vendor is exactly that provider: its
 * write endpoints accept any account id the *team* owns, whichever scope the
 * key belongs to, which is the inverse of the guarantee `TenantScopedRepository`
 * holds everywhere else.
 *
 * `secret` is plaintext in memory for the duration of one call. It is never
 * returned by a read, never logged, and never serialized into a response.
 */
export interface StoreCredential {
  readonly providerRef: string;
  readonly secret: string;
  /**
   * The provider's id for the credential itself, where it issues one.
   *
   * A secret cannot name itself for deletion, so without this "revoked on
   * disconnect" would be true of our copy and false of theirs.
   */
  readonly providerKeyRef: string | null;
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
   * The platform's own hosted approval screen, and whatever selection the
   * platform itself insists on — a Facebook Page, because Meta will not run an
   * ad without one. We build no screen of our own here: the merchant approves
   * with their own credentials, seeing what the platform says they are granting.
   */
  readonly approvalUrl: string;
}

export interface CompleteConnectionInput {
  readonly credential: StoreCredential;
  readonly platform: AdPlatform;
  /** Whatever the platform put on the return trip. Opaque to everything above. */
  readonly callbackParams: Readonly<Record<string, string>>;
}

/**
 * What the merchant granted, which is access — not an ad account.
 *
 * The distinction is the whole reason connecting takes two steps. The platform
 * asks the merchant to approve an integration and to pick a Page; it does not
 * ask which ad account this *Store* reports against, because it has no idea
 * this Store exists. That choice is ours to offer and ours to refuse, and it
 * happens after the merchant is already back in the admin.
 */
export interface ConnectionGrant {
  readonly providerAccountRef: string;
}

/** A grant that has been resolved to one ad account, as later calls name it. */
export interface GrantedAccount {
  readonly credential: StoreCredential;
  readonly platform: AdPlatform;
  readonly providerAccountRef: string;
}

/**
 * One ad account the approved login can see.
 *
 * Every one is offered, including the ones that cannot be used: an ad account
 * missing from a picker is a merchant wondering whether they approved the wrong
 * login. What it cannot do is arrive without saying why.
 */
export interface AdAccountOption {
  /** The ad account id at the platform, as the platform spells it. */
  readonly externalAccountId: string;
  readonly name: string | null;
  /**
   * The currency the account is billed in.
   *
   * It has to match the Store's. Nothing in this feature converts a figure, so
   * a mismatch is refused rather than reconciled — in the picker, and again on
   * the way in.
   */
  readonly currency: string | null;
  /**
   * The platform's own reason this account cannot be used — unsettled billing,
   * a closed account — or null when the platform is happy with it.
   *
   * Only the platform's reasons appear here. A currency mismatch is ours and is
   * decided above, against the Store.
   */
  readonly unusableReason: string | null;
}

export interface EnsurePixelInput extends GrantedAccount {
  /** The ad account the merchant chose, as the platform spells it. */
  readonly externalAccountId: string;
  /** What a pixel we have to create is named after. */
  readonly storeName: string;
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

export interface FetchAdTreeInput extends GrantedAccount {
  /** The ad account the merchant chose, as the platform spells it. */
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
  readonly days: readonly ReportedAdDay[];
}

/**
 * What the platform says is running and what it says each ad did.
 *
 * `currency` is the ad account's own, and on a connected account it is the
 * Store's — the connection refuses any other, so nothing downstream ever has a
 * rate to apply or a mismatch to explain.
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
   * Returns `null` when they approved nothing — denied, or closed the tab. That
   * is a normal outcome, not an error: the merchant is returned to a page that
   * says so rather than to a dead end. A platform that answers with a failure
   * throws instead, so the two are told apart on the page.
   */
  completeConnection(
    input: CompleteConnectionInput,
  ): Promise<ConnectionGrant | null>;

  /**
   * Every ad account the approved login can see, including the ones it cannot
   * use, each carrying the platform's own reason where there is one.
   *
   * A pure read against a grant. It is asked once on the way back from the
   * platform and again whenever the merchant reopens the picker, because an ad
   * account's standing at the platform is not ours to cache.
   */
  listAdAccounts(input: GrantedAccount): Promise<readonly AdAccountOption[]>;

  /**
   * The ad account's pixel: the first one it already has, or a new one named
   * after the Store.
   *
   * Listing first is not an optimisation. Creating a pixel is not idempotent at
   * the platform — a second call makes a second pixel — so a connection that
   * created one every time would litter a merchant's ad account with them.
   */
  ensurePixel(input: EnsurePixelInput): Promise<string>;

  /** Unlinks one platform from a Store's scope, leaving the others alone. */
  disconnect(input: GrantedAccount): Promise<void>;

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
