import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Campaign,
  CampaignPlatform,
  CampaignStatus,
} from '../../../shared/database/schema';
import { CampaignRepository } from '../repositories/campaign.repository';
import {
  campaignTagCandidate,
  deriveCampaignTag,
} from '../utils/campaign-tag.util';

export interface CreateCampaignInput {
  name: string;
  platform: CampaignPlatform;
  externalId?: string | null;
}

export interface UpdateCampaignInput {
  name?: string;
  platform?: CampaignPlatform;
  externalId?: string | null;
}

/** How many tags to try before giving up on finding a free one. */
const MAX_TAG_ATTEMPTS = 25;

const UNIQUE_VIOLATION = '23505';

function isTagCollision(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === UNIQUE_VIOLATION;
}

/**
 * Campaigns — the things a merchant spends money on, and the unit revenue is
 * attributed to.
 *
 * Two properties are worth stating outright, because both are load-bearing and
 * neither is obvious from the CRUD:
 *
 * A Campaign's canonical tag is assigned once and never changes, including on
 * rename. The tag is what generated links carry into ad platforms, and a link
 * already live cannot be recalled — re-deriving it from a new name would orphan
 * every ad running under the old one.
 *
 * A Campaign cannot be deleted, only archived. Attribution is resolved from a
 * Campaign's matching rules at read time (ADR-0001), so removing the row would
 * silently move revenue that has already been reported into Unattributed.
 * Archiving takes it out of the active list and leaves its history intact.
 */
@Injectable()
export class CampaignService {
  constructor(private readonly campaigns: CampaignRepository) {}

  async list(
    orgId: string,
    storeId: string,
    status?: CampaignStatus,
  ): Promise<Campaign[]> {
    return this.campaigns.findMany(orgId, storeId, status);
  }

  async get(orgId: string, storeId: string, id: string): Promise<Campaign> {
    const campaign = await this.campaigns.findById(id, orgId, storeId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /**
   * Creates a Campaign, its canonical tag, and the exact-match rule on that tag.
   *
   * The rule is created here rather than left to the merchant so that a link the
   * admin generates is attributed by construction — matching a campaign you just
   * made should never require authoring a rule first, and a merchant who never
   * opens the rules screen still gets correct reports.
   */
  async create(
    orgId: string,
    storeId: string,
    input: CreateCampaignInput,
  ): Promise<Campaign> {
    const name = input.name.trim();
    const base = deriveCampaignTag(name);
    const externalId = input.externalId?.trim() || null;

    // The exists check picks a readable tag; the retry handles the case where
    // another request claimed it between the check and the insert. The unique
    // constraint, not this loop, is what actually guarantees uniqueness.
    let campaign: Campaign | undefined;
    for (let attempt = 1; attempt <= MAX_TAG_ATTEMPTS; attempt++) {
      const tag = campaignTagCandidate(base, attempt);
      if (await this.campaigns.tagExists(tag, orgId, storeId)) continue;

      try {
        campaign = await this.campaigns.create({
          organizationId: orgId,
          storeId,
          name,
          tag,
          platform: input.platform,
          externalId,
          status: 'active',
        });
        break;
      } catch (error) {
        if (!isTagCollision(error)) throw error;
      }
    }

    if (!campaign) {
      throw new ConflictException(
        `Could not assign a unique tag for "${name}" — try a more distinctive name.`,
      );
    }

    await this.campaigns.createRule({
      organizationId: orgId,
      storeId,
      campaignId: campaign.id,
      field: 'utm_campaign',
      operator: 'equals',
      value: campaign.tag,
      isCanonical: true,
    });

    return campaign;
  }

  /**
   * Updates the merchant-owned fields. The tag and the status are deliberately
   * not among them: the tag is immutable, and the status moves only through
   * archive/unarchive so the intent is explicit in the request.
   */
  async update(
    orgId: string,
    storeId: string,
    id: string,
    input: UpdateCampaignInput,
  ): Promise<Campaign> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.platform !== undefined) patch.platform = input.platform;
    if (input.externalId !== undefined) {
      patch.externalId = input.externalId?.trim() || null;
    }

    if (Object.keys(patch).length === 0) return this.get(orgId, storeId, id);

    const updated = await this.campaigns.update(id, orgId, storeId, patch);
    if (!updated) throw new NotFoundException('Campaign not found');
    return updated;
  }

  async archive(orgId: string, storeId: string, id: string): Promise<Campaign> {
    const updated = await this.campaigns.update(id, orgId, storeId, {
      status: 'archived',
      archivedAt: new Date(),
    });
    if (!updated) throw new NotFoundException('Campaign not found');
    return updated;
  }

  async unarchive(
    orgId: string,
    storeId: string,
    id: string,
  ): Promise<Campaign> {
    const updated = await this.campaigns.update(id, orgId, storeId, {
      status: 'active',
      archivedAt: null,
    });
    if (!updated) throw new NotFoundException('Campaign not found');
    return updated;
  }
}
