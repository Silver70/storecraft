import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdPlatform } from '../../../shared/database/schema';
import type {
  AdPlatformProvider,
  AdTree,
  BeginConnectionInput,
  BeginConnectionResult,
  CompleteConnectionInput,
  ConnectedAccount,
  FetchAdTreeInput,
  IssueCredentialInput,
  ProviderHealth,
  ReportedAd,
  ReportedAdDay,
  StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import {
  toBasisPoints,
  toCount,
  toMinorUnits,
} from '../utils/reported-money.util';

/**
 * Ayrshare, behind `AdPlatformProvider`.
 *
 * **This file is the only place in the codebase that knows the vendor's name.**
 * Everything above it — the service, the repository, the controllers, the
 * tables, the domain types — is written against the interface, so replacing
 * this vendor is deleting this file and writing another one. That is the entire
 * premise of the stage: the research behind it found a capable API and an
 * eight-person company whose ads product is months old, and the design
 * assumption is not that they will fail but that we should not much care if
 * they do.
 *
 * Two of their behaviours are load-bearing above and are named here so a reader
 * of this file knows why the seam is shaped as it is:
 *
 * 1. A *profile* is their per-tenant scope, and a *profile key* is a credential
 *    scoped to one. Their posting surface accepts whatever account id the
 *    holding team owns regardless of profile, so one key per Store is a
 *    boundary we impose rather than one they enforce.
 * 2. Account linking happens on their hosted page, which in turn sends the
 *    merchant to the platform's own approval screen. We never see the
 *    merchant's platform credentials, and we build no account picker.
 *
 * Nothing here writes to an ad. There is no method to write with.
 */

const API_BASE = 'https://api.ayrshare.com/api';

/**
 * Our platform names to theirs. The whole reason a mapping exists in this file
 * rather than in the enum is that the enum is ours and this spelling is not.
 */
const VENDOR_PLATFORM: Record<AdPlatform, string> = {
  meta: 'facebook',
  google: 'googleads',
  tiktok: 'tiktok',
  linkedin: 'linkedin',
  pinterest: 'pinterest',
  x: 'twitter',
};

interface CreateProfileResponse {
  profileKey?: string;
  refId?: string;
}

interface GenerateJwtResponse {
  url?: string;
}

interface AdAccountSummary {
  platform?: string;
  id?: string;
  accountId?: string;
  name?: string;
  currency?: string;
}

interface UserResponse {
  adAccounts?: AdAccountSummary[];
  activeSocialAccounts?: string[];
}

/**
 * What each platform will report about the past, in days.
 *
 * The vendor passes these limits through from the platforms themselves, so
 * they belong in this file with the rest of what is true about whoever is
 * behind the interface. They are the floor of what day one can show: a first
 * connection asks for this much history, and a request past it returns nothing
 * extra while spending a shared quota to find that out.
 */
const PLATFORM_RETENTION_DAYS: Record<AdPlatform, number> = {
  meta: 365,
  google: 365,
  tiktok: 365,
  linkedin: 365,
  pinterest: 90,
  x: 90,
};

/**
 * Their reporting payload. Every money field here is a decimal and every one
 * of them is converted before it leaves this file.
 */
interface AdMetricsResponse {
  currency?: string;
  ads?: VendorAd[];
}

interface VendorAd {
  id?: string;
  adId?: string;
  name?: string;
  daily?: VendorAdDay[];
}

interface VendorAdDay {
  date?: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  revenue?: number;
  roas?: number;
}

@Injectable()
export class AyrshareAdapter implements AdPlatformProvider {
  private readonly logger = new Logger(AyrshareAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async issueStoreCredential(
    input: IssueCredentialInput,
  ): Promise<StoreCredential> {
    const body = await this.call<CreateProfileResponse>(
      'POST',
      '/profiles/profile',
      // The Store id rides along in the title so a profile found in their
      // dashboard can be traced back to one Store of one Organization.
      { title: `${input.storeName} (${input.storeId})` },
      this.accountKey(),
    );

    if (!body.profileKey || !body.refId) {
      throw new ServiceUnavailableException(
        'The ad platform did not return a credential for this store.',
      );
    }

    return { providerRef: body.refId, secret: body.profileKey };
  }

  async beginConnection(
    input: BeginConnectionInput,
  ): Promise<BeginConnectionResult> {
    const body = await this.call<GenerateJwtResponse>(
      'POST',
      '/profiles/generateJWT',
      {
        domain: this.required('AD_PLATFORM_LINK_DOMAIN'),
        privateKey: this.required('AD_PLATFORM_LINK_PRIVATE_KEY'),
        profileKey: input.credential.secret,
        redirect: input.returnUrl,
        // Their hosted page can be pinned to one platform, which keeps the
        // merchant on the screen they asked for instead of a full account list.
        allowedSocial: [VENDOR_PLATFORM[input.platform]],
      },
      this.accountKey(),
    );

    if (!body.url) {
      throw new ServiceUnavailableException(
        'The ad platform did not return an approval link.',
      );
    }
    return { approvalUrl: body.url };
  }

  /**
   * Their hosted page redirects the merchant back with no account details on
   * it, so what was approved is read from the profile rather than from the
   * query string. A merchant who denied or closed the tab leaves nothing
   * linked, which reads as `null` and is a normal answer.
   */
  async completeConnection(
    input: CompleteConnectionInput,
  ): Promise<ConnectedAccount | null> {
    const body = await this.call<UserResponse>(
      'GET',
      '/user',
      undefined,
      input.credential.secret,
    );

    const wanted = VENDOR_PLATFORM[input.platform];
    const account = (body.adAccounts ?? []).find(
      (candidate) => candidate.platform === wanted,
    );
    const externalAccountId = account?.accountId ?? account?.id;
    if (!externalAccountId) return null;

    return {
      externalAccountId,
      accountName: account?.name ?? null,
      currency: account?.currency ?? null,
    };
  }

  async disconnect(
    credential: StoreCredential,
    platform: AdPlatform,
  ): Promise<void> {
    await this.call(
      'DELETE',
      '/profiles/social',
      { platform: VENDOR_PLATFORM[platform] },
      credential.secret,
    );
  }

  async revokeStoreCredential(credential: StoreCredential): Promise<void> {
    await this.call(
      'DELETE',
      '/profiles/profile',
      { profileKey: credential.secret },
      this.accountKey(),
    );
  }

  /**
   * What the platform says each of its ads did, per day, over a range.
   *
   * A read and only a read: their reporting endpoint takes an account and two
   * dates and returns figures. Nothing about this call can change an ad, and
   * there is no call here that could.
   *
   * **Every decimal they report stops being a decimal in this method.** Spend
   * and revenue are converted to minor units and ROAS to basis points before
   * anything leaves the adapter, because this is the edge — the one place in
   * the codebase where a float about money legitimately exists.
   */
  async fetchAdTree(input: FetchAdTreeInput): Promise<AdTree> {
    const query = new URLSearchParams({
      platform: VENDOR_PLATFORM[input.platform],
      accountId: input.externalAccountId,
      startDate: input.from,
      endDate: input.to,
    });

    const body = await this.call<AdMetricsResponse>(
      'GET',
      `/analytics/ads?${query.toString()}`,
      undefined,
      input.credential.secret,
    );

    const currency = body.currency?.trim().toUpperCase();
    if (!currency || currency.length !== 3) {
      // Without the ad account's currency there is nothing honest to store a
      // figure as. The Store's currency is not a substitute — assuming it is
      // the conversion ADR-0005 forbids, done by omission.
      throw new ServiceUnavailableException(
        'The ad platform reported figures without saying what currency the ad account bills in.',
      );
    }

    return {
      currency,
      ads: (body.ads ?? [])
        .map((ad) => this.asReportedAd(ad))
        .filter((ad): ad is ReportedAd => ad !== null),
    };
  }

  /**
   * Whether they are answering, and how far back this platform reports.
   *
   * `/user` is their cheapest authenticated call, which is the point: this is
   * asked before a backfill to size it, not on every sync to feel reassured. An
   * unreachable provider is an answer here rather than a throw — the caller
   * records it and shows the merchant the figures it already has.
   */
  async health(platform: AdPlatform): Promise<ProviderHealth> {
    const maxBackfillDays = PLATFORM_RETENTION_DAYS[platform];
    try {
      await this.call<UserResponse>(
        'GET',
        '/user',
        undefined,
        this.accountKey(),
      );
      return { reachable: true, maxBackfillDays };
    } catch {
      return { reachable: false, maxBackfillDays };
    }
  }

  /**
   * One of their ads as a `ReportedAd`, or null if it has no id.
   *
   * An ad with no id at the platform cannot be stored: the platform's ad id is
   * the key a figure is held under and the key a merchant's claim will later
   * match on. Dropping it is better than inventing one, which would create a
   * row nothing could ever be reconciled against.
   */
  private asReportedAd(ad: VendorAd): ReportedAd | null {
    const externalAdId = ad.adId ?? ad.id;
    if (!externalAdId) return null;

    return {
      externalAdId,
      name: ad.name ?? null,
      days: (ad.daily ?? [])
        .map((day) => this.asReportedDay(day))
        .filter((day): day is ReportedAdDay => day !== null),
    };
  }

  /** One day of theirs, with every decimal on it turned into an integer. */
  private asReportedDay(day: VendorAdDay): ReportedAdDay | null {
    const date = day.date?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

    return {
      day: date,
      spend: toMinorUnits(day.spend ?? 0),
      impressions: toCount(day.impressions),
      clicks: toCount(day.clicks),
      conversions: toCount(day.conversions),
      reportedRevenue: toMinorUnits(day.revenue ?? 0),
      reportedRoasBp: toBasisPoints(day.roas ?? null),
    };
  }

  // ─── Transport ──────────────────────────────────────────────────────────────

  private accountKey(): string {
    return this.required('AD_PLATFORM_API_KEY');
  }

  private required(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) {
      throw new ServiceUnavailableException(
        `Ad platform integration is not configured on this deployment (${name} is not set).`,
      );
    }
    return value;
  }

  /**
   * One transport for every call, so there is exactly one place that could log
   * a credential — and does not. The bearer token is a secret on every call
   * here; nothing about the request is logged but its method, path and status.
   */
  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: Record<string, unknown> | undefined,
    bearer: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // Their outage, not the merchant's account — and the message a merchant
      // eventually reads must not blame them for it.
      throw new ServiceUnavailableException(
        'The ad platform could not be reached. Nothing has changed; try again shortly.',
      );
    }

    if (!response.ok) {
      this.logger.warn(
        `Ad platform ${method} ${path} responded ${response.status}`,
      );
      throw new ServiceUnavailableException(
        response.status === 429
          ? 'The ad platform is rate limiting requests right now. This is a limit on the integration, not on your account — try again shortly.'
          : 'The ad platform refused the request. Nothing has changed.',
      );
    }

    return (await response.json()) as T;
  }
}
