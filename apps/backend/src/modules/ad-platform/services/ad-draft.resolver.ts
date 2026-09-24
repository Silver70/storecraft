import { Injectable } from '@nestjs/common';
import { R2StorageService } from '../../../shared/storage/r2-storage.service';
import {
  StorefrontUrlError,
  resolveStorefrontUrl,
  type StorefrontDestination,
} from '../../../shared/utils/storefront-url.util';
import type {
  AdDraft,
  CreativeMedia,
  DraftComplaint,
} from '../interfaces/ad-platform-provider.interface';
import type { CampaignAdDto } from '../dto/create-campaign.dto';
import { CampaignDraftRepository } from '../repositories/campaign-draft.repository';

/** A file a merchant can upload to make an ad from, and what it becomes. */
export const UPLOAD_TYPES: Record<
  string,
  { ext: string; kind: CreativeMedia['kind'] }
> = {
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/png': { ext: 'png', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
};

const KIND_BY_EXT = new Map(
  Object.values(UPLOAD_TYPES).map(({ ext, kind }) => [ext, kind]),
);

/** Where this Store's ad uploads live, and the only place a draft may name one. */
export function uploadPrefix(orgId: string, storeId: string): string {
  return `ad-creatives/${orgId}/${storeId}/uploads/`;
}

/** The Store's storefront, as far as building a link into it needs. */
export interface StorefrontLinks {
  storefrontUrl: string | null;
  productPathPattern: string;
}

/**
 * One ad from the form, as the platform is sent it: its picture a URL in our
 * own storage, its link a page on the Store's own storefront, its copy
 * trimmed.
 *
 * Shared by a create and by adding an ad to a running campaign, so an ad
 * added later meets exactly the rules the first ones did. The form sends
 * references rather than URLs, and they are resolved here against this Store.
 * So no ad can show another tenant's image or link off the storefront, where
 * the capture script could not read its tags.
 */
@Injectable()
export class AdDraftResolver {
  constructor(
    private readonly drafts: CampaignDraftRepository,
    private readonly storage: R2StorageService,
  ) {}

  /**
   * The ad, or null when anything about it is wrong. Every broken rule is
   * added to `complaints`, placed on the ad at `index`, so the form shows them
   * all at once.
   */
  async resolve(
    orgId: string,
    storeId: string,
    ad: CampaignAdDto,
    context: {
      index: number;
      name: string;
      storefront: StorefrontLinks;
      complaints: DraftComplaint[];
    },
  ): Promise<AdDraft | null> {
    const { index, complaints } = context;
    const media = await this.mediaFor(orgId, storeId, ad, index, complaints);
    const destinationUrl = await this.destinationFor(
      orgId,
      storeId,
      ad,
      index,
      context.storefront,
      complaints,
    );
    const primaryText = ad.primaryText.trim();
    const headline = ad.headline.trim();
    if (!primaryText) {
      complaints.push({
        adIndex: index,
        field: 'primaryText',
        message: 'Write the text above the picture.',
      });
    }
    if (!headline) {
      complaints.push({
        adIndex: index,
        field: 'headline',
        message: 'Write a headline.',
      });
    }
    if (!media || !destinationUrl || !primaryText || !headline) return null;
    return {
      name: context.name,
      media,
      primaryText,
      headline,
      callToAction: ad.callToAction ?? 'shop_now',
      destinationUrl,
    };
  }

  /**
   * Whether a URL is an image this Store uploaded, and so one a Cover may
   * name. Videos are not: a Cover is a picture.
   */
  isOwnUploadedImage(orgId: string, storeId: string, url: string): boolean {
    return this.ownUploadKind(orgId, storeId, url) === 'image';
  }

  private ownUploadKind(
    orgId: string,
    storeId: string,
    url: string,
  ): CreativeMedia['kind'] | null {
    const prefix = this.storage.getPublicUrl(uploadPrefix(orgId, storeId));
    const kind = KIND_BY_EXT.get(url.split('.').pop()?.toLowerCase() ?? '');
    if (!url.startsWith(prefix) || !kind || url.includes('..')) return null;
    return kind;
  }

  /** A product image of this Store, or a file uploaded to this Store's storage. */
  private async mediaFor(
    orgId: string,
    storeId: string,
    ad: CampaignAdDto,
    index: number,
    complaints: DraftComplaint[],
  ): Promise<CreativeMedia | null> {
    if (ad.mediaSource === 'product') {
      const url = await this.drafts.findProductImage(
        orgId,
        storeId,
        ad.productMediaId!,
      );
      if (!url) {
        complaints.push({
          adIndex: index,
          field: 'media',
          message:
            'That product image is no longer in the catalogue. Choose another.',
        });
        return null;
      }
      return { kind: 'image', url };
    }

    const url = ad.uploadUrl!;
    const kind = this.ownUploadKind(orgId, storeId, url);
    if (!kind) {
      complaints.push({
        adIndex: index,
        field: 'media',
        message: 'Upload the picture or video again.',
      });
      return null;
    }
    return { kind, url };
  }

  /** The ad's link, always on this Store's own storefront. */
  private async destinationFor(
    orgId: string,
    storeId: string,
    ad: CampaignAdDto,
    index: number,
    storefront: StorefrontLinks,
    complaints: DraftComplaint[],
  ): Promise<string | null> {
    let destination: StorefrontDestination;
    switch (ad.destination) {
      case 'product': {
        const product = await this.drafts.findProduct(
          orgId,
          storeId,
          ad.destinationProductId!,
        );
        if (!product || product.status !== 'active') {
          complaints.push({
            adIndex: index,
            field: 'destination',
            message: product
              ? 'That product is not on sale, so its page is not on the storefront. Publish it, or point the ad somewhere else.'
              : 'That product is no longer in the catalogue. Choose another.',
          });
          return null;
        }
        destination = { kind: 'product', slug: product.slug };
        break;
      }
      case 'custom':
        destination = { kind: 'custom', path: ad.destinationPath! };
        break;
      default:
        destination = { kind: ad.destination };
    }

    try {
      return resolveStorefrontUrl(storefront, destination);
    } catch (error) {
      if (!(error instanceof StorefrontUrlError)) throw error;
      complaints.push({
        adIndex: index,
        field: 'destination',
        message: error.message,
      });
      return null;
    }
  }
}
