import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdPlatform } from '../../../shared/database/schema';
import {
  CampaignRejectedError,
  CreateInFlightError,
} from '../interfaces/ad-platform-provider.interface';
import type {
  AdAccountOption,
  AdDraft,
  AdPlatformProvider,
  AdTree,
  BeginConnectionInput,
  CallToAction,
  CampaignDraftInput,
  ClickParam,
  BeginConnectionResult,
  CompleteConnectionInput,
  ConnectionGrant,
  CreateCampaignInput,
  CreatedAd,
  CreatedCampaign,
  CreativeFile,
  DeliverySignal,
  DraftCheck,
  DraftComplaint,
  DraftField,
  EnsurePixelInput,
  FetchAdTreeInput,
  GrantedAccount,
  IssueCredentialInput,
  LinkTagWrite,
  PlatformSignals,
  ProviderHealth,
  ReadLinkTagsInput,
  ReportedAd,
  ReportedAdDay,
  ReportedAdFormat,
  ReportedCampaign,
  ReviewSignal,
  SendPurchaseInput,
  StoreCredential,
  WriteLinkTagsInput,
} from '../interfaces/ad-platform-provider.interface';
import {
  toCount,
  toDecimalAmount,
  toMinorUnits,
} from '../utils/reported-money.util';

/**
 * The vendor, and the only file in this codebase that knows who they are.
 *
 * Everything above this line talks about "the ad platform" and means the
 * platform the merchant approved on — Meta — never the intermediary we reach it
 * through. If that intermediary changes, this file changes and nothing else
 * does. No service, repository, controller, table, column or domain type is
 * named after them; grep for the name and this file is the answer.
 *
 * ## Two credentials, and which is used where
 *
 * The **team key** (`ZERNIO_API_KEY`) owns the account. It is used for exactly
 * two things: creating a Store's profile and scoped key, and destroying them.
 * Everything else — approving, listing ad accounts, pixels, the ad tree — goes
 * through the **Store's own scoped key**, which can only see that Store's
 * profile.
 *
 * That split is not tidiness. The vendor's write endpoints accept any account
 * id the *team* owns, whichever profile it sits in, which is the inverse of the
 * guarantee `TenantScopedRepository` holds everywhere else. A per-Store key is
 * the narrowest credential they will issue, so it is the one every ordinary
 * call carries.
 *
 * ## Meta only
 *
 * ADR-0006 scopes this stage to Meta, read and write. The other platforms in
 * the `ad_platform` vocabulary are refused here rather than half-implemented:
 * a merchant told "not supported yet" has lost nothing, and a merchant
 * connected to a platform whose figures never arrive has lost the page.
 */
@Injectable()
export class ZernioAdPlatformAdapter implements AdPlatformProvider {
  private readonly logger = new Logger(ZernioAdPlatformAdapter.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Creates the Store's profile and the key scoped to it.
   *
   * The profile is named with our own Store id as well as its name, because the
   * vendor requires names to be unique within a team and two of a merchant's
   * stores are perfectly entitled to be called the same thing.
   */
  async issueStoreCredential(
    input: IssueCredentialInput,
  ): Promise<StoreCredential> {
    const label = `${input.storeName} (${input.storeId})`;

    const profile = await this.call<{ profile: { _id: string } }>(
      this.teamKey(),
      'POST',
      '/v1/profiles',
      { body: { name: label, description: 'commerce-os store' } },
    );
    const profileId = profile.profile._id;

    const issued = await this.call<{
      apiKey: { id: string; key: string };
    }>(this.teamKey(), 'POST', '/v1/api-keys', {
      body: {
        name: label,
        scope: 'profiles',
        profileIds: [profileId],
      },
    });

    return {
      providerRef: profileId,
      providerKeyRef: issued.apiKey.id,
      secret: issued.apiKey.key,
    };
  }

  /**
   * The platform's own approval screen, for this Store's profile alone.
   *
   * Deliberately not headless: the vendor hosts the Facebook Page picker that
   * Meta's ads flow requires, and a merchant should choose their Page on a
   * screen that says who is asking, not on one of ours. What we do not delegate
   * is the ad account, which the platform cannot choose for us because it has
   * never heard of this Store.
   */
  async beginConnection(
    input: BeginConnectionInput,
  ): Promise<BeginConnectionResult> {
    const platform = this.connectPlatform(input.platform);
    const result = await this.call<{ authUrl?: string; url?: string }>(
      input.credential.secret,
      'GET',
      `/v1/connect/${platform}/ads`,
      {
        query: {
          profileId: input.credential.providerRef,
          redirect_url: input.returnUrl,
        },
      },
    );

    const approvalUrl = result.authUrl ?? result.url;
    if (!approvalUrl) {
      throw new Error('the ad platform returned no approval link');
    }
    return { approvalUrl };
  }

  /**
   * Reads the return trip.
   *
   * Three outcomes, and they are not the same thing. An account id means the
   * merchant approved. Nothing at all means they denied or closed the tab,
   * which is normal and answers `null`. An `error` means the platform refused,
   * which throws, so the page can say the integration failed rather than
   * implying the merchant changed their mind.
   */
  completeConnection(
    input: CompleteConnectionInput,
  ): Promise<ConnectionGrant | null> {
    this.connectPlatform(input.platform);
    const params = input.callbackParams;

    if (params.error) {
      const detail = params.error_message ?? params.error;
      throw new ServiceUnavailableException(
        `The ad platform could not complete the connection: ${detail}`,
      );
    }

    const providerAccountRef = params.accountId;
    if (!providerAccountRef) return Promise.resolve(null);

    return Promise.resolve({ providerAccountRef });
  }

  async listAdAccounts(
    input: GrantedAccount,
  ): Promise<readonly AdAccountOption[]> {
    this.connectPlatform(input.platform);
    const result = await this.call<{ accounts?: RawAdAccount[] }>(
      input.credential.secret,
      'GET',
      '/v1/ads/accounts',
      { query: { accountId: input.providerAccountRef } },
    );

    return (result.accounts ?? []).map((account) => ({
      externalAccountId: account.id,
      name: account.name ?? null,
      currency: account.currency ?? null,
      unusableReason: unusableReason(account),
    }));
  }

  /**
   * The ad account's pixel: the first it already has, or a new one.
   *
   * Listing first is load-bearing. Creating a pixel is not idempotent here — a
   * second call makes a second pixel — so a connection that always created one
   * would leave a trail of them across a merchant's ad account, and a
   * reconnection would start reporting against a pixel with no history.
   */
  async ensurePixel(input: EnsurePixelInput): Promise<string> {
    this.connectPlatform(input.platform);

    const existing = await this.call<{ tags?: { id: string }[] }>(
      input.credential.secret,
      'GET',
      `/v1/accounts/${encodeURIComponent(input.providerAccountRef)}/tracking-tags`,
      { query: { adAccountId: input.externalAccountId } },
    );

    const found = existing.tags?.[0]?.id;
    if (found) return found;

    const created = await this.call<{ tag: { id: string } }>(
      input.credential.secret,
      'POST',
      `/v1/accounts/${encodeURIComponent(input.providerAccountRef)}/tracking-tags`,
      {
        body: {
          adAccountId: input.externalAccountId,
          name: `${input.storeName} storefront`,
        },
      },
    );
    return created.tag.id;
  }

  /**
   * Lets go of the approved login.
   *
   * A grant that is already gone is not a failure: the vendor answers 404 for
   * an account it has already disconnected, and a merchant pressing Disconnect
   * on something that is not connected wants it disconnected either way.
   */
  async disconnect(input: GrantedAccount): Promise<void> {
    await this.call<unknown>(
      input.credential.secret,
      'DELETE',
      `/v1/accounts/${encodeURIComponent(input.providerAccountRef)}`,
      { tolerate: [404] },
    );
  }

  /**
   * Destroys the Store's scope: the key first, then the profile it saw.
   *
   * Both go through the team key. A key cannot reliably revoke itself, and a
   * scoped key that outlived our copy of it would be an access grant nobody in
   * this system can see, name or use — the exact thing "revoked on disconnect"
   * is supposed to rule out.
   */
  async revokeStoreCredential(credential: StoreCredential): Promise<void> {
    if (credential.providerKeyRef) {
      await this.call<unknown>(
        this.teamKey(),
        'DELETE',
        `/v1/api-keys/${encodeURIComponent(credential.providerKeyRef)}`,
        { tolerate: [404] },
      );
    }
    await this.call<unknown>(
      this.teamKey(),
      'DELETE',
      `/v1/profiles/${encodeURIComponent(credential.providerRef)}`,
      { tolerate: [404] },
    );
  }

  /**
   * The ad account's tree, with a day per ad.
   *
   * Money crosses the boundary here and not one line later: the vendor reports
   * decimals the way its dashboard displays them and this codebase holds
   * integers in the smallest currency unit, so `toMinorUnits` runs at the edge
   * and no float reaches a service, a repository or a report.
   *
   * The tree is paginated by campaign, so this reads every page: a sync that
   * stopped at the first would silently leave the twenty-first campaign's spend
   * out of every total. The date range narrows the figures, not the campaigns —
   * every campaign on the account comes back, deleted ones included (the vendor
   * keeps them as `cancelled`), which is what lets the sync treat an absence as
   * meaningful.
   */
  async fetchAdTree(input: FetchAdTreeInput): Promise<AdTree> {
    this.connectPlatform(input.platform);

    const campaigns: ReportedCampaign[] = [];
    let currency: string | null = null;
    let complete = true;
    let skipped = 0;

    for (let page = 1; page <= MAX_TREE_PAGES; page++) {
      const tree = await this.call<RawTree>(
        input.credential.secret,
        'GET',
        '/v1/ads/tree',
        {
          query: {
            accountId: input.providerAccountRef,
            adAccountId: input.externalAccountId,
            fromDate: input.from,
            toDate: input.to,
            // Everything on the account, including ads built in Ads Manager: a
            // campaign we did not create still spent this merchant's money.
            source: 'all',
            timeIncrement: '1',
            dailyLevel: 'ad',
            page: String(page),
            limit: String(TREE_PAGE_SIZE),
          },
        },
      );

      // A 202 carrying this flag: part of the range is still being gathered,
      // which the vendor does for a while after an ad account is first
      // connected. What arrived is kept; the range is not counted as covered.
      if (tree?.backfillPending) complete = false;

      for (const raw of tree?.campaigns ?? []) {
        // The vendor groups ads with no campaign id into a synthetic bucket.
        // Meta has no such ads, and a bucket with no platform id could never
        // be joined to a click, so it is left out rather than invented.
        if (!raw.platformCampaignId) {
          skipped++;
          continue;
        }
        currency ??= raw.currency ?? null;
        campaigns.push(toReportedCampaign(raw));
      }

      const pages = tree?.pagination?.pages ?? 1;
      if (page >= pages || !tree?.campaigns?.length) break;
      if (page === MAX_TREE_PAGES) {
        // Far past any merchant this product serves. Marked incomplete rather
        // than treated as the whole account, so nothing absent from the pages
        // read is taken to have ended.
        complete = false;
        this.logger.warn(
          `Ad tree for one account exceeded ${MAX_TREE_PAGES} pages; the rest is left for the next sync`,
        );
      }
    }

    if (skipped) {
      this.logger.warn(
        `Left out ${skipped} ad tree node(s) that carried no platform campaign id`,
      );
    }

    return { currency, campaigns, complete };
  }

  /**
   * One ad's link tags, as Meta stores them on its creative.
   *
   * An ad the vendor cannot find, or one on a surface with no click-URL tags,
   * has none to read. Both answer null — "not ours" — rather than failing the
   * sync that asked, because the merchant's figures do not depend on it.
   */
  async readLinkTags(input: ReadLinkTagsInput): Promise<string | null> {
    this.connectPlatform(input.platform);
    const result = await this.call<{ urlTags?: string | null } | undefined>(
      input.credential.secret,
      'GET',
      `/v1/ads/${encodeURIComponent(input.externalAdId)}/tracking-tags`,
      { tolerate: [404, 405] },
    );
    return result?.urlTags ?? null;
  }

  /**
   * Replaces one ad's link tags, which Meta does by building a new creative.
   *
   * `urlTags` is sent alone. The vendor then copies the existing creative
   * exactly and adds the new tags, so the merchant's image, copy and button stay
   * as they were. The optional `creative` body would rebuild the ad from fields
   * we supply, and is never sent. The vendor answers 422 for a creative it
   * cannot copy: one made from an existing Page or Instagram post, a dark post,
   * or one customised per placement. That ad is reported, and nothing is built
   * for it.
   *
   * The macros go through as they are. The vendor passes `{{…}}` unescaped and
   * encodes everything else, so values are sent decoded.
   */
  async writeLinkTags(input: WriteLinkTagsInput): Promise<LinkTagWrite> {
    this.connectPlatform(input.platform);
    try {
      const result = await this.call<{ urlTags?: string | null } | undefined>(
        input.credential.secret,
        'PATCH',
        `/v1/ads/${encodeURIComponent(input.externalAdId)}/tracking-tags`,
        {
          body: {
            urlTags: input.tags.map(({ key, value }) => ({ key, value })),
          },
          refuse: [404, 405, 422],
        },
      );

      // The answer is the tags as they now stand. A success whose tags lack the
      // join has not tracked anything, whatever the status code said.
      const standing = result?.urlTags;
      if (typeof standing === 'string' && !sameJoin(standing, input.tags)) {
        return { outcome: 'refused', reason: 'not_applied' };
      }
      return { outcome: 'written' };
    } catch (error) {
      if (!(error instanceof RefusedByPlatform)) throw error;
      switch (error.status) {
        case 404:
          return { outcome: 'refused', reason: 'not_found' };
        case 405:
          return { outcome: 'refused', reason: 'unsupported' };
        default:
          return { outcome: 'refused', reason: 'cannot_rebuild' };
      }
    }
  }

  /**
   * The platform's dry run, one ad at a time.
   *
   * The vendor's dry run takes a campaign with a single ad, never the
   * several-ads shape the real create uses, and it cannot check a video it
   * would have to upload first. So each image ad is checked as a campaign of
   * its own. That uses the same budget, schedule, audience and tags as the real
   * create, with that one ad's creative. Video ads are reported unchecked:
   * their complaints arrive with the create.
   *
   * Meta checks the campaign and the creative this way. It cannot check the ad
   * set against a campaign that does not exist yet. The image is uploaded to
   * the ad account's library while it is checked, which is harmless: uploads
   * are deduplicated by content.
   *
   * A complaint that every checked ad produced is about the campaign, not one
   * ad, and is reported once.
   */
  async validateCampaign(input: CampaignDraftInput): Promise<DraftCheck> {
    this.connectPlatform(input.platform);
    const { draft } = input;

    const found: DraftComplaint[] = [];
    const unchecked: number[] = [];
    const checked: number[] = [];

    for (const [index, ad] of draft.ads.entries()) {
      if (ad.media.kind !== 'image') {
        unchecked.push(index);
        continue;
      }
      checked.push(index);
      try {
        await this.call<unknown>(
          input.credential.secret,
          'POST',
          '/v1/ads/create',
          {
            body: {
              ...campaignBody(input),
              adName: ad.name,
              ...singleCreative(ad),
              validateOnly: true,
            },
            refuse: [400, 422],
          },
        );
      } catch (error) {
        if (!(error instanceof RefusedByPlatform)) throw error;
        found.push(...complaintsFrom(error.body, index));
      }
    }

    return {
      complaints: settleComplaints(found, checked.length),
      unchecked,
    };
  }

  /**
   * Creates the campaign, one ad set and every ad in one call, the vendor's
   * several-creatives shape.
   *
   * **The Link Tags go in this call.** `tracking.urlTags` is applied to every ad
   * of the shape, onto the creative the platform builds, so there is no moment
   * when an ad exists without them. The Pixel goes in the same place, so each
   * ad reports Website events whatever it optimises for.
   *
   * The goal is Sales, optimised for the Pixel's Purchase event. The budget is
   * on the campaign (Meta's CBO), daily, in whole units of the currency: money
   * crosses the boundary here, by `toDecimalAmount`, as it does for a purchase.
   * Placements are automatic and bidding is the platform's default, because
   * neither is sent. A paused create holds the pause on the campaign, so one
   * switch brings the whole thing live later.
   *
   * The key makes a retry safe. The vendor replays the first answer to the
   * same key and body for a day, answers 409 while the first is in flight, and
   * 422 for the same key with a different body.
   */
  async createCampaign(input: CreateCampaignInput): Promise<CreatedCampaign> {
    this.connectPlatform(input.platform);
    const { draft } = input;

    let result: RawCreateResult | undefined;
    try {
      result = await this.call<RawCreateResult>(
        input.credential.secret,
        'POST',
        '/v1/ads/create',
        {
          body: {
            ...campaignBody(input),
            creatives: draft.ads.map((ad) => ({
              name: ad.name,
              ...singleCreative(ad),
            })),
          },
          headers: { 'Idempotency-Key': input.idempotencyKey },
          refuse: [400, 409, 422, 502],
        },
      );
    } catch (error) {
      if (!(error instanceof RefusedByPlatform)) throw error;
      if (error.status === 409) throw new CreateInFlightError();
      // A 502 is the vendor's own failure unless it carries Meta's objection,
      // which it does when Meta could not make something the ad needs.
      if (error.status === 502 && !isPlatformError(error.body)) {
        throw new ServiceUnavailableException(
          'The ad platform could not be reached just now. Nothing was created — try again shortly.',
        );
      }
      throw new CampaignRejectedError(
        settleComplaints(complaintsFrom(error.body, null), draft.ads.length),
      );
    }

    const rawAds = result?.ads ?? (result?.ad ? [result.ad] : []);
    const externalCampaignId =
      result?.platformCampaignId ?? rawAds[0]?.platformCampaignId;
    if (!externalCampaignId) {
      // Created, most likely, and unreadable. Said plainly rather than as a
      // failure: the next sync finds the campaign on the ad account.
      this.logger.error('A campaign create answered without a campaign id');
      throw new ServiceUnavailableException(
        'The ad platform accepted the campaign but did not say what it created. It will appear here after the next refresh — check before creating it again.',
      );
    }

    const paused = draft.launch === 'paused';
    const ads: CreatedAd[] = rawAds
      .filter((ad) => ad.platformAdId)
      .map((ad) => ({
        externalAdId: ad.platformAdId!,
        name: ad.name ?? null,
        format: toFormat(ad.creativeType),
        signals: {
          // A new ad with no status yet is in review, not broken.
          delivery: ad.status
            ? toDelivery(ad.status)
            : paused
              ? 'paused'
              : 'pending_review',
          review: toReview(ad.reviewStatus),
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
        },
      }));

    return {
      externalCampaignId,
      signals: {
        delivery: paused ? 'paused' : createdDelivery(ads),
        review: ads.some((ad) => ad.signals.review === 'in_review')
          ? 'in_review'
          : null,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
      },
      ads,
    };
  }

  /**
   * A creative's bytes, from wherever Meta hosts them.
   *
   * No credential goes with this request. The URL is signed on its own, and the
   * Store's key belongs to the vendor, not to a CDN. Only images are accepted —
   * a video ad's creative here is its poster frame — and only up to a size an
   * image has any business being.
   */
  async fetchCreative(url: string): Promise<CreativeFile> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new ServiceUnavailableException(
        'A creative image could not be fetched from the ad platform just now.',
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `A creative image could not be fetched from the ad platform (${response.status}).`,
      );
    }

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new ServiceUnavailableException(
        'The ad platform returned something other than an image for a creative.',
      );
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_CREATIVE_BYTES) {
      throw new ServiceUnavailableException(
        'A creative image from the ad platform was larger than expected.',
      );
    }
    return { body, contentType };
  }

  /**
   * Reports one purchase to the ad account's Pixel.
   *
   * Money crosses the boundary here, in the other direction and by the other half
   * of the same rule: the caller hands over an Order total in minor units and the
   * vendor is told `25.99`, so no float exists above this line and none is
   * invented below it.
   *
   * ## The customer's details are sent in plaintext, and that is not a slip
   *
   * Meta requires contact details hashed, and this vendor does the hashing — it
   * SHA-256s the values per Meta's spec before anything reaches the platform, and
   * documents that callers send plaintext. Hashing them here as well would hash a
   * hash, which matches nobody: the purchase would arrive, be attributed to no
   * person, and the feature would look like it worked. The browser identifiers,
   * `fbp` and `fbc`, go unhashed by Meta's own requirement.
   *
   * So what leaves this process is a customer's email and phone over TLS to the
   * vendor, and what reaches the ad platform is a digest. That is the trade this
   * integration makes, it is the only shape the vendor accepts, and it is the
   * reason this file is also the only one that ever holds those values in a
   * request body.
   *
   * ## A `200` is not an acceptance
   *
   * The vendor answers with a count of events received and a count that failed.
   * One event that failed inside a successful response is a purchase that did not
   * land, so it throws: the caller's whole job is to tell a reported purchase from
   * an owed one.
   */
  async sendPurchase(input: SendPurchaseInput): Promise<void> {
    this.connectPlatform(input.platform);
    const { event } = input;

    const result = await this.call<RawConversionResult>(
      input.credential.secret,
      'POST',
      '/v1/ads/conversions',
      {
        body: {
          accountId: input.providerAccountRef,
          // Meta's own name for a Pixel on this endpoint is the destination.
          destinationId: input.pixelId,
          events: [
            {
              eventName: 'Purchase',
              // Unix *seconds*. Milliseconds land the purchase thousands of years
              // in the future, where the platform drops it without complaint.
              eventTime: Math.floor(event.occurredAt.getTime() / 1000),
              // The Order's id, which the browser's copy carries too.
              eventId: event.eventId,
              value: toDecimalAmount(event.value),
              currency: event.currency,
              actionSource:
                event.origin === 'storefront' ? 'web' : 'system_generated',
              ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
              user: {
                ...(event.email ? { email: event.email } : {}),
                ...(event.phone ? { phone: event.phone } : {}),
                ...(event.browserId || event.clickId
                  ? {
                      clickIds: {
                        ...(event.browserId ? { fbp: event.browserId } : {}),
                        ...(event.clickId ? { fbc: event.clickId } : {}),
                      },
                    }
                  : {}),
              },
            },
          ],
        },
      },
    );

    const failed = result?.eventsFailed ?? 0;
    const received = result?.eventsReceived ?? 0;
    if (failed > 0 || received < 1) {
      // No detail from the body: it echoes the event, and the event is a
      // customer's contact details.
      throw new ServiceUnavailableException(
        'The ad platform did not accept the purchase event. Nothing has changed — it will be tried again shortly.',
      );
    }
  }

  /**
   * Whether the vendor is answering, and how much history it offers.
   *
   * 90 days is what its ads backfill covers, and asking for more spends a quota
   * shared across every customer of theirs to be told the same thing.
   */
  async health(platform: AdPlatform): Promise<ProviderHealth> {
    this.connectPlatform(platform);
    try {
      await this.call<unknown>(this.teamKey(), 'GET', '/v1/usage');
      return { reachable: true, maxBackfillDays: ADS_BACKFILL_DAYS };
    } catch (error) {
      this.logger.warn(`The ad platform did not answer: ${messageOf(error)}`);
      return { reachable: false, maxBackfillDays: ADS_BACKFILL_DAYS };
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * How the vendor spells the platform we mean, or a refusal.
   *
   * Meta's ads live behind the vendor's `facebook` connector. The rest of the
   * `ad_platform` vocabulary exists because a Campaign's platform column uses
   * it; none of them is in this stage, and each is refused with a sentence
   * rather than attempted.
   */
  private connectPlatform(platform: AdPlatform): string {
    if (platform !== 'meta') {
      throw new ServiceUnavailableException(
        `Connecting ${platform} is not supported yet. Meta is the only ad platform this store can connect.`,
      );
    }
    return 'facebook';
  }

  private teamKey(): string {
    const key = this.config.get<string>('ZERNIO_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'No ad platform integration is configured for this deployment.',
      );
    }
    return key;
  }

  private baseUrl(): string {
    return this.config
      .get<string>('ZERNIO_API_URL', 'https://zernio.com/api')
      .replace(/\/+$/, '');
  }

  /**
   * One request, and the one place a vendor failure becomes something this
   * codebase can read.
   *
   * The thrown message is written for a merchant, because it travels: the
   * connection service passes an `HttpException` straight through, and the sync
   * records it on the connection and prints it on the page. So it never blames
   * the merchant's own ad account for a refusal that is usually a quota shared
   * across every customer of the vendor — a merchant sent to check their
   * account finds nothing wrong and trusts the page less afterwards.
   *
   * Nothing from a response body is logged. These calls carry a credential and
   * return account identifiers, and a log line is the easiest place in a system
   * for either to end up.
   */
  private async call<T>(
    key: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string>;
      body?: unknown;
      /** Headers beyond the credential, such as an idempotency key. */
      headers?: Record<string, string>;
      /** Status codes that mean "already done", not "failed". */
      tolerate?: number[];
      /**
       * Status codes that are a refusal about this one object rather than a
       * failure of the integration. Thrown as `RefusedByPlatform`, so the caller
       * can report it and carry on.
       */
      refuse?: number[];
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl()}${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, value);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${key}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      this.logger.error(`${method} ${path} did not complete`);
      throw new ServiceUnavailableException(
        'The ad platform could not be reached just now. Nothing has changed — try again shortly.',
      );
    }

    if (options.tolerate?.includes(response.status)) {
      return undefined as T;
    }

    if (options.refuse?.includes(response.status)) {
      this.logger.warn(`${method} ${path} was refused (${response.status})`);
      // Kept for the caller to read the objection from, never logged.
      throw new RefusedByPlatform(response.status, await bodyOf(response));
    }

    if (!response.ok) {
      this.logger.error(`${method} ${path} answered ${response.status}`);
      throw new ServiceUnavailableException(
        response.status === 429
          ? 'The ad platform is rate-limiting this integration just now. This is a limit on the integration rather than on your ad account — nothing has changed, and it will be tried again shortly.'
          : 'The ad platform refused the request just now. Nothing has changed — try again shortly.',
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/**
 * How far back the vendor's ads backfill reaches.
 *
 * Their figure, not ours, and the reason the first sync asks for history rather
 * than starting from today: a merchant who connects on a Tuesday should not
 * have to wait a month for the page to be worth opening.
 */
const ADS_BACKFILL_DAYS = 90;

/** The most campaigns the vendor returns per page. */
const TREE_PAGE_SIZE = 100;

/**
 * A ceiling on pages read in one sync — ten thousand campaigns. Past it the
 * tree is reported incomplete rather than read forever.
 */
const MAX_TREE_PAGES = 100;

/** Larger than any ad image Meta serves; a guard, not a limit anyone meets. */
const MAX_CREATIVE_BYTES = 15 * 1024 * 1024;

/**
 * A refusal that is about one object: this ad cannot be retagged. It is not a
 * failure of the integration, and the next ad may be fine.
 */
class RefusedByPlatform extends Error {
  constructor(
    readonly status: number,
    /** The vendor's error envelope, where it sent one. */
    readonly body: RawError | null = null,
  ) {
    super(`the ad platform refused the request (${status})`);
  }
}

async function bodyOf(response: Response): Promise<RawError | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether the tags the vendor says are now on the ad carry the join we sent.
 * Only the two join parameters matter: the vendor may reorder or re-encode the
 * rest.
 */
function sameJoin(standing: string, sent: readonly ClickParam[]): boolean {
  const params = new URLSearchParams(standing.trim().replace(/^\?/, ''));
  return ['utm_campaign', 'utm_content'].every(
    (key) =>
      params.get(key)?.trim() ===
      sent.find((tag) => tag.key === key)?.value.trim(),
  );
}

/** The vendor's error envelope, as far as this file reads it. */
interface RawError {
  error?: string;
  type?: string;
  /** The request field at fault, e.g. `budgetAmount` or `creatives[1].imageUrl`. */
  param?: string;
  /** Meta's own payload, verbatim, on a `platform_error`. */
  platformError?: {
    error_user_title?: string;
    error_user_msg?: string;
    message?: string;
  } | null;
  /** On the several-creatives shape, which entry a media failure was about. */
  creativeIndex?: number;
  details?: { creativeIndex?: number } | null;
}

/** A create's answer: one ad, or several sharing a campaign. */
interface RawCreateResult {
  ad?: RawAd & { platformCampaignId?: string };
  ads?: (RawAd & { platformCampaignId?: string })[];
  platformCampaignId?: string;
}

interface RawAdAccount {
  id: string;
  name?: string | null;
  currency?: string | null;
  selectable?: boolean;
  unusableReason?: string | null;
}

interface RawMetrics {
  spend?: number | null;
  impressions?: number | null;
  /**
   * Meta's "clicks (all)": likes, image taps and profile visits as well as the
   * link. **Deliberately not read.** A conversion rate built on it is
   * meaningless and does not look wrong.
   */
  clicks?: number | null;
  /**
   * In-session link clicks — Meta's own "Link clicks" column, people the ad
   * sent to the destination. This is the figure stored as `clicks`.
   */
  inlineLinkClicks?: number | null;
  /** Meta's action counts; `link_click` is the fallback where the above is absent. */
  actions?: Record<string, number> | null;
}

interface RawSchedule {
  startDate?: string | null;
  endDate?: string | null;
}

interface RawAd {
  _id?: string;
  /** Meta's own ad id — what `{{ad.id}}` expands to. The one we key on. */
  platformAdId?: string;
  name?: string | null;
  status?: string | null;
  reviewStatus?: string | null;
  creativeType?: string | null;
  creative?: {
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
    mediaUrls?: string[] | null;
  } | null;
  schedule?: RawSchedule | null;
  daily?: ({ date?: string; day?: string } & RawMetrics)[];
}

interface RawCampaign {
  platformCampaignId?: string;
  campaignName?: string | null;
  currency?: string | null;
  /** Derived by the vendor from the campaign's ads. */
  status?: string | null;
  reviewStatus?: string | null;
  /** Meta's own `effective_status` on the campaign: ACTIVE, PAUSED, DELETED… */
  platformCampaignStatus?: string | null;
  adSets?: { ads?: RawAd[] }[];
}

/**
 * What the vendor answers a conversion upload with.
 *
 * Both counts are optional because a response that carried neither would be a
 * response that said nothing about whether the purchase landed — and the caller
 * treats "said nothing" as "did not land", which is the safe direction: an event
 * reported twice is deduplicated by the platform on its id, and one never
 * reported is a sale the platform does not know about.
 */
interface RawConversionResult {
  eventsReceived?: number;
  eventsFailed?: number;
}

interface RawTree {
  campaigns?: RawCampaign[];
  pagination?: { page?: number; pages?: number };
  backfillPending?: boolean;
}

/**
 * Why this ad account cannot be used, in the platform's own terms.
 *
 * Only the platform's objections are here. The currency rule is ours and is
 * decided against the Store, several layers up, because this file has never
 * heard of a Store's currency and should not start now.
 */
function unusableReason(account: RawAdAccount): string | null {
  if (account.unusableReason) return account.unusableReason;
  if (account.selectable === false) {
    return 'The ad platform will not let this account be used for new campaigns. Check its standing in Ads Manager.';
  }
  return null;
}

/**
 * A campaign node, with the ads of every ad set under it read as its own.
 *
 * Meta's campaign carries no schedule of its own in the tree — the flight lives
 * on the ad sets — so the campaign's is the span of its ads': the earliest
 * start, and the latest end if every ad has one. A campaign with one ad still
 * running open-ended is open-ended.
 */
function toReportedCampaign(raw: RawCampaign): ReportedCampaign {
  const ads: ReportedAd[] = [];
  for (const adSet of raw.adSets ?? []) {
    for (const ad of adSet.ads ?? []) {
      // Without Meta's own id an ad cannot be joined to a click and cannot be
      // told apart from its siblings across syncs. The vendor's document id is
      // not a substitute: `{{ad.id}}` never expands to it.
      if (!ad.platformAdId) continue;
      ads.push(toReportedAd(ad));
    }
  }

  const starts = ads
    .map((ad) => ad.signals.startsAt)
    .filter((d): d is Date => d !== null);
  const ends = ads.map((ad) => ad.signals.endsAt);
  const openEnded = ends.length === 0 || ends.some((d) => d === null);

  return {
    externalCampaignId: raw.platformCampaignId!,
    name: raw.campaignName ?? null,
    signals: {
      delivery: campaignDelivery(raw),
      review: toReview(raw.reviewStatus),
      startsAt: starts.length
        ? new Date(Math.min(...starts.map((d) => d.getTime())))
        : null,
      endsAt: openEnded
        ? null
        : new Date(Math.max(...(ends as Date[]).map((d) => d.getTime()))),
    },
    ads,
  };
}

function toReportedAd(ad: RawAd): ReportedAd {
  const days: ReportedAdDay[] = (ad.daily ?? [])
    .map((entry) => {
      const day = entry.date ?? entry.day;
      if (!day) return null;
      return {
        day,
        spend: toMinorUnits(entry.spend ?? 0),
        impressions: toCount(entry.impressions),
        clicks: toCount(linkClicks(entry)),
      } satisfies ReportedAdDay;
    })
    .filter((entry): entry is ReportedAdDay => entry !== null);

  return {
    externalAdId: ad.platformAdId!,
    name: ad.name ?? null,
    format: toFormat(ad.creativeType),
    creativeUrl: creativeUrlOf(ad),
    signals: adSignals(ad),
    days,
  };
}

/**
 * Link clicks, never "clicks (all)".
 *
 * `inlineLinkClicks` is Meta's "Link clicks" column. `actions.link_click` is
 * the same act counted on the attribution window, and is the fallback where the
 * first is absent. The vendor's bare `clicks` is not a fallback at any depth.
 */
function linkClicks(metrics: RawMetrics): number | null {
  return metrics.inlineLinkClicks ?? metrics.actions?.link_click ?? null;
}

function adSignals(ad: RawAd): PlatformSignals {
  return {
    delivery: toDelivery(ad.status),
    review: toReview(ad.reviewStatus),
    startsAt: toDate(ad.schedule?.startDate),
    endsAt: toDate(ad.schedule?.endDate),
  };
}

/**
 * A campaign's delivery, preferring Meta's own word for a deleted one.
 *
 * The vendor derives a campaign's `status` from its ads, so a campaign deleted
 * in Ads Manager whose ads the vendor has not yet marked would still read as
 * whatever they last were. Meta's `effective_status` on the campaign itself is
 * authoritative about deletion and archiving, and about a pause at campaign
 * level.
 */
function campaignDelivery(raw: RawCampaign): DeliverySignal {
  switch (raw.platformCampaignStatus?.toUpperCase()) {
    case 'DELETED':
    case 'ARCHIVED':
      return 'deleted';
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
      return 'paused';
    default:
      return toDelivery(raw.status);
  }
}

/**
 * The vendor's delivery status in our spelling.
 *
 * `cancelled` is how the vendor records a deleted ad or campaign — a soft
 * delete that keeps its history, which is what `deleted` means here too. An
 * unrecognised value is treated as `error` rather than `active`: an ad we cannot
 * read is one a merchant should look at, not one we should say is fine.
 */
function toDelivery(status: string | null | undefined): DeliverySignal {
  switch (status) {
    case 'active':
    case 'paused':
    case 'pending_review':
    case 'rejected':
    case 'completed':
    case 'error':
      return status;
    case 'cancelled':
      return 'deleted';
    default:
      return 'error';
  }
}

function toReview(status: string | null | undefined): ReviewSignal | null {
  switch (status) {
    case 'in_review':
    case 'approved':
    case 'rejected':
    case 'with_issues':
      return status;
    default:
      return null;
  }
}

/** A document-format creative is a LinkedIn format, and has no place here. */
function toFormat(type: string | null | undefined): ReportedAdFormat | null {
  return type === 'image' || type === 'video' || type === 'carousel'
    ? type
    : null;
}

/**
 * The picture an ad is recognised by.
 *
 * The full-size image first. A carousel's first card after that, and the
 * thumbnail last — it is the poster frame of a video ad, and for an ad Meta's
 * moderation stripped it can be all that is left, at 64 pixels square.
 */
function creativeUrlOf(ad: RawAd): string | null {
  const creative = ad.creative;
  return (
    creative?.imageUrl ||
    creative?.mediaUrls?.find(Boolean) ||
    creative?.thumbnailUrl ||
    null
  );
}

/** How the vendor spells a button. */
const CALL_TO_ACTION: Record<CallToAction, string> = {
  shop_now: 'SHOP_NOW',
  buy_now: 'BUY_NOW',
  order_now: 'ORDER_NOW',
  get_offer: 'GET_OFFER',
  learn_more: 'LEARN_MORE',
  sign_up: 'SIGN_UP',
  subscribe: 'SUBSCRIBE',
};

/**
 * Everything about a create that is not an ad: the same for the dry run and the
 * real thing, so the dry run checks what will actually be sent.
 */
function campaignBody(input: CampaignDraftInput): Record<string, unknown> {
  const { draft } = input;
  return {
    accountId: input.providerAccountRef,
    adAccountId: input.externalAccountId,
    name: draft.name,
    campaignName: draft.name,
    // Sales, optimised for purchases the Pixel sees.
    goal: 'conversions',
    promotedObject: { pixelId: draft.pixelId, customEventType: 'PURCHASE' },
    // One budget, on the campaign.
    budgetLevel: 'campaign',
    budgetType: 'daily',
    budgetAmount: toDecimalAmount(draft.dailyBudget),
    currency: draft.currency,
    status: draft.launch === 'paused' ? 'PAUSED' : 'ACTIVE',
    countries: [...draft.countries],
    ageMin: draft.ageMin,
    ageMax: draft.ageMax,
    ...(draft.startsAt ? { startDate: draft.startsAt.toISOString() } : {}),
    ...(draft.endsAt ? { endDate: draft.endsAt.toISOString() } : {}),
    tracking: {
      pixelId: draft.pixelId,
      // Sent decoded. The vendor passes `{{…}}` through for Meta to expand and
      // encodes everything else.
      urlTags: draft.linkTags.map(({ key, value }) => ({ key, value })),
    },
  };
}

/** One ad's creative fields, as both the single and several shapes take them. */
function singleCreative(ad: AdDraft): Record<string, unknown> {
  return {
    headline: ad.headline,
    body: ad.primaryText,
    callToAction: CALL_TO_ACTION[ad.callToAction],
    linkUrl: ad.destinationUrl,
    ...(ad.media.kind === 'image'
      ? { imageUrl: ad.media.url }
      : { video: { url: ad.media.url } }),
  };
}

/** Where on the form a vendor field belongs. */
const FIELD_OF: Record<string, DraftField> = {
  name: 'name',
  campaignName: 'name',
  adName: 'name',
  budgetAmount: 'dailyBudget',
  budgetType: 'dailyBudget',
  currency: 'dailyBudget',
  startDate: 'schedule',
  endDate: 'schedule',
  countries: 'audience',
  ageMin: 'audience',
  ageMax: 'audience',
  targeting: 'audience',
  imageUrl: 'media',
  video: 'media',
  body: 'primaryText',
  headline: 'headline',
  callToAction: 'callToAction',
  linkUrl: 'destination',
};

const AD_FIELDS = new Set<DraftField>([
  'media',
  'primaryText',
  'headline',
  'callToAction',
  'destination',
]);

/**
 * What the vendor objected to, as complaints for the form.
 *
 * Meta's own sentence where it sent one: `error_user_msg` is written for the
 * person who made the ad, and it is what names a budget minimum or an image
 * size. The vendor's sentence otherwise.
 *
 * `adIndex` is the ad the request was about, for a dry run of one ad. For the
 * several-ads create, the ad is read from the field (`creatives[2].imageUrl`)
 * or from the index the vendor reports.
 */
function complaintsFrom(
  body: RawError | null,
  adIndex: number | null,
): DraftComplaint[] {
  const platform = body?.platformError;
  const message =
    platform?.error_user_msg?.trim() ||
    platform?.error_user_title?.trim() ||
    body?.error?.trim() ||
    'Meta did not accept this campaign.';

  const param = body?.param ?? '';
  const nested = /^creatives[[.](\d+)\]?\.?(\w+)/.exec(param);
  const field =
    FIELD_OF[nested ? nested[2] : (param.split(/[.[]/)[0] ?? '')] ?? null;
  const index =
    (nested ? Number(nested[1]) : null) ??
    body?.creativeIndex ??
    body?.details?.creativeIndex ??
    adIndex;

  return [
    {
      // A campaign field is about the campaign, whichever ad was being checked.
      adIndex: field && !AD_FIELDS.has(field) ? null : index,
      field,
      message,
    },
  ];
}

/**
 * One complaint per thing wrong.
 *
 * The dry run checks each ad as a campaign of its own, so a problem with the
 * campaign comes back once per ad. A complaint that every checked ad produced
 * is about the campaign, and it is reported once without an ad. The same goes
 * for a campaign complaint repeated verbatim.
 */
function settleComplaints(
  found: readonly DraftComplaint[],
  checkedCount: number,
): DraftComplaint[] {
  const byText = new Map<string, DraftComplaint[]>();
  for (const complaint of found) {
    const key = `${complaint.field ?? ''}|${complaint.message}`;
    byText.set(key, [...(byText.get(key) ?? []), complaint]);
  }

  const settled: DraftComplaint[] = [];
  for (const group of byText.values()) {
    const ads = new Set(group.map((c) => c.adIndex));
    const campaignWide =
      ads.has(null) || (checkedCount > 1 && ads.size >= checkedCount);
    if (campaignWide) {
      settled.push({ ...group[0], adIndex: null });
    } else {
      settled.push(...[...ads].map((adIndex) => ({ ...group[0], adIndex })));
    }
  }
  return settled;
}

function isPlatformError(body: RawError | null): boolean {
  return body?.type === 'platform_error' || Boolean(body?.platformError);
}

/**
 * A new campaign's delivery, from its ads'. In review while any ad is, which on
 * a fresh create is all of them.
 */
function createdDelivery(ads: readonly CreatedAd[]): DeliverySignal {
  if (ads.some((ad) => ad.signals.delivery === 'pending_review')) {
    return 'pending_review';
  }
  if (ads.some((ad) => ad.signals.delivery === 'active')) return 'active';
  return ads[0]?.signals.delivery ?? 'pending_review';
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
