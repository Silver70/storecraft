import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdPlatform,
  AdPlatformConnection,
} from '../../../shared/database/schema';
import { StoreService } from '../../tenant/services/store.service';
import {
  AD_PLATFORM_PROVIDER,
  type AdPlatformProvider,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import { AdPlatformConnectionRepository } from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import { CredentialVault } from './credential-vault.service';
import {
  HANDOFF_TTL_MS,
  isSafeReturnPath,
  signHandoff,
  verifyHandoff,
  type ConnectionHandoff,
} from '../utils/connection-handoff.util';

/**
 * What a merchant is allowed to see about a connection.
 *
 * Built field by field and never spread from the row, so that adding a column
 * is never accidentally publishing one. There is no credential here and there
 * is no shape this type could take that would carry one.
 */
export interface AdPlatformConnectionView {
  id: string;
  platform: AdPlatform;
  status: AdPlatformConnection['status'];
  /** The ad account the merchant picked on the platform's own screen. */
  accountId: string;
  accountName: string | null;
  /** May differ from the Store's currency. Recorded, never converted. */
  accountCurrency: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
}

/** How a return trip ended, as the admin page needs to read it. */
export type ConnectionOutcome =
  | { kind: 'connected'; platform: AdPlatform; returnPath: string }
  | { kind: 'not_approved'; platform: AdPlatform; returnPath: string }
  | { kind: 'failed'; platform: AdPlatform | null; returnPath: string };

/** Where a merchant lands if a return trip arrives with nothing readable on it. */
const FALLBACK_RETURN_PATH = '/admin/settings?section=ad-platforms';

@Injectable()
export class AdPlatformConnectionService {
  private readonly logger = new Logger(AdPlatformConnectionService.name);

  constructor(
    @Inject(AD_PLATFORM_PROVIDER)
    private readonly provider: AdPlatformProvider,
    private readonly connections: AdPlatformConnectionRepository,
    private readonly credentials: AdPlatformCredentialRepository,
    private readonly vault: CredentialVault,
    private readonly stores: StoreService,
    private readonly config: ConfigService,
  ) {}

  async list(
    orgId: string,
    storeId: string,
  ): Promise<AdPlatformConnectionView[]> {
    const rows = await this.connections.findMany(orgId, storeId);
    return rows.map(toView);
  }

  /**
   * Starts a connection and hands back the platform's own approval link.
   *
   * Nothing is recorded yet. A merchant who never finishes leaves no connection
   * behind — the row is written when the platform says what was approved, not
   * when we ask.
   */
  async begin(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
    returnPath: string | undefined,
  ): Promise<{ approvalUrl: string }> {
    const store = await this.stores.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');

    const credential = await this.reachingProvider(() =>
      this.ensureCredential(orgId, storeId, store.name),
    );

    const handoff: ConnectionHandoff = {
      organizationId: orgId,
      storeId,
      platform,
      returnPath:
        returnPath && isSafeReturnPath(returnPath)
          ? returnPath
          : FALLBACK_RETURN_PATH,
      expiresAt: Date.now() + HANDOFF_TTL_MS,
    };

    const callback = new URL('/api/ad-platforms/callback', this.apiBaseUrl());
    callback.searchParams.set(
      'state',
      signHandoff(handoff, this.vault.handoffKey()),
    );

    return this.reachingProvider(() =>
      this.provider.beginConnection({
        credential,
        platform,
        returnUrl: callback.toString(),
      }),
    );
  }

  /**
   * Reads a return trip and records what was approved.
   *
   * Never throws. The merchant is arriving in a browser from a third party, and
   * every way this can go wrong — a stale note, a denied approval, the provider
   * being down — has to end at a page in the admin that says what happened.
   * Throwing here would hand a merchant a JSON error body at a URL they cannot
   * navigate away from meaningfully.
   */
  async complete(
    state: string | undefined,
    callbackParams: Record<string, string>,
  ): Promise<ConnectionOutcome> {
    let handoff: ConnectionHandoff;
    try {
      handoff = verifyHandoff(state ?? '', this.vault.handoffKey());
    } catch (error) {
      this.logger.warn(
        `Ad platform return trip could not be read: ${messageOf(error)}`,
      );
      return {
        kind: 'failed',
        platform: null,
        returnPath: FALLBACK_RETURN_PATH,
      };
    }

    const { organizationId, storeId, platform, returnPath } = handoff;

    try {
      const row = await this.credentials.findByStore(organizationId, storeId);
      if (!row?.sealedSecret) {
        // The credential was revoked between starting and finishing — there is
        // nothing to ask the provider with.
        return { kind: 'not_approved', platform, returnPath };
      }

      const account = await this.provider.completeConnection({
        credential: {
          providerRef: row.providerRef,
          secret: this.vault.open(row.sealedSecret),
        },
        platform,
        callbackParams,
      });

      if (!account) return { kind: 'not_approved', platform, returnPath };

      await this.connections.upsertConnected(
        organizationId,
        storeId,
        platform,
        {
          externalAccountId: account.externalAccountId,
          accountName: account.accountName,
          accountCurrency: account.currency,
        },
      );

      return { kind: 'connected', platform, returnPath };
    } catch (error) {
      this.logger.error(
        `Completing a ${platform} connection failed: ${messageOf(error)}`,
      );
      return { kind: 'failed', platform, returnPath };
    }
  }

  /**
   * Revokes access and keeps everything it produced.
   *
   * The connection is marked disconnected rather than deleted, so figures
   * already pulled still point at the connection that produced them. Their
   * survival is the whole promise of this operation: a merchant revoking access
   * is not asking us to rewrite last month's report.
   */
  async disconnect(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<AdPlatformConnectionView> {
    const existing = await this.connections.findByPlatform(
      orgId,
      storeId,
      platform,
    );
    if (!existing) throw new NotFoundException('Connection not found');
    if (existing.status === 'disconnected') return toView(existing);

    const row = await this.connections.markDisconnected(
      orgId,
      storeId,
      platform,
    );
    if (!row) throw new NotFoundException('Connection not found');

    await this.releaseAtProvider(orgId, storeId, platform);
    return toView(row);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * The Store's credential, issued on first use.
   *
   * One per Store and never one per Organization: a US store and a UK store
   * must not reach one ad account through one key, and the provider's own
   * posting surface accepts whatever account id its holder can name regardless
   * of which scope the key belongs to. The narrowest credential they will issue
   * is the one we ask for.
   */
  private async ensureCredential(
    orgId: string,
    storeId: string,
    storeName: string,
  ): Promise<StoreCredential> {
    const existing = await this.credentials.findByStore(orgId, storeId);
    if (existing?.sealedSecret) {
      return {
        providerRef: existing.providerRef,
        secret: this.vault.open(existing.sealedSecret),
      };
    }

    const issued = await this.provider.issueStoreCredential({
      storeId,
      storeName,
    });
    await this.credentials.upsert(
      orgId,
      storeId,
      issued.providerRef,
      this.vault.seal(issued.secret),
    );
    return issued;
  }

  /**
   * Tells the provider to let go, and destroys our copy of the secret once the
   * Store's last connection is gone.
   *
   * A provider that cannot be reached does not block the merchant: their
   * connection is already stopped here, and the credential is destroyed
   * regardless, because a key we are no longer entitled to use is not one to
   * keep. What is left behind in that case is a dangling scope on the vendor's
   * side, which is logged.
   */
  private async releaseAtProvider(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<void> {
    const row = await this.credentials.findByStore(orgId, storeId);
    if (!row?.sealedSecret) return;

    const credential: StoreCredential = {
      providerRef: row.providerRef,
      secret: this.vault.open(row.sealedSecret),
    };
    const lastOne = !(await this.connections.hasOtherConnected(
      orgId,
      storeId,
      platform,
    ));

    try {
      await this.provider.disconnect(credential, platform);
      if (lastOne) await this.provider.revokeStoreCredential(credential);
    } catch (error) {
      this.logger.error(
        `Releasing ${platform} at the ad platform failed for store ${storeId}: ${messageOf(error)}`,
      );
    }

    if (lastOne) await this.credentials.revoke(orgId, storeId);
  }

  /**
   * Runs a call that reaches the ad platform, and turns whatever it throws into
   * an answer a merchant can act on.
   *
   * The failure a merchant is most likely to hit is not their own: upstream
   * quotas on some platforms are shared across every customer of the provider
   * and cannot be bought out of, so a refusal here frequently has nothing to do
   * with this Organization. The message must not say otherwise, and a vendor's
   * stack trace must not become a 500 on a button the merchant just pressed.
   */
  private async reachingProvider<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Ad platform call failed: ${messageOf(error)}`);
      throw new ServiceUnavailableException(
        'The ad platform could not be reached just now. Nothing has changed — try again shortly.',
      );
    }
  }

  /** Where the merchant lands, as an absolute URL in the admin. */
  returnUrlFor(outcome: ConnectionOutcome): string {
    const url = new URL(outcome.returnPath, this.adminBaseUrl());
    if (outcome.platform) {
      url.searchParams.set('ad_platform', outcome.platform);
    }
    url.searchParams.set('ad_platform_result', outcome.kind);
    return url.toString();
  }

  private adminBaseUrl(): string {
    return this.config.get<string>('ADMIN_URL', 'http://localhost:3000');
  }

  private apiBaseUrl(): string {
    return this.config.get<string>('API_PUBLIC_URL', 'http://localhost:4000');
  }
}

function toView(row: AdPlatformConnection): AdPlatformConnectionView {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    accountId: row.externalAccountId,
    accountName: row.accountName,
    accountCurrency: row.accountCurrency,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
