import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdPlatform } from '../../../shared/database/schema';
import type {
  AdAccountOption,
  AdPlatformProvider,
  AdTree,
  BeginConnectionInput,
  BeginConnectionResult,
  CompleteConnectionInput,
  ConnectionGrant,
  EnsurePixelInput,
  FetchAdTreeInput,
  GrantedAccount,
  IssueCredentialInput,
  ProviderHealth,
  ReportedAd,
  ReportedAdDay,
  SendPurchaseInput,
  StoreCredential,
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
   */
  async fetchAdTree(input: FetchAdTreeInput): Promise<AdTree> {
    this.connectPlatform(input.platform);

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
        },
      },
    );

    const ads: ReportedAd[] = [];
    for (const campaign of tree.campaigns ?? []) {
      for (const adSet of campaign.adSets ?? []) {
        for (const ad of adSet.ads ?? []) {
          ads.push(toReportedAd(ad));
        }
      }
    }

    return {
      currency: tree.campaigns?.[0]?.currency ?? 'USD',
      ads,
    };
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
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string>;
      body?: unknown;
      /** Status codes that mean "already done", not "failed". */
      tolerate?: number[];
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
  clicks?: number | null;
}

interface RawAd {
  _id?: string;
  platformAdId?: string;
  name?: string | null;
  creativeUrl?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  metrics?: RawMetrics;
  daily?: ({ date?: string; day?: string } & RawMetrics)[];
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
  campaigns?: {
    currency?: string;
    adSets?: { ads?: RawAd[] }[];
  }[];
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

function toReportedAd(ad: RawAd): ReportedAd {
  const days: ReportedAdDay[] = (ad.daily ?? [])
    .map((entry) => {
      const day = entry.date ?? entry.day;
      if (!day) return null;
      return {
        day,
        spend: toMinorUnits(entry.spend ?? 0),
        impressions: toCount(entry.impressions),
        clicks: toCount(entry.clicks),
      } satisfies ReportedAdDay;
    })
    .filter((entry): entry is ReportedAdDay => entry !== null);

  return {
    externalAdId: ad.platformAdId ?? ad._id ?? '',
    name: ad.name ?? null,
    creativeUrl: ad.creativeUrl ?? null,
    startsAt: toDate(ad.startTime),
    endsAt: toDate(ad.endTime),
    days,
  };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
