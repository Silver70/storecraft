import {
  BadRequestException,
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
  type AdAccountOption,
  type AdPlatformProvider,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import { AdPlatformConnectionRepository } from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import { CredentialVault } from './credential-vault.service';
import { AdPlatformSyncService } from './ad-platform-sync.service';
import { currencyRefusal } from '../utils/account-currency.util';
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
  /**
   * The ad account the merchant picked, or null while they have approved at
   * the platform but not yet chosen which account this Store reports against.
   */
  accountId: string | null;
  accountName: string | null;
  /**
   * The ad account's currency. On a connected account it is the Store's — the
   * selection refuses any other — and it is kept so the check is readable
   * afterwards rather than only having happened.
   */
  accountCurrency: string | null;
  /**
   * The ad account's pixel, found or created when the account was chosen. Not
   * a secret: it is embedded in the storefront's own pages.
   */
  pixelId: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
  /**
   * When a sync last succeeded, or null if none ever has.
   *
   * On the connection view because it is the merchant's answer to "how current
   * is this number" — a figure that stopped moving because nothing was spent
   * and one that stopped moving because the sync stopped running look
   * identical without it. A stale figure has to be legibly stale.
   */
  lastSyncedAt: Date | null;
  lastSyncAttemptAt: Date | null;
  /**
   * Why the last attempt failed, or null after a success.
   *
   * Surfaced rather than thrown. A vendor outage costs freshness, not the
   * dashboard: the page shows the figures already pulled and this sentence
   * beside them, and the sentence never blames the merchant's own account.
   */
  lastSyncError: string | null;
  /** When the schedule will try again, while a failure is being backed off. */
  syncPausedUntil: Date | null;
}

/**
 * One ad account as the picker renders it.
 *
 * A refused account is listed, disabled, with the reason — never omitted. An
 * account missing from the list is a merchant wondering whether they approved
 * with the wrong login, and going back through the platform to find out.
 */
export interface AdAccountChoice {
  accountId: string;
  name: string | null;
  currency: string | null;
  selectable: boolean;
  /** Why it cannot be picked, or null when it can. */
  reason: string | null;
}

/** How a return trip ended, as the admin page needs to read it. */
export type ConnectionOutcome =
  | { kind: 'connected'; platform: AdPlatform; returnPath: string }
  | { kind: 'choose_account'; platform: AdPlatform; returnPath: string }
  | { kind: 'not_approved'; platform: AdPlatform; returnPath: string }
  | { kind: 'failed'; platform: AdPlatform | null; returnPath: string };

/** Where a merchant lands if a return trip arrives with nothing readable on it. */
const FALLBACK_RETURN_PATH = '/admin/campaigns';

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
    private readonly sync: AdPlatformSyncService,
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
   *
   * What the platform granted is access, not an ad account: it has no idea this
   * Store exists and cannot be asked which of the merchant's accounts should
   * report against it. So the grant is recorded and the merchant is sent to the
   * picker — unless there is exactly one account they can use, in which case
   * asking would be a question with one answer.
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
      const credential = await this.openCredential(organizationId, storeId);
      if (!credential) {
        // The credential was revoked between starting and finishing — there is
        // nothing to ask the provider with.
        return { kind: 'not_approved', platform, returnPath };
      }

      const grant = await this.provider.completeConnection({
        credential,
        platform,
        callbackParams,
      });

      if (!grant) return { kind: 'not_approved', platform, returnPath };

      await this.connections.upsertGrant(
        organizationId,
        storeId,
        platform,
        grant.providerAccountRef,
      );

      const settled = await this.settleSingleAccount(
        organizationId,
        storeId,
        platform,
      );
      return {
        kind: settled ? 'connected' : 'choose_account',
        platform,
        returnPath,
      };
    } catch (error) {
      this.logger.error(
        `Completing a ${platform} connection failed: ${messageOf(error)}`,
      );
      return { kind: 'failed', platform, returnPath };
    }
  }

  /**
   * The ad accounts this Store's grant can see, each already judged.
   *
   * Asked of the platform every time rather than cached: an ad account's
   * standing is the platform's to change, and a picker offering an account that
   * was closed this morning sends a merchant to a failure instead of to a
   * reason.
   */
  async adAccounts(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<AdAccountChoice[]> {
    const { store, connection, credential } = await this.grantFor(
      orgId,
      storeId,
      platform,
    );

    const options = await this.reachingProvider(() =>
      this.provider.listAdAccounts({
        credential,
        platform,
        providerAccountRef: connection.providerAccountRef!,
      }),
    );

    return options.map((option) => toChoice(option, store.currency));
  }

  /**
   * Records which ad account this Store reports against, and finds its pixel.
   *
   * The currency check happens here and not only in the picker, because the
   * picker is a suggestion and this is the door. A mismatched account refused
   * on screen and accepted by a hand-made request would put spend in one
   * currency beside revenue in another, and every ROAS on the page would be
   * wrong by a rate nobody chose — silently, because nothing would look broken.
   */
  async selectAccount(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
    externalAccountId: string,
  ): Promise<AdPlatformConnectionView> {
    const { store, connection, credential } = await this.grantFor(
      orgId,
      storeId,
      platform,
    );
    const providerAccountRef = connection.providerAccountRef!;

    const options = await this.reachingProvider(() =>
      this.provider.listAdAccounts({
        credential,
        platform,
        providerAccountRef,
      }),
    );

    const chosen = options.find(
      (option) => option.externalAccountId === externalAccountId,
    );
    if (!chosen) {
      throw new NotFoundException(
        'That ad account is not one this connection can reach. It may have been removed since you approved.',
      );
    }

    const refusal = toChoice(chosen, store.currency).reason;
    if (refusal) throw new BadRequestException(refusal);

    const pixelId = await this.reachingProvider(() =>
      this.provider.ensurePixel({
        credential,
        platform,
        providerAccountRef,
        externalAccountId: chosen.externalAccountId,
        storeName: store.name,
      }),
    );

    const row = await this.connections.markConnected(orgId, storeId, platform, {
      externalAccountId: chosen.externalAccountId,
      accountName: chosen.name,
      accountCurrency: chosen.currency,
      pixelId,
    });
    if (!row) throw new NotFoundException('Connection not found');

    return toView(await this.backfill(orgId, storeId, platform, row));
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

    await this.releaseAtProvider(
      orgId,
      storeId,
      platform,
      existing.providerAccountRef,
    );
    return toView(row);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * Runs the first sync as part of connecting, so the page is worth reading the
   * moment the merchant lands back on it rather than an hour later.
   *
   * A connection that has synced before — a reconnect to the same account —
   * gets an ordinary trailing sync from the same call; the sync decides which
   * it owes. It is awaited rather than detached so the connection the merchant
   * is shown already carries its figures and its freshness, and it cannot fail
   * the connect: the sync reports rather than throws, and anything that
   * escapes it is logged and left to the hourly job. The connection stands
   * either way.
   */
  private async backfill(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
    connected: AdPlatformConnection,
  ): Promise<AdPlatformConnection> {
    try {
      await this.sync.syncStore(orgId, storeId, platform);
      return (
        (await this.connections.findByPlatform(orgId, storeId, platform)) ??
        connected
      );
    } catch (error) {
      this.logger.error(
        `The first ${platform} sync for store ${storeId} could not run; the hourly sync will pick it up: ${messageOf(error)}`,
      );
      return connected;
    }
  }

  /**
   * Connects without asking when there is nothing to ask.
   *
   * One usable ad account is not a choice, and a picker with a single row on it
   * is a step that exists only because the code has two. A merchant with
   * several accounts, or with one they cannot use, gets the picker and its
   * reasons.
   *
   * Reaching the provider here is best-effort on purpose: the grant is already
   * recorded, so a refusal costs the merchant a click on the picker rather than
   * the trip back through the platform's approval screen.
   */
  private async settleSingleAccount(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<boolean> {
    try {
      const choices = await this.adAccounts(orgId, storeId, platform);
      const usable = choices.filter((choice) => choice.selectable);
      if (usable.length !== 1) return false;

      await this.selectAccount(orgId, storeId, platform, usable[0].accountId);
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not settle the ${platform} ad account for store ${storeId} automatically: ${messageOf(error)}`,
      );
      return false;
    }
  }

  /**
   * The Store, its grant and its credential, or the reason there is no flow to
   * continue.
   *
   * Every ad-account call needs all three, and each of them is a different
   * failure a merchant can act on: a Store that is not theirs, an approval that
   * was never given, and a key that was destroyed while they were away.
   */
  private async grantFor(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<{
    store: { name: string; currency: string };
    connection: AdPlatformConnection;
    credential: StoreCredential;
  }> {
    const store = await this.stores.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');

    const connection = await this.connections.findByPlatform(
      orgId,
      storeId,
      platform,
    );
    if (!connection?.providerAccountRef) {
      throw new NotFoundException(
        'This store has not approved this platform yet. Start the connection first.',
      );
    }

    const credential = await this.openCredential(orgId, storeId);
    if (!credential) {
      throw new BadRequestException(
        'The credential for this store was revoked. Start the connection again.',
      );
    }

    return { store, connection, credential };
  }

  /** The Store's credential in plaintext, or null when it holds none. */
  private async openCredential(
    orgId: string,
    storeId: string,
  ): Promise<StoreCredential | null> {
    const row = await this.credentials.findByStore(orgId, storeId);
    if (!row?.sealedSecret) return null;
    return {
      providerRef: row.providerRef,
      providerKeyRef: row.providerKeyRef,
      secret: this.vault.open(row.sealedSecret),
    };
  }

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
    const existing = await this.openCredential(orgId, storeId);
    if (existing) return existing;

    const issued = await this.provider.issueStoreCredential({
      storeId,
      storeName,
    });
    await this.credentials.upsert(orgId, storeId, {
      providerRef: issued.providerRef,
      providerKeyRef: issued.providerKeyRef,
      sealedSecret: this.vault.seal(issued.secret),
    });
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
    providerAccountRef: string | null,
  ): Promise<void> {
    const credential = await this.openCredential(orgId, storeId);
    if (!credential) return;

    const lastOne = !(await this.connections.hasOtherConnected(
      orgId,
      storeId,
      platform,
    ));

    try {
      if (providerAccountRef) {
        await this.provider.disconnect({
          credential,
          platform,
          providerAccountRef,
        });
      }
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

/**
 * One ad account, judged against the Store.
 *
 * The platform's own objection wins when it has one — an account with unsettled
 * billing cannot be used whatever its currency is, and telling a merchant about
 * the currency first would send them to fix the wrong thing.
 */
function toChoice(
  option: AdAccountOption,
  storeCurrency: string,
): AdAccountChoice {
  const reason =
    option.unusableReason ?? currencyRefusal(storeCurrency, option.currency);
  return {
    accountId: option.externalAccountId,
    name: option.name,
    currency: option.currency,
    selectable: reason === null,
    reason,
  };
}

function toView(row: AdPlatformConnection): AdPlatformConnectionView {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    accountId: row.externalAccountId,
    accountName: row.accountName,
    accountCurrency: row.accountCurrency,
    pixelId: row.pixelId,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncAttemptAt: row.lastSyncAttemptAt,
    lastSyncError: row.lastSyncError,
    syncPausedUntil: row.syncPausedUntil,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
