import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdPlatform } from '../../../shared/database/schema';
import type {
  AdPlatformProvider,
  BeginConnectionInput,
  BeginConnectionResult,
  CompleteConnectionInput,
  ConnectedAccount,
  IssueCredentialInput,
  StoreCredential,
} from '../interfaces/ad-platform-provider.interface';

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
