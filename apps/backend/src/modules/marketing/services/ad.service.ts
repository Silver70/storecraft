import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Ad, AdStatus } from '../../../shared/database/schema';
import { isUniqueViolation } from '../../../shared/database/db-error.util';
import { R2StorageService } from '../../../shared/storage/r2-storage.service';
import { AdRepository } from '../repositories/ad.repository';
import { CampaignRepository } from '../repositories/campaign.repository';
import {
  AD_TAG_FALLBACK,
  campaignTagCandidate,
  deriveCampaignTag,
} from '../utils/campaign-tag.util';

export interface CreateAdInput {
  name: string;
  externalId?: string | null;
  /** Both optional, and either may be set alone. */
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
}

export interface UpdateAdInput {
  name?: string;
  externalId?: string | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
}

/**
 * The parts of an uploaded file the creative actually needs. Named here rather
 * than taking `Express.Multer.File` so the service owes nothing to the
 * transport that carried the bytes in.
 */
export interface CreativeUpload {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/** How many tags to try before giving up on finding a free one. */
const MAX_TAG_ATTEMPTS = 25;

/**
 * Reads a flight date as the merchant sent it. `undefined` means "leave it
 * alone", `null` means "clear it" — the two are different instructions and are
 * kept apart all the way to the write.
 */
function parseFlightDate(
  value: string | Date | null | undefined,
  label: string,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${label} is not a date.`);
  }
  return date;
}

/**
 * Ads — one creative running under a Campaign, and the unit a merchant compares
 * two variants of one push by.
 *
 * The properties that matter here are the Campaign's, for the Campaign's
 * reasons, with one difference:
 *
 * An Ad's canonical tag is assigned once and never changes, including on
 * rename, because a link already pasted into an ad platform cannot be recalled.
 *
 * An Ad cannot be deleted, only archived. Revenue is attributed to it from its
 * rules at read time, so removing the row would silently re-bucket money already
 * reported against it.
 *
 * The difference is the scope of uniqueness: an Ad Tag is unique within its
 * **Campaign**, not within the Store, so every Campaign is free to call its
 * variants `video-a` and `still-b`. That is only safe because an Ad is resolved
 * in a second pass over its own Campaign's Ads (ADR-0004) and can therefore
 * never claim a sale belonging to a sibling Campaign.
 */
@Injectable()
export class AdService {
  constructor(
    private readonly ads: AdRepository,
    private readonly campaigns: CampaignRepository,
    private readonly storage: R2StorageService,
  ) {}

  async list(
    orgId: string,
    storeId: string,
    campaignId: string,
    status?: AdStatus,
  ): Promise<Ad[]> {
    await this.requireCampaign(orgId, storeId, campaignId);
    return this.ads.findManyForCampaign(campaignId, orgId, storeId, status);
  }

  async get(
    orgId: string,
    storeId: string,
    campaignId: string,
    id: string,
  ): Promise<Ad> {
    await this.requireCampaign(orgId, storeId, campaignId);
    const ad = await this.ads.findById(id, campaignId, orgId, storeId);
    if (!ad) throw new NotFoundException('Ad not found');
    return ad;
  }

  /**
   * Creates an Ad, its canonical tag, and the exact-match rule on that tag.
   *
   * The rule is created here rather than left to the merchant for the reason a
   * Campaign's is: an Ad is born already carrying the tag that will later let
   * its Orders find it, so splitting a push by creative never requires authoring
   * a rule first.
   */
  async create(
    orgId: string,
    storeId: string,
    campaignId: string,
    input: CreateAdInput,
  ): Promise<Ad> {
    await this.requireCampaign(orgId, storeId, campaignId);

    const name = input.name.trim();
    const base = deriveCampaignTag(name, AD_TAG_FALLBACK);
    const externalId = input.externalId?.trim() || null;
    const startsAt = parseFlightDate(input.startsAt, 'Start date') ?? null;
    const endsAt = parseFlightDate(input.endsAt, 'End date') ?? null;
    assertFlightOrder(startsAt, endsAt);

    // The exists check picks a readable tag; the retry handles the case where
    // another request claimed it between the check and the insert. The unique
    // constraint on (campaign_id, tag), not this loop, is what actually
    // guarantees uniqueness.
    let ad: Ad | undefined;
    for (let attempt = 1; attempt <= MAX_TAG_ATTEMPTS; attempt++) {
      const tag = campaignTagCandidate(base, attempt);
      if (await this.ads.tagExists(tag, campaignId, orgId, storeId)) continue;

      try {
        ad = await this.ads.create({
          organizationId: orgId,
          storeId,
          campaignId,
          name,
          tag,
          externalId,
          startsAt,
          endsAt,
          status: 'active',
        });
        break;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }

    if (!ad) {
      throw new ConflictException(
        `Could not assign a unique tag for "${name}" within this campaign — try a more distinctive name.`,
      );
    }

    await this.ads.createRule({
      organizationId: orgId,
      storeId,
      campaignId,
      adId: ad.id,
      field: 'utm_content',
      operator: 'equals',
      value: ad.tag,
      isCanonical: true,
    });

    return ad;
  }

  /**
   * Updates the merchant-owned fields. The tag and the status are deliberately
   * not among them: the tag is immutable, and the status moves only through
   * archive/unarchive so the intent is explicit in the request.
   */
  async update(
    orgId: string,
    storeId: string,
    campaignId: string,
    id: string,
    input: UpdateAdInput,
  ): Promise<Ad> {
    const existing = await this.get(orgId, storeId, campaignId, id);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.externalId !== undefined) {
      patch.externalId = input.externalId?.trim() || null;
    }

    const startsAt = parseFlightDate(input.startsAt, 'Start date');
    const endsAt = parseFlightDate(input.endsAt, 'End date');
    if (startsAt !== undefined) patch.startsAt = startsAt;
    if (endsAt !== undefined) patch.endsAt = endsAt;

    assertFlightOrder(
      startsAt === undefined ? existing.startsAt : startsAt,
      endsAt === undefined ? existing.endsAt : endsAt,
    );

    if (Object.keys(patch).length === 0) return existing;

    const updated = await this.ads.update(
      id,
      campaignId,
      orgId,
      storeId,
      patch,
    );
    if (!updated) throw new NotFoundException('Ad not found');
    return updated;
  }

  /**
   * Stores a creative image and points the Ad at it.
   *
   * The Ad is resolved before a single byte is stored, which is the one place
   * this deliberately differs from the product-media controller it otherwise
   * copies: that one uploads first and looks the row up afterwards, so a request
   * naming another tenant's id is refused only after its bytes are already in
   * the bucket. Here the refusal comes first and nothing is written.
   *
   * Replacing simply writes a new URL. The object behind the old one is left
   * where it is, as replacing product media leaves its predecessor: the column
   * is the only thing anything reads, and a delete that failed would turn a
   * successful upload into an error the merchant cannot act on.
   */
  async setCreative(
    orgId: string,
    storeId: string,
    campaignId: string,
    id: string,
    file: CreativeUpload,
  ): Promise<Ad> {
    await this.get(orgId, storeId, campaignId, id);

    const url = await this.storage.upload(
      creativeKey(id, file.originalname),
      file.buffer,
      file.mimetype,
    );

    const updated = await this.ads.update(id, campaignId, orgId, storeId, {
      creativeUrl: url,
    });
    if (!updated) throw new NotFoundException('Ad not found');
    return updated;
  }

  /**
   * Clears the creative, returning the Ad to the empty state it was born in —
   * which is a designed state, not a failure, so there is nothing to repair
   * afterwards.
   */
  async removeCreative(
    orgId: string,
    storeId: string,
    campaignId: string,
    id: string,
  ): Promise<Ad> {
    await this.get(orgId, storeId, campaignId, id);
    const updated = await this.ads.update(id, campaignId, orgId, storeId, {
      creativeUrl: null,
    });
    if (!updated) throw new NotFoundException('Ad not found');
    return updated;
  }

  async archive(
    orgId: string,
    storeId: string,
    campaignId: string,
    id: string,
  ): Promise<Ad> {
    await this.get(orgId, storeId, campaignId, id);
    const updated = await this.ads.update(id, campaignId, orgId, storeId, {
      status: 'archived',
      archivedAt: new Date(),
    });
    if (!updated) throw new NotFoundException('Ad not found');
    return updated;
  }

  /**
   * Returns one Ad to the active list.
   *
   * Deliberately per-Ad and never a side effect of restoring the Campaign: a
   * merchant who retired creatives one at a time and then revived the push must
   * not have them all resurrected behind their back.
   */
  async unarchive(
    orgId: string,
    storeId: string,
    campaignId: string,
    id: string,
  ): Promise<Ad> {
    await this.get(orgId, storeId, campaignId, id);
    const updated = await this.ads.update(id, campaignId, orgId, storeId, {
      status: 'active',
      archivedAt: null,
    });
    if (!updated) throw new NotFoundException('Ad not found');
    return updated;
  }

  /** A campaign id from another tenant reads as "not found", never as a row. */
  private async requireCampaign(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<void> {
    const campaign = await this.campaigns.findById(campaignId, orgId, storeId);
    if (!campaign) throw new NotFoundException('Campaign not found');
  }
}

/**
 * Where one Ad's creatives live in the bucket. The random segment is what makes
 * a replacement a new object rather than an overwrite of a URL a browser may
 * still have cached, and the filename is stripped of anything that would open a
 * second path segment.
 */
function creativeKey(adId: string, originalName: string): string {
  const safeName = originalName.replace(/[^\w.-]+/g, '-').slice(-100);
  return `ads/${adId}/${randomUUID()}-${safeName}`;
}

/**
 * A flight that ends before it starts is a typo, not a window. Both dates stay
 * optional and either may be set alone — this only refuses the pair that cannot
 * describe anything.
 */
function assertFlightOrder(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
): void {
  if (!startsAt || !endsAt) return;
  if (startsAt.getTime() > endsAt.getTime()) {
    throw new BadRequestException(
      'The end date must not precede the start date.',
    );
  }
}
