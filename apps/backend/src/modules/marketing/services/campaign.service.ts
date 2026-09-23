import { Injectable, NotFoundException } from '@nestjs/common';
import type { Campaign } from '../../../shared/database/schema';
import { CampaignRepository } from '../repositories/campaign.repository';

/**
 * Campaigns — one campaign each on the Store's connected ad account, keyed by
 * the platform's own campaign id.
 *
 * Read-only here. A Campaign is created on the platform, through the provider,
 * or discovered there by the sync; its name, schedule and status are the
 * platform's, and change here only by asking the platform to change them.
 * There is no merchant-owned status, and so no archive: a finished campaign
 * reads Ended because the platform says so.
 */
@Injectable()
export class CampaignService {
  constructor(private readonly campaigns: CampaignRepository) {}

  async list(orgId: string, storeId: string): Promise<Campaign[]> {
    return this.campaigns.findMany(orgId, storeId);
  }

  async get(orgId: string, storeId: string, id: string): Promise<Campaign> {
    const campaign = await this.campaigns.findById(id, orgId, storeId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }
}
