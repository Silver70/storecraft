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
  /**
   * Link clicks — people the ad sent to the destination. Not the platform's
   * "clicks (all)", which counts likes and image taps too and would make every
   * conversion rate built on it meaningless without looking wrong.
   */
  readonly clicks: number;
}

/**
 * What the platform says about whether something is delivering — the first of
 * the three separate axes a Campaign or an Ad is described on.
 *
 * Neutral spellings of the platform's own states, translated at the adapter
 * edge so nothing above it reads a vendor's vocabulary. `deleted` is a real
 * state rather than an absence: an object deleted on the platform keeps its
 * history there, and here.
 */
export type DeliverySignal =
  | 'active'
  | 'paused'
  | 'pending_review'
  | 'rejected'
  | 'completed'
  | 'deleted'
  | 'error';

/**
 * The platform's review verdict — the second axis, reported independently of
 * delivery. An ad can be delivering while its campaign is still in review, and a
 * rejected ad is distinguishable from a healthy one only here.
 */
export type ReviewSignal =
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'with_issues';

/**
 * The platform's separate signals about one Campaign or Ad, before they are
 * collapsed into the five statuses a merchant reads.
 *
 * The collapse is not done here because the third axis, the schedule, needs
 * *now* — and the adapter is not the place a clock is read. See
 * `platform-status.util.ts`, which is the one place it happens.
 */
export interface PlatformSignals {
  readonly delivery: DeliverySignal;
  /** Null where the platform reports no review signal at all. */
  readonly review: ReviewSignal | null;
  /**
   * When the platform says it runs. Either may be absent — anything still
   * delivering routinely has a start and no end.
   */
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

/** How an ad's creative is built, in the vocabulary Ads are stored in. */
export type ReportedAdFormat = 'image' | 'video' | 'carousel';

/**
 * One ad at the platform, with every day of the requested range it reported.
 *
 * The descriptive fields are here because a platform ad id recognises nothing.
 * The name, the creative and the format are what let a merchant tell which of
 * their own ads a row is about.
 */
export interface ReportedAd {
  /**
   * The ad's id at the platform — Meta's own, not the provider's document id —
   * because it is what `utm_content={{ad.id}}` expands to on a click, and the
   * join from an Order to its Ad is an equality on it.
   */
  readonly externalAdId: string;
  readonly name: string | null;
  /** Null where the platform has not classified it. */
  readonly format: ReportedAdFormat | null;
  /**
   * The creative, as a URL the platform hosts. Signed, and expiring within
   * about a day, so it is copied into our own storage on first sight and never
   * stored as it is. Null where the platform offers none.
   */
  readonly creativeUrl: string | null;
  /**
   * The platform's id for the Ad Set the ad sits in, or null where it did not
   * say. Kept as a handle only, because the Ad Set holds what an edit reaches:
   * the schedule, and the place a new ad is added.
   */
  readonly externalAdSetId: string | null;
  readonly signals: PlatformSignals;
  readonly days: readonly ReportedAdDay[];
}

/**
 * One campaign at the platform, with its ads read as its own whichever ad set
 * they sit in — the ad set level is not modelled.
 */
export interface ReportedCampaign {
  /** What `utm_campaign={{campaign.id}}` expands to on a click. */
  readonly externalCampaignId: string;
  readonly name: string | null;
  readonly signals: PlatformSignals;
  readonly budget: ReportedBudget;
  readonly ads: readonly ReportedAd[];
}

/**
 * Where a campaign's budget lives, and the one figure Edit can change.
 *
 * `daily` is **in minor units**, converted at the adapter edge like spend. It
 * is set only for a daily budget on the campaign itself. A budget per Ad Set,
 * or a lifetime budget, has no single daily figure to show or to change here.
 */
export interface ReportedBudget {
  /** Null where the platform did not say. */
  readonly level: 'campaign' | 'ad_set' | null;
  readonly daily: number | null;
}

/**
 * What the platform says is on the ad account and what each ad did.
 *
 * `currency` is the ad account's own, and on a connected account it is the
 * Store's — the connection refuses any other, so nothing downstream ever has a
 * rate to apply or a mismatch to explain. Null when the platform reported no
 * campaign to read it from.
 */
export interface AdTree {
  readonly currency: string | null;
  readonly campaigns: readonly ReportedCampaign[];
  /**
   * False when the platform says part of the requested range is still being
   * gathered — which it does for a while after a first connection.
   *
   * What did arrive is still worth writing, but the sync must not count the
   * range as covered: every later sync asks only for a trailing window, so a
   * range recorded as done while half-empty would stay half-empty for good.
   */
  readonly complete: boolean;
}

export interface ReadLinkTagsInput extends GrantedAccount {
  /** The ad's id at the platform. */
  readonly externalAdId: string;
}

/** One click parameter, as it is written to an ad. */
export interface ClickParam {
  readonly key: string;
  /** Unencoded. The platform's macros, like `{{ad.id}}`, are passed as they are. */
  readonly value: string;
}

export interface WriteLinkTagsInput extends GrantedAccount {
  /** The ad's id at the platform. */
  readonly externalAdId: string;
  /**
   * Every click parameter the ad will carry afterwards, in order. Not a patch:
   * whatever the ad carried before and is not in this list is gone.
   */
  readonly tags: readonly ClickParam[];
}

/**
 * Why the platform will not retag one ad. A fact about that ad, not about the
 * platform: the next ad in the same campaign may take its tags fine.
 *
 * - `cannot_rebuild` — the platform will not rebuild this creative with new
 *   tags. Chiefly an ad made from an existing Facebook or Instagram post, whose
 *   likes and comments belong to the post; also a creative customised per
 *   placement.
 * - `not_found` — the platform no longer has the ad, usually because it was
 *   deleted.
 * - `unsupported` — the ad sits on a surface with no click-URL tags at all.
 * - `not_applied` — the platform answered success and then reported tags that
 *   are not ours.
 */
export type LinkTagRefusal =
  | 'cannot_rebuild'
  | 'not_found'
  | 'unsupported'
  | 'not_applied';

export type LinkTagWrite =
  | { readonly outcome: 'written' }
  | { readonly outcome: 'refused'; readonly reason: LinkTagRefusal };

/** A creative's bytes, fetched from wherever the platform hosts them. */
export interface CreativeFile {
  readonly body: Buffer;
  readonly contentType: string;
}

/**
 * A purchase, as the platform is told about it from our server.
 *
 * The other direction of the integration: everything above reads what the
 * platform did, and this tells it what happened afterwards. It is what lets a
 * campaign be optimised for sales rather than for cheap clicks, and it is the
 * copy that survives an ad blocker — the storefront's Pixel reports the same
 * purchase from the browser, and both carry the Order's id as `eventId` so the
 * platform counts one purchase rather than two.
 *
 * **`value` is minor units**, like every other amount in this codebase. The
 * platform takes decimals; the conversion is the adapter's, at the edge, in the
 * same file and by the same rule that converts its figures on the way in.
 *
 * The contact fields are the customer's own, in plaintext, and this is the one
 * shape in this codebase that carries them across a network boundary. Everything
 * that reaches the platform is hashed — that is Meta's requirement, not a
 * courtesy — and the hashing is done by whoever implements this, because a value
 * we hashed ourselves would be hashed again there and match nobody. An adapter
 * that cannot promise that must not implement this method.
 */
export interface PurchaseEvent {
  /**
   * The Order's id, used verbatim as the platform's event id.
   *
   * Not a dispatch id and not a random one: the browser's copy of the same
   * purchase carries this value too, and the platform's deduplication is the
   * only reason one sale does not become two.
   */
  readonly eventId: string;
  /** When the purchase happened, which is when the Order was placed. */
  readonly occurredAt: Date;
  /** The Order total, in minor units. */
  readonly value: number;
  readonly currency: string;
  /** The customer's own address and number, unhashed. Either may be absent. */
  readonly email: string | null;
  readonly phone: string | null;
  /**
   * The ad platform's browser identifiers, frozen onto the Order at checkout —
   * `_fbp` for the browser and `_fbc` for the ad click that brought it. They are
   * the highest-signal match keys a web purchase has, and they are worthless
   * collected later, which is why they travel with the cart.
   */
  readonly browserId: string | null;
  readonly clickId: string | null;
  /**
   * Where the purchase happened. The Store's storefront, where it has told us
   * one; null on a Store that never did, and on an Order that was not a web sale.
   */
  readonly sourceUrl: string | null;
  /**
   * Whether this was a shopper on the storefront or an Order somebody keyed in.
   *
   * The platform records the two differently, and a phone sale reported as a
   * website purchase is a lie that costs match quality rather than one anybody
   * notices.
   */
  readonly origin: 'storefront' | 'internal';
}

export interface SendPurchaseInput extends GrantedAccount {
  /** The ad account's Pixel, as the connection recorded it. */
  readonly pixelId: string;
  readonly event: PurchaseEvent;
}

/**
 * The button on an ad, in the vocabulary this codebase uses. A short list on
 * purpose: these are the ones that make sense for a click that lands on a shop.
 */
export const CALLS_TO_ACTION = [
  'shop_now',
  'buy_now',
  'order_now',
  'get_offer',
  'learn_more',
  'sign_up',
  'subscribe',
] as const;

export type CallToAction = (typeof CALLS_TO_ACTION)[number];

/**
 * What an ad shows: one image or one video, at a public URL the platform can
 * fetch. Always one of ours, from product media or an upload to our own
 * storage, and never a link a merchant typed.
 */
export type CreativeMedia =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'video'; readonly url: string };

/** One ad of a campaign about to be created, fully resolved. */
export interface AdDraft {
  /** The ad's name at the platform, unique within the campaign. */
  readonly name: string;
  readonly media: CreativeMedia;
  readonly primaryText: string;
  readonly headline: string;
  readonly callToAction: CallToAction;
  /** Already resolved to the Store's own storefront. */
  readonly destinationUrl: string;
}

/**
 * A campaign as it is sent to the platform: everything the merchant chose,
 * resolved, plus what is fixed and never offered as a choice.
 *
 * What is fixed is in the shape rather than left to the adapter's defaults.
 * The goal is always Sales, optimised for the Pixel's Purchase event, so
 * `pixelId` is required. There is exactly one ad set, with the budget on the
 * campaign. Placements are automatic and bidding is the platform's default.
 * Neither appears here, because there is nothing to choose.
 */
export interface CampaignDraft {
  readonly name: string;
  /** Per day, in minor units of `currency`. The adapter converts at the edge. */
  readonly dailyBudget: number;
  /** The Store's currency, which the connection guarantees is the ad account's. */
  readonly currency: string;
  /** Null starts delivering as soon as the platform approves it. */
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly countries: readonly string[];
  readonly ageMin: number;
  readonly ageMax: number;
  /** The Pixel the campaign optimises against, as the connection recorded it. */
  readonly pixelId: string;
  /**
   * The click parameters every ad is created carrying. **This is the join.**
   * They are part of the draft, not something to add later, so no create path
   * can ever send an ad without them.
   */
  readonly linkTags: readonly ClickParam[];
  /** One to six, in the order the merchant arranged them. */
  readonly ads: readonly AdDraft[];
  /** Live straight away, or created paused to review before it spends. */
  readonly launch: 'active' | 'paused';
}

export interface CampaignDraftInput extends GrantedAccount {
  /** The ad account the merchant chose, as the platform spells it. */
  readonly externalAccountId: string;
  readonly draft: CampaignDraft;
}

export interface CreateCampaignInput extends CampaignDraftInput {
  /**
   * Makes a retried create answer with the first one's result instead of
   * building a second campaign. The same key with a different draft is refused.
   */
  readonly idempotencyKey: string;
}

/** Which part of the form a complaint is about. */
export type DraftField =
  | 'name'
  | 'dailyBudget'
  | 'schedule'
  | 'audience'
  | 'media'
  | 'primaryText'
  | 'headline'
  | 'callToAction'
  | 'destination';

/**
 * One thing the platform objects to, in the platform's own words.
 *
 * `adIndex` points at the ad it is about, or is null for the campaign as a
 * whole. `field` is where on the form it belongs, when the platform said.
 */
export interface DraftComplaint {
  readonly adIndex: number | null;
  readonly field: DraftField | null;
  readonly message: string;
}

/** What a dry run of a draft found. */
export interface DraftCheck {
  /** Empty when the platform accepts the draft as it stands. */
  readonly complaints: readonly DraftComplaint[];
  /**
   * Ads the dry run could not check, by index. Their media is only examined
   * when the campaign is created, so a complaint about one arrives then.
   */
  readonly unchecked: readonly number[];
}

/** One ad the platform built, as it reported it. */
export interface CreatedAd {
  /** Meta's own ad id — what `{{ad.id}}` expands to. */
  readonly externalAdId: string;
  readonly name: string | null;
  readonly format: ReportedAdFormat | null;
  /** The Ad Set it was built in, where the platform said. */
  readonly externalAdSetId: string | null;
  readonly signals: PlatformSignals;
}

export interface CreatedCampaign {
  /** Meta's own campaign id — what `{{campaign.id}}` expands to. */
  readonly externalCampaignId: string;
  readonly signals: PlatformSignals;
  readonly ads: readonly CreatedAd[];
}

/**
 * The platform would not create the campaign, for a reason about the campaign.
 * Its complaints are passed back for the form. Nothing was created.
 *
 * A failure of the integration itself is not this. That throws an ordinary
 * `HttpException`, because it says nothing about the draft.
 */
export class CampaignRejectedError extends Error {
  constructor(readonly complaints: readonly DraftComplaint[]) {
    super(complaints.map((c) => c.message).join(' '));
  }
}

/**
 * The same create is already in flight at the provider, under the same key.
 * The first one's outcome is the answer, and a second is not started.
 */
export class CreateInFlightError extends Error {
  constructor() {
    super('this campaign is already being created');
  }
}

/**
 * The platform refused one change, for a reason about that change: a budget
 * under its minimum, an end date it will not take, a campaign it no longer
 * has. Nothing was changed. `message` is the platform's own words where it
 * gave any, written for the person who made the change.
 *
 * A failure of the integration itself is not this. That throws an ordinary
 * `HttpException`, because it says nothing about the change.
 */
export class ChangeRejectedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** The switch a merchant can flip on a Campaign or an Ad. Nothing else. */
export type DeliverySwitch = 'active' | 'paused';

export interface UpdateCampaignInput extends GrantedAccount {
  /** The campaign's id at the platform. */
  readonly externalCampaignId: string;
  /** A new name, or absent to leave it. */
  readonly name?: string;
  /**
   * A new daily budget on the campaign, in minor units of the Store's
   * currency, which the connection guarantees is the ad account's. Absent
   * leaves it. The adapter converts at the edge.
   */
  readonly dailyBudget?: number;
}

export interface SetCampaignDeliveryInput extends GrantedAccount {
  readonly externalCampaignId: string;
  readonly status: DeliverySwitch;
}

export interface SetAdDeliveryInput extends GrantedAccount {
  readonly externalAdId: string;
  readonly status: DeliverySwitch;
}

export interface SetAdSetEndInput extends GrantedAccount {
  readonly externalAdSetId: string;
  /** When it stops delivering, or null to run until it is stopped. */
  readonly endsAt: Date | null;
}

export interface AddAdInput extends GrantedAccount {
  /** The ad account the merchant chose, as the platform spells it. */
  readonly externalAccountId: string;
  /** The Ad Set the ad joins. It inherits that Ad Set's budget, audience and schedule. */
  readonly externalAdSetId: string;
  readonly ad: AdDraft;
  /** The Pixel the ad reports to, as the connection recorded it. */
  readonly pixelId: string;
  /**
   * The click parameters the ad is created carrying. **This is the join**, as
   * it is on a create, so an added ad is measurable from its first click.
   */
  readonly linkTags: readonly ClickParam[];
  /** Makes a retried add answer with the first one's ad instead of a second. */
  readonly idempotencyKey: string;
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
   * The link tags on one ad, as the platform stores them — an `&`-joined query
   * string with the platform's macros unexpanded — or null where it has none.
   *
   * A pure read, asked once per ad when the sync first sees it: it is one call
   * per ad against a shared quota, and an ad's tags only change when something
   * rebuilds its creative.
   */
  readLinkTags(input: ReadLinkTagsInput): Promise<string | null>;

  /**
   * Replaces one ad's link tags.
   *
   * **This costs the merchant something, and is only called when they asked.**
   * The platform's creatives are immutable, so a tag change is a new creative:
   * the ad goes back through review, and an ad built from an existing post
   * cannot take one without losing the post's engagement. Only the tags are
   * sent — never a rebuilt creative — so the platform either keeps the rest of
   * the creative exactly as it was or refuses.
   *
   * A refusal that is a fact about this ad answers `refused` with the reason,
   * so the caller can report it and carry on with the next ad. Anything else —
   * unreachable, rate-limited, a failure the platform did not explain — throws,
   * because it says nothing about the ad and everything about whether the next
   * call would work.
   */
  writeLinkTags(input: WriteLinkTagsInput): Promise<LinkTagWrite>;

  /**
   * A dry run of a campaign: the platform's own checks, and nothing created.
   *
   * Budget minimums, image dimensions and copy the platform rejects come back
   * as complaints for the form rather than as a failed create. An integration
   * failure throws, because it says nothing about the draft.
   */
  validateCampaign(input: CampaignDraftInput): Promise<DraftCheck>;

  /**
   * Creates the campaign, its one ad set and every ad in a single call, each
   * ad carrying `draft.linkTags`.
   *
   * **This spends the merchant's money**, unless the draft is launched paused.
   * It is only called after the dry run passed and the merchant pressed
   * Publish or Save as paused.
   *
   * Throws `CampaignRejectedError` when the platform refuses the campaign
   * itself, with its complaints. It throws `CreateInFlightError` when the same
   * key is still being created. Anything else throws as it comes.
   */
  createCampaign(input: CreateCampaignInput): Promise<CreatedCampaign>;

  /**
   * Renames a campaign, or changes its daily budget, or both.
   *
   * **A budget change spends, or stops spending, the merchant's money** from
   * the moment the platform accepts it. It is only called when the merchant
   * saved the change. Throws `ChangeRejectedError` when the platform refuses
   * the change itself, which it does for a budget that lives on the Ad Sets.
   */
  updateCampaign(input: UpdateCampaignInput): Promise<void>;

  /**
   * Pauses or resumes a whole campaign. Its Ads keep their own switches, so a
   * resume brings back what was running before the pause.
   */
  setCampaignDelivery(input: SetCampaignDeliveryInput): Promise<void>;

  /** Pauses or resumes one Ad, and nothing beside it. */
  setAdDelivery(input: SetAdDeliveryInput): Promise<void>;

  /**
   * Sets or clears when one Ad Set stops delivering. The schedule lives on the
   * Ad Set, so a campaign's end date is written to each of its Ad Sets.
   */
  setAdSetEnd(input: SetAdSetEndInput): Promise<void>;

  /**
   * Adds one ad to an Ad Set that is already running, carrying `linkTags`
   * in the same call that creates it.
   *
   * **This spends the merchant's money** once the platform approves the ad. It
   * has no dry run: the platform does not dry-run an ad added to an existing
   * Ad Set. So a complaint about the ad arrives here, as `CampaignRejectedError`,
   * and nothing is created.
   */
  addAd(input: AddAdInput): Promise<CreatedAd>;

  /**
   * The bytes behind a creative URL the tree reported.
   *
   * On the interface rather than a bare `fetch` in the sync because it reaches
   * the network, and this seam is where the suite swaps the network out. It
   * carries no credential: the platform's image links are signed on their own,
   * and a Store's key has no business travelling to a CDN.
   */
  fetchCreative(url: string): Promise<CreativeFile>;

  /**
   * Reports one purchase to the ad account's Pixel.
   *
   * Resolves only when the platform has accepted it. Anything else throws —
   * unreachable, refused, or accepted-but-rejected-per-event, which some
   * platforms answer with a `200` — because the caller's whole job is to tell a
   * purchase that landed from one that is still owed, and a method that
   * swallowed a per-event rejection would have it record a success.
   *
   * Safe to call twice with the same `eventId` and it is never a second
   * purchase: the platform deduplicates on that id, which is also how the
   * browser's copy of this event and this one collapse into one. The bookkeeping
   * that stops us calling twice in the first place is above this line, in the
   * dispatch row.
   */
  sendPurchase(input: SendPurchaseInput): Promise<void>;

  /**
   * Whether the provider is answering, and how much history it offers.
   *
   * Asked before a backfill rather than on every sync: it decides how far back
   * day one reaches, and a call whose only purpose is to be reassuring is a
   * call against a shared quota.
   */
  health(platform: AdPlatform): Promise<ProviderHealth>;
}
