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
import type { AdPlatform, Campaign } from '../../../shared/database/schema';
import { StoreService } from '../../tenant/services/store.service';
import {
  AD_PLATFORM_PROVIDER,
  CampaignRejectedError,
  ChangeRejectedError,
  CreateInFlightError,
  type AdPlatformProvider,
  type DeliverySwitch,
  type DraftComplaint,
  type DraftField,
  type GrantedAccount,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import type { CampaignAdDto } from '../dto/create-campaign.dto';
import type { SetCoverDto, UpdateCampaignDto } from '../dto/edit-campaign.dto';
import {
  AdPlatformConnectionRepository,
  type ConnectionToSync,
} from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import {
  CampaignMirrorRepository,
  type CampaignChange,
  type CampaignToEdit,
  type MirrorScope,
} from '../repositories/campaign-mirror.repository';
import { AdDraftResolver } from './ad-draft.resolver';
import { AdPlatformSyncService } from './ad-platform-sync.service';
import { CredentialVault } from './credential-vault.service';
import { rejected } from './campaign-creation.service';
import { LINK_TAGS, carriesOurLinkTags } from '../utils/link-tags.util';
import { collapseStatus } from '../utils/platform-status.util';
import {
  DraftRuleError,
  adName,
  resolveEndDate,
} from '../utils/campaign-draft.util';

/** What adding an ad answered with. */
export interface AddAdOutcome {
  adId: string;
  externalId: string;
  /** Whether the campaign is Tracked afterwards: every ad carries our tags. */
  tracked: boolean;
}

/** An account the platform can be asked about, and where it lives. */
interface EditTarget {
  scope: MirrorScope;
  account: GrantedAccount;
  connection: ConnectionToSync['connection'];
  timezone: string;
}

const UNREACHABLE =
  'The ad platform could not be reached just now, so nothing more was changed. Try again shortly.';

/**
 * Changing a campaign that is already running: the handful of things a
 * merchant needs to stop it, feed it, extend it, rename it, add a fresh
 * creative to it, or change the picture it is recognised by.
 *
 * ## What is not here, on purpose
 *
 * The audience and the goal, because changing either resets what the platform
 * has learned. An existing ad's creative, because the platform replaces the
 * creative and sends the ad back through review, losing its engagement. The
 * supported move is to add a new ad and pause the old one. Deletion, because it
 * cannot be undone at the platform, and pausing does what the merchant wants.
 *
 * ## The platform first, then here
 *
 * Every change but the Cover spends, or stops spending, real money, and takes
 * effect at the platform. So each one is sent to the platform first and
 * recorded here only once the platform has accepted it. It is recorded at once,
 * not left for the next hourly sync. A change the platform refuses is never
 * recorded, so the previous state stands, and the platform's own words are
 * passed back.
 *
 * Every rule that can be checked here is checked before anything is sent, and
 * every complaint is answered at once, as a create answers them.
 *
 * ## A sync after a switch
 *
 * Pausing, resuming, moving the end date and adding an ad change what the
 * platform reports underneath: each Ad's delivery, and a new Ad's review. So
 * each is followed by a sync, which brings that back now. A sync reports its
 * failures rather than throwing them, so it cannot turn an accepted change into
 * an error. A rename, a budget and a Cover change nothing the platform reports
 * that we did not just write, so they are not followed by one.
 */
@Injectable()
export class CampaignEditService {
  private readonly logger = new Logger(CampaignEditService.name);

  /** Ads being added right now, by store and key, so a double press is one ad. */
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(AD_PLATFORM_PROVIDER)
    private readonly provider: AdPlatformProvider,
    private readonly mirror: CampaignMirrorRepository,
    private readonly connections: AdPlatformConnectionRepository,
    private readonly credentials: AdPlatformCredentialRepository,
    private readonly vault: CredentialVault,
    private readonly sync: AdPlatformSyncService,
    private readonly stores: StoreService,
    private readonly adDrafts: AdDraftResolver,
  ) {}

  /**
   * Renames the campaign, changes its daily budget, or sets or clears its end
   * date. Whatever was sent and differs from what is stored is changed, and
   * nothing else.
   */
  async update(
    orgId: string,
    storeId: string,
    campaignId: string,
    dto: UpdateCampaignDto,
    now: Date = new Date(),
  ): Promise<Campaign> {
    const found = await this.findToEdit(orgId, storeId, campaignId);
    const { campaign } = found;
    const target = await this.targetFor(orgId, storeId, campaign.platform);

    // ─── Everything checkable here, before anything is sent ─────────────────
    const complaints: DraftComplaint[] = [];
    const complain = (field: DraftField, message: string) =>
      complaints.push({ adIndex: null, field, message });

    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) complain('name', 'Name the campaign.');
    const rename = name && name !== campaign.name ? name : undefined;

    const budget =
      dto.dailyBudget !== undefined && dto.dailyBudget !== campaign.dailyBudget
        ? dto.dailyBudget
        : undefined;
    if (budget !== undefined) {
      const reason = budgetLockedReason(campaign);
      if (reason) complain('dailyBudget', reason);
    }

    let endsAt: Date | null | undefined;
    if (dto.endDate !== undefined) {
      try {
        endsAt =
          dto.endDate === null
            ? null
            : resolveEndDate({
                endDay: dto.endDate,
                startsAt: campaign.startsAt,
                timezone: target.timezone,
                now,
              });
      } catch (error) {
        if (!(error instanceof DraftRuleError)) throw error;
        complaints.push(...error.complaints);
      }
      if (endsAt !== undefined && sameInstant(endsAt, campaign.endsAt)) {
        endsAt = undefined;
      }
    }
    const adSets = adSetsOf(found);
    if (endsAt !== undefined && adSets.length === 0) {
      complain(
        'schedule',
        'This campaign’s schedule has not been read from Meta yet, so its end date cannot be changed. Refresh, then try again.',
      );
    }

    if (complaints.length) {
      throw rejected(
        'Some of this change needs fixing before it can be sent to Meta. Nothing has changed.',
        complaints,
      );
    }

    // ─── Sent, and recorded as each part is accepted ─────────────────────────
    const saved: string[] = [];

    if (rename !== undefined || budget !== undefined) {
      // One call carries both. A refusal of the pair belongs to neither field.
      const field: DraftField | null =
        rename !== undefined && budget !== undefined
          ? null
          : rename !== undefined
            ? 'name'
            : 'dailyBudget';
      await this.attempt(saved, field, () =>
        this.provider.updateCampaign({
          ...target.account,
          externalCampaignId: campaign.externalId,
          ...(rename !== undefined ? { name: rename } : {}),
          ...(budget !== undefined ? { dailyBudget: budget } : {}),
        }),
      );
      const change: CampaignChange = {};
      if (rename !== undefined) {
        change.name = rename;
        saved.push('the name');
      }
      if (budget !== undefined) {
        change.dailyBudget = budget;
        saved.push('the daily budget');
      }
      await this.mirror.recordCampaignChange(
        target.scope,
        campaign.id,
        change,
        now,
      );
    }

    if (endsAt !== undefined) {
      // The schedule lives on each Ad Set. A campaign created here has one.
      for (const externalAdSetId of adSets) {
        await this.attempt(saved, 'schedule', () =>
          this.provider.setAdSetEnd({
            ...target.account,
            externalAdSetId,
            endsAt,
          }),
        );
      }
      await this.mirror.recordCampaignChange(
        target.scope,
        campaign.id,
        { endsAt },
        now,
      );
      saved.push('the end date');
      // An end moved into the future can revive an ended campaign, and one
      // moved to today can finish it. Bring back what the platform now says.
      await this.sync.syncStore(orgId, storeId, campaign.platform, now);
    }

    if (saved.length) {
      this.logger.log(
        `Edited campaign ${campaign.id} in store ${storeId}: ${saved.join(', ')}`,
      );
    }
    return this.reread(orgId, storeId, campaign.id);
  }

  /** Pauses or resumes the whole campaign. */
  async setDelivery(
    orgId: string,
    storeId: string,
    campaignId: string,
    status: DeliverySwitch,
    now: Date = new Date(),
  ): Promise<Campaign> {
    const { campaign } = await this.findToEdit(orgId, storeId, campaignId);
    if (campaign.status === 'ended') {
      throw new ConflictException(
        'This campaign has ended, so it cannot be paused or resumed. To run it again, move its end date later.',
      );
    }
    const target = await this.targetFor(orgId, storeId, campaign.platform);

    await this.attempt([], null, () =>
      this.provider.setCampaignDelivery({
        ...target.account,
        externalCampaignId: campaign.externalId,
        status,
      }),
    );
    // A resume is read as delivering until the sync below says otherwise, such
    // as ads still in review.
    await this.mirror.recordCampaignChange(
      target.scope,
      campaign.id,
      { status: status === 'paused' ? 'paused' : 'active' },
      now,
    );
    await this.sync.syncStore(orgId, storeId, campaign.platform, now);

    this.logger.log(
      `Campaign ${campaign.id} in store ${storeId} switched ${status}`,
    );
    return this.reread(orgId, storeId, campaign.id);
  }

  /** Pauses or resumes one ad, and leaves its siblings as they are. */
  async setAdDelivery(
    orgId: string,
    storeId: string,
    campaignId: string,
    adId: string,
    status: DeliverySwitch,
    now: Date = new Date(),
  ): Promise<Campaign> {
    const found = await this.findToEdit(orgId, storeId, campaignId);
    const ad = found.ads.find((a) => a.id === adId);
    if (!ad) throw new NotFoundException('Ad not found in this campaign');
    if (ad.status === 'ended') {
      throw new ConflictException(
        'This ad has ended, so it cannot be paused or resumed.',
      );
    }
    const target = await this.targetFor(
      orgId,
      storeId,
      found.campaign.platform,
    );

    await this.attempt([], null, () =>
      this.provider.setAdDelivery({
        ...target.account,
        externalAdId: ad.externalId,
        status,
      }),
    );
    await this.mirror.recordAdStatus(
      target.scope,
      ad.id,
      status === 'paused' ? 'paused' : 'active',
      now,
    );
    await this.sync.syncStore(orgId, storeId, found.campaign.platform, now);

    this.logger.log(
      `Ad ${ad.id} of campaign ${found.campaign.id} in store ${storeId} switched ${status}`,
    );
    return this.reread(orgId, storeId, found.campaign.id);
  }

  /**
   * Adds one ad to a running campaign, from the same form a create uses, and
   * carrying our Link Tags from the call that makes it.
   *
   * It joins the Ad Set where the campaign's money already goes, and inherits
   * that Ad Set's budget, audience and schedule, so nothing about them
   * changes. The platform has no dry run for this, so a complaint about the ad
   * arrives with the create and is placed on the form. Nothing is created and
   * nothing is recorded when it does.
   */
  async addAd(
    orgId: string,
    storeId: string,
    campaignId: string,
    dto: CampaignAdDto,
    idempotencyKey: string,
    now: Date = new Date(),
  ): Promise<AddAdOutcome> {
    const found = await this.findToEdit(orgId, storeId, campaignId);
    const { campaign } = found;

    // A press already answered here. Asking the platform again would send a
    // different ad name, since the campaign has one more ad now, and the
    // platform refuses a key it has seen with a different body.
    const existing = await this.mirror.findAdByCreationKey(
      orgId,
      storeId,
      idempotencyKey,
    );
    if (existing) {
      if (existing.campaignId !== campaign.id) {
        throw new ConflictException(
          'That Idempotency-Key already added an ad to another campaign.',
        );
      }
      return {
        adId: existing.id,
        externalId: existing.externalId,
        tracked: campaign.hasLinkTags,
      };
    }

    if (campaign.status === 'ended') {
      throw new ConflictException(
        'This campaign has ended, so a new ad would never be shown. Move its end date later first.',
      );
    }
    const target = await this.targetFor(orgId, storeId, campaign.platform);
    const { connection } = target;
    if (!connection.externalAccountId || !connection.pixelId) {
      throw new ConflictException(
        'This store’s Meta connection has no ad account or Pixel, so an ad cannot be added. Reconnect Meta and try again.',
      );
    }

    const externalAdSetId = await this.mirror.adSetForNewAd(
      target.scope,
      campaign.id,
    );
    if (!externalAdSetId) {
      throw new ConflictException(
        'This campaign’s ads have not been read from Meta yet, so there is nowhere to add one. Refresh, then try again.',
      );
    }

    const store = await this.stores.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');

    const complaints: DraftComplaint[] = [];
    const ad = await this.adDrafts.resolve(orgId, storeId, dto, {
      index: 0,
      name: nextAdName(
        campaign.name,
        found.ads.map((a) => a.name),
      ),
      storefront: store,
      complaints,
    });
    if (!ad || complaints.length) {
      throw rejected(
        'This ad needs fixing before it can be sent to Meta. Nothing was added.',
        complaints,
      );
    }

    const flightKey = `${storeId}:${idempotencyKey}`;
    if (this.inFlight.has(flightKey)) {
      throw new ConflictException(
        'This ad is already being added. Wait for that to finish.',
      );
    }
    this.inFlight.add(flightKey);

    try {
      let created;
      try {
        created = await this.provider.addAd({
          ...target.account,
          externalAccountId: connection.externalAccountId,
          externalAdSetId,
          ad,
          pixelId: connection.pixelId,
          linkTags: LINK_TAGS,
          idempotencyKey,
        });
      } catch (error) {
        if (error instanceof CampaignRejectedError) {
          throw rejected(
            'Meta refused to add this ad. Nothing was added.',
            error.complaints.map((c) => ({ ...c, adIndex: 0 })),
          );
        }
        if (error instanceof CreateInFlightError) {
          throw new ConflictException(
            'This ad is already being added. Wait for that to finish.',
          );
        }
        if (error instanceof HttpException) throw error;
        this.logger.error(
          `Adding an ad to campaign ${campaign.id} in store ${storeId} failed without an answer: ${detailOf(error)}`,
        );
        throw new ServiceUnavailableException(
          'The ad platform could not be reached just now. The ad may or may not have been added. Press the same button again: it finishes the job, and cannot add a second ad.',
        );
      }

      const adId = await this.mirror.recordAdded(
        target.scope,
        campaign.id,
        {
          externalId: created.externalAdId,
          name: created.name ?? ad.name,
          format: created.format ?? ad.media.kind,
          status: collapseStatus(created.signals, now),
          reviewStatus: created.signals.review,
          creativeUrl: ad.media.kind === 'image' ? ad.media.url : null,
          adSetExternalId: created.externalAdSetId ?? externalAdSetId,
        },
        idempotencyKey,
        now,
      );

      await this.confirmTags(target, adId, created.externalAdId, now);
      await this.mirror.refreshTracked(target.scope, now);
      await this.sync.syncStore(orgId, storeId, campaign.platform, now);

      const after = await this.reread(orgId, storeId, campaign.id);
      this.logger.log(
        `Added ad ${created.externalAdId} to campaign ${campaign.id} in store ${storeId}`,
      );
      return {
        adId,
        externalId: created.externalAdId,
        tracked: after.hasLinkTags,
      };
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  /**
   * Changes the picture the campaign is recognised by, to one of its own ads'
   * creatives or to an image this Store uploaded.
   *
   * Ours alone: the platform has no Cover, so nothing is sent, and the sync
   * never overwrites a Cover once there is one.
   */
  async setCover(
    orgId: string,
    storeId: string,
    campaignId: string,
    dto: SetCoverDto,
    now: Date = new Date(),
  ): Promise<Campaign> {
    const found = await this.findToEdit(orgId, storeId, campaignId);
    let coverUrl: string;

    if (dto.adId) {
      const ad = found.ads.find((a) => a.id === dto.adId);
      if (!ad) throw new NotFoundException('Ad not found in this campaign');
      if (!ad.creativeUrl) {
        throw new UnprocessableEntityException(
          'That ad’s picture has not been copied from Meta yet. Choose another, or upload one.',
        );
      }
      coverUrl = ad.creativeUrl;
    } else {
      const url = dto.uploadUrl ?? '';
      if (!this.adDrafts.isOwnUploadedImage(orgId, storeId, url)) {
        throw new UnprocessableEntityException(
          'Upload the picture again. A cover is a JPEG or PNG image.',
        );
      }
      coverUrl = url;
    }

    await this.mirror.recordCampaignChange(
      {
        organizationId: orgId,
        storeId,
        platform: found.campaign.platform,
      },
      found.campaign.id,
      { coverUrl },
      now,
    );
    return this.reread(orgId, storeId, found.campaign.id);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async findToEdit(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<CampaignToEdit> {
    const found = await this.mirror.findCampaignToEdit(
      orgId,
      storeId,
      campaignId,
    );
    if (!found) throw new NotFoundException('Campaign not found');
    return found;
  }

  private async reread(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<Campaign> {
    return (await this.findToEdit(orgId, storeId, campaignId)).campaign;
  }

  /**
   * The connection an edit is sent through. A disconnected store has frozen
   * figures and nothing to send a change to, so it is refused, not queued.
   */
  private async targetFor(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<EditTarget> {
    const [found] = await this.connections.findConnectedForStore(
      orgId,
      storeId,
      platform,
    );
    if (!found) {
      throw new ConflictException(
        'Meta is not connected to this store, so this campaign cannot be changed from here. Reconnect Meta and try again.',
      );
    }
    const { connection } = found;
    if (!connection.providerAccountRef) {
      throw new ConflictException(
        'This store’s Meta connection has no ad account chosen yet, so this campaign cannot be changed.',
      );
    }
    return {
      scope: { organizationId: orgId, storeId, platform },
      account: {
        credential: await this.credentialFor(orgId, storeId),
        platform,
        providerAccountRef: connection.providerAccountRef,
      },
      connection,
      timezone: found.storeTimezone,
    };
  }

  /**
   * One call to the platform, with its failure turned into an answer.
   *
   * A refusal about the change is a 422 in the platform's words, placed on the
   * field it was about. A failure of the integration is passed on. Either way,
   * whatever was already saved by this request is named, because the
   * adapter's "nothing has changed" is not true of a request that got part of
   * the way.
   */
  private async attempt(
    saved: readonly string[],
    field: DraftField | null,
    send: () => Promise<void>,
  ): Promise<void> {
    const already = saved.length
      ? ` ${capitalise(saved.join(' and '))} ${saved.length === 1 ? 'was' : 'were'} saved.`
      : ' Nothing has changed.';
    try {
      await send();
    } catch (error) {
      if (error instanceof ChangeRejectedError) {
        throw rejected(`Meta did not accept the change.${already}`, [
          { adIndex: null, field, message: error.message },
        ]);
      }
      if (error instanceof HttpException) {
        if (!saved.length) throw error;
        throw new ServiceUnavailableException(
          `The ad platform could not be reached just now.${already} Try the rest again shortly.`,
        );
      }
      this.logger.error(`An edit failed without an answer: ${detailOf(error)}`);
      throw new ServiceUnavailableException(
        saved.length
          ? `The ad platform could not be reached just now.${already}`
          : UNREACHABLE,
      );
    }
  }

  /**
   * Reads a new ad's tags back, so Tracked is what the platform holds rather
   * than what we sent. A read that fails leaves it for the next sync.
   */
  private async confirmTags(
    target: EditTarget,
    adId: string,
    externalAdId: string,
    now: Date,
  ): Promise<void> {
    try {
      const tags = await this.provider.readLinkTags({
        ...target.account,
        externalAdId,
      });
      const carries = carriesOurLinkTags(tags);
      if (!carries) {
        this.logger.error(
          `Ad ${externalAdId} in store ${target.scope.storeId} was added without our link tags`,
        );
      }
      await this.mirror.recordLinkTags(target.scope, adId, carries, now);
    } catch (error) {
      this.logger.warn(
        `Confirming link tags on added ad ${externalAdId} in store ${target.scope.storeId} failed; ` +
          `left for the next sync: ${detailOf(error)}`,
      );
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

/**
 * Why this campaign's budget cannot be changed here, or null when it can: a
 * daily budget on the campaign itself, which every campaign created here has.
 */
export function budgetLockedReason(campaign: {
  budgetLevel: Campaign['budgetLevel'];
  dailyBudget: number | null;
}): string | null {
  if (campaign.budgetLevel === 'ad_set') {
    return 'This campaign’s budget is set on each of its ad sets, so change it in Meta Ads Manager.';
  }
  if (campaign.budgetLevel === null) {
    return 'This campaign’s budget has not been read from Meta yet. Refresh, then try again.';
  }
  if (campaign.dailyBudget === null) {
    return 'This campaign has a lifetime budget rather than a daily one, so change it in Meta Ads Manager.';
  }
  return null;
}

/** Every Ad Set the campaign's ads sit in, each once. */
function adSetsOf(found: CampaignToEdit): string[] {
  return [
    ...new Set(
      found.ads
        .map((ad) => ad.adSetExternalId)
        .filter((id): id is string => id !== null),
    ),
  ];
}

/** "{campaign} · Ad N", with N one past the ads it already has and not taken. */
function nextAdName(campaignName: string, taken: readonly string[]): string {
  const names = new Set(taken);
  for (let index = taken.length; ; index++) {
    const name = adName(campaignName, index);
    if (!names.has(name)) return name;
  }
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function detailOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
