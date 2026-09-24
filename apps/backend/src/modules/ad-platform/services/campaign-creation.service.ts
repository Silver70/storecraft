import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { R2StorageService } from '../../../shared/storage/r2-storage.service';
import { StoreService } from '../../tenant/services/store.service';
import {
  AD_PLATFORM_PROVIDER,
  CampaignRejectedError,
  CreateInFlightError,
  type AdDraft,
  type AdPlatformProvider,
  type CampaignDraft,
  type CreativeMedia,
  type DraftComplaint,
  type GrantedAccount,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import type { CreateCampaignDto } from '../dto/create-campaign.dto';
import { AdPlatformConnectionRepository } from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import {
  CampaignMirrorRepository,
  type MirrorScope,
} from '../repositories/campaign-mirror.repository';
import { CredentialVault } from './credential-vault.service';
import {
  AdDraftResolver,
  UPLOAD_TYPES,
  uploadPrefix,
} from './ad-draft.resolver';
import { LINK_TAGS, carriesOurLinkTags } from '../utils/link-tags.util';
import { collapseStatus } from '../utils/platform-status.util';
import {
  DraftRuleError,
  adName,
  checkAdCount,
  checkAgeRange,
  normalizeCountries,
  resolveSchedule,
} from '../utils/campaign-draft.util';

/** What a create answered with. */
export interface CreateCampaignOutcome {
  campaignId: string;
  externalId: string;
  /** Whether every ad was confirmed, or at least sent, carrying our tags. */
  tracked: boolean;
  /** True when this was a retry, answered with the campaign already made. */
  replayed: boolean;
  /** Ads the dry run could not check. Said so the merchant knows. */
  unchecked: number[];
}

/** Larger than any ad image; Meta takes up to 30 MB. */
export const MAX_IMAGE_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * A ceiling set by how the file reaches us, in one request body held in
 * memory, rather than by Meta, which takes far larger videos.
 */
export const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;

const FAILED_BEFORE_ANSWER =
  'The ad platform could not be reached just now. The campaign may or may not have been created. Press the same button again: it finishes the job, and cannot create a second campaign.';

/**
 * Creating a campaign from this admin: the one write that spends the
 * merchant's money from a standing start.
 *
 * ## Tags first
 *
 * A campaign created here is measurable from birth. The Link Tags are part of
 * the draft sent to the platform, applied to every ad in the call that creates
 * it, so no ad exists at the platform without them. Once it is created, each
 * ad's tags are read back, and a campaign is Tracked here because the platform
 * says its ads carry them, not because we sent them. Without them the campaign
 * produces spend with no revenue beside it, which is worse than not having it.
 *
 * ## Nothing reaches the platform unchecked
 *
 * The draft passes the rules here, then the platform's own dry run, before the
 * real create is sent. A complaint from either is answered with a 422 carrying
 * every complaint, placed on the form by field and by ad, and nothing is
 * created. The real create can still be refused, for a video the dry run could
 * not see. That is answered the same way, and nothing half-made is left here,
 * because nothing is written until the platform has answered.
 *
 * ## One campaign per press
 *
 * The request carries an `Idempotency-Key`. A key that already made a campaign
 * here is answered with it without calling the platform. A key the platform
 * saw but we never recorded, because the answer was lost on the way back, is
 * replayed by the platform itself with the same campaign, and recorded then.
 * Two presses in flight at once are refused rather than raced.
 */
@Injectable()
export class CampaignCreationService {
  private readonly logger = new Logger(CampaignCreationService.name);

  /** Creates in flight in this process, by store and key. */
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(AD_PLATFORM_PROVIDER)
    private readonly provider: AdPlatformProvider,
    private readonly mirror: CampaignMirrorRepository,
    private readonly adDrafts: AdDraftResolver,
    private readonly connections: AdPlatformConnectionRepository,
    private readonly credentials: AdPlatformCredentialRepository,
    private readonly vault: CredentialVault,
    private readonly stores: StoreService,
    private readonly storage: R2StorageService,
  ) {}

  async create(
    orgId: string,
    storeId: string,
    dto: CreateCampaignDto,
    idempotencyKey: string,
    now: Date = new Date(),
  ): Promise<CreateCampaignOutcome> {
    const existing = await this.mirror.findByCreationKey(
      orgId,
      storeId,
      idempotencyKey,
    );
    if (existing) {
      const campaign = await this.mirror.findCampaignToTrack(
        orgId,
        storeId,
        existing.id,
      );
      return {
        campaignId: existing.id,
        externalId: existing.externalId,
        tracked: campaign?.hasLinkTags ?? false,
        replayed: true,
        unchecked: [],
      };
    }

    const [target] = await this.connections.findConnectedForStore(
      orgId,
      storeId,
      'meta',
    );
    if (!target) {
      throw new ConflictException(
        'Meta is not connected to this store, so a campaign cannot be created. Connect Meta and try again.',
      );
    }
    const { connection } = target;
    if (!connection.providerAccountRef || !connection.externalAccountId) {
      throw new ConflictException(
        'This store’s Meta connection has no ad account chosen yet, so a campaign cannot be created.',
      );
    }
    if (!connection.pixelId) {
      throw new ConflictException(
        'This store’s Meta connection has no Pixel, so a campaign could not report its sales. Reconnect Meta and try again.',
      );
    }

    const store = await this.stores.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');

    const draft = await this.draftFrom(orgId, storeId, dto, {
      currency: store.currency,
      timezone: store.timezone,
      storefront: store,
      pixelId: connection.pixelId,
      now,
    });

    const flightKey = `${storeId}:${idempotencyKey}`;
    if (this.inFlight.has(flightKey)) {
      throw new ConflictException(
        'This campaign is already being created. Wait for that to finish.',
      );
    }
    this.inFlight.add(flightKey);

    try {
      const account: GrantedAccount & { externalAccountId: string } = {
        credential: await this.credentialFor(orgId, storeId),
        platform: 'meta',
        providerAccountRef: connection.providerAccountRef,
        externalAccountId: connection.externalAccountId,
      };

      const check = await this.provider.validateCampaign({ ...account, draft });
      if (check.complaints.length) {
        throw rejected(
          'Meta would not accept this campaign as it stands. Nothing was created.',
          check.complaints,
        );
      }

      let created;
      try {
        created = await this.provider.createCampaign({
          ...account,
          draft,
          idempotencyKey,
        });
      } catch (error) {
        if (error instanceof CampaignRejectedError) {
          throw rejected(
            'Meta refused to create this campaign. Nothing was created.',
            error.complaints,
          );
        }
        if (error instanceof CreateInFlightError) {
          throw new ConflictException(
            'This campaign is already being created. Wait for that to finish.',
          );
        }
        if (error instanceof HttpException) throw error;
        this.logger.error(
          `Creating a campaign in store ${storeId} failed without an answer: ${detailOf(error)}`,
        );
        throw new ServiceUnavailableException(FAILED_BEFORE_ANSWER);
      }

      const scope: MirrorScope = {
        organizationId: orgId,
        storeId,
        platform: 'meta',
      };
      const imageOf = (index: number): string | null => {
        const media = draft.ads[index]?.media;
        return media?.kind === 'image' ? media.url : null;
      };
      const indexByName = new Map(draft.ads.map((ad, i) => [ad.name, i]));

      const { campaignId, adIds } = await this.mirror.recordCreated(
        scope,
        {
          creationKey: idempotencyKey,
          externalId: created.externalCampaignId,
          name: draft.name,
          status: collapseStatus(created.signals, now),
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
          dailyBudget: draft.dailyBudget,
          // The first ad's picture; the first picture at all when it is a video.
          coverUrl:
            imageOf(0) ??
            draft.ads.map((_, i) => imageOf(i)).find(Boolean) ??
            null,
          ads: created.ads.map((ad, position) => {
            const index = indexByName.get(ad.name ?? '') ?? position;
            return {
              externalId: ad.externalAdId,
              name: ad.name ?? draft.ads[index]?.name ?? draft.name,
              format: ad.format ?? draft.ads[index]?.media.kind ?? null,
              status: collapseStatus(ad.signals, now),
              reviewStatus: ad.signals.review,
              creativeUrl: imageOf(index),
              adSetExternalId: ad.externalAdSetId,
            };
          }),
        },
        now,
      );

      await this.confirmTags(scope, account, adIds, now);
      await this.mirror.refreshTracked(scope, now);

      const after = await this.mirror.findCampaignToTrack(
        orgId,
        storeId,
        campaignId,
      );
      this.logger.log(
        `Created campaign ${created.externalCampaignId} with ${created.ads.length} ad(s) in store ${storeId}` +
          (draft.launch === 'paused' ? ', paused' : ''),
      );

      return {
        campaignId,
        externalId: created.externalCampaignId,
        tracked: after?.hasLinkTags ?? false,
        replayed: false,
        unchecked: [...check.unchecked],
      };
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  /**
   * Stores a file a merchant uploaded to make an ad from, in this Store's own
   * storage, and answers with the URL a draft then names.
   */
  async upload(
    orgId: string,
    storeId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ url: string; kind: CreativeMedia['kind'] }> {
    const type = UPLOAD_TYPES[file.mimetype];
    if (!type) {
      throw new UnprocessableEntityException(
        'Upload a JPEG or PNG image, or an MP4 or MOV video.',
      );
    }
    const limit =
      type.kind === 'image' ? MAX_IMAGE_UPLOAD_BYTES : MAX_VIDEO_UPLOAD_BYTES;
    if (file.size > limit) {
      throw new UnprocessableEntityException(
        `That ${type.kind} is larger than ${limit / (1024 * 1024)} MB.`,
      );
    }
    const key = `${uploadPrefix(orgId, storeId)}${randomUUID()}.${type.ext}`;
    const url = await this.storage.upload(key, file.buffer, file.mimetype);
    return { url, kind: type.kind };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * The draft the platform is sent, from the form: every rule checked, every
   * reference turned into a URL, and the Link Tags on it.
   *
   * Every broken rule on every ad is collected before answering, so a merchant
   * fixes the form once rather than once per complaint.
   */
  private async draftFrom(
    orgId: string,
    storeId: string,
    dto: CreateCampaignDto,
    context: {
      currency: string;
      timezone: string;
      storefront: { storefrontUrl: string | null; productPathPattern: string };
      pixelId: string;
      now: Date;
    },
  ): Promise<CampaignDraft> {
    const complaints: DraftComplaint[] = [];
    const attempt = <T>(fn: () => T): T | undefined => {
      try {
        return fn();
      } catch (error) {
        if (!(error instanceof DraftRuleError)) throw error;
        complaints.push(...error.complaints);
        return undefined;
      }
    };

    const name = dto.name.trim();
    if (!name) {
      complaints.push({
        adIndex: null,
        field: 'name',
        message: 'Name the campaign.',
      });
    }
    attempt(() => checkAdCount(dto.ads.length));
    const schedule = attempt(() =>
      resolveSchedule({
        startDay: dto.startDate,
        endDay: dto.endDate ?? null,
        timezone: context.timezone,
        now: context.now,
      }),
    );
    const countries = attempt(() => normalizeCountries(dto.countries));
    attempt(() => checkAgeRange(dto.ageMin, dto.ageMax));

    const ads: AdDraft[] = [];
    for (const [index, ad] of dto.ads.entries()) {
      const resolved = await this.adDrafts.resolve(orgId, storeId, ad, {
        index,
        name: adName(name, index),
        storefront: context.storefront,
        complaints,
      });
      if (resolved) ads.push(resolved);
    }

    if (complaints.length) {
      throw rejected(
        'Some of this campaign needs fixing before it can be sent to Meta.',
        complaints,
      );
    }

    return {
      name,
      dailyBudget: dto.dailyBudget,
      currency: context.currency,
      startsAt: schedule!.startsAt,
      endsAt: schedule!.endsAt,
      countries: countries!,
      ageMin: dto.ageMin,
      ageMax: dto.ageMax,
      pixelId: context.pixelId,
      linkTags: LINK_TAGS,
      ads,
      launch: dto.launch,
    };
  }

  /**
   * Reads each new ad's tags back from the platform and records what it says.
   *
   * The tags were sent in the create, and the platform accepted it. Reading
   * them back is what lets the grid say Tracked as a fact. A read that fails
   * leaves the ad as sent, carrying the tags, and unconfirmed, and the next
   * sync reads it. A read that finds them missing records the ad as untagged.
   * The campaign then reads Not Tracked and offers Start tracking, instead of
   * claiming revenue it cannot see.
   */
  private async confirmTags(
    scope: MirrorScope,
    account: GrantedAccount,
    adIds: ReadonlyMap<string, string>,
    now: Date,
  ): Promise<void> {
    for (const [externalAdId, adId] of adIds) {
      try {
        const tags = await this.provider.readLinkTags({
          ...account,
          externalAdId,
        });
        const carries = carriesOurLinkTags(tags);
        if (!carries) {
          this.logger.error(
            `Ad ${externalAdId} in store ${scope.storeId} was created without our link tags`,
          );
        }
        await this.mirror.recordLinkTags(scope, adId, carries, now);
      } catch (error) {
        this.logger.warn(
          `Confirming link tags on new ad ${externalAdId} in store ${scope.storeId} failed; ` +
            `left for the next sync: ${detailOf(error)}`,
        );
        return;
      }
    }
  }

  private async credentialFor(
    orgId: string,
    storeId: string,
  ): Promise<StoreCredential> {
    const row = await this.credentials.findByStore(orgId, storeId);
    if (!row?.sealedSecret) {
      throw new ConflictException(
        'This store’s Meta connection has no credential. Reconnect Meta and try again.',
      );
    }
    return {
      providerRef: row.providerRef,
      providerKeyRef: row.providerKeyRef,
      secret: this.vault.open(row.sealedSecret),
    };
  }
}

/** A 422 the form reads: a summary, and each complaint where it belongs. */
export function rejected(
  message: string,
  complaints: readonly DraftComplaint[],
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message,
    complaints,
  });
}

function detailOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
