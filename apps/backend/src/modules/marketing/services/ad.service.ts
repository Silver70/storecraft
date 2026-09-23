import { Injectable, NotFoundException } from '@nestjs/common';
import type { Ad } from '../../../shared/database/schema';
import { AdRepository } from '../repositories/ad.repository';
import { CampaignRepository } from '../repositories/campaign.repository';

/**
 * Ads — one creative each under a Campaign, keyed by the platform's own ad id.
 *
 * Read-only here, for the reason Campaigns are: an Ad is the platform's, and
 * its status and creative come from there.
 */
@Injectable()
export class AdService {
  constructor(
    private readonly ads: AdRepository,
    private readonly campaigns: CampaignRepository,
  ) {}

  async list(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<Ad[]> {
    await this.requireCampaign(orgId, storeId, campaignId);
    return this.ads.findManyForCampaign(campaignId, orgId, storeId);
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
