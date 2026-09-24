import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import {
  productMedia,
  products,
  type productStatusEnum,
} from '../../../shared/database/schema';

type ProductStatus = (typeof productStatusEnum.enumValues)[number];

/** A product an ad can point at, as a destination needs it. */
export interface DestinationProduct {
  slug: string;
  status: ProductStatus;
}

/**
 * What a campaign draft reads from the catalogue: the product an ad points at,
 * and the product photograph an ad is made from.
 *
 * Both are looked up by id within the tenant rather than taken from the
 * request. A draft names a product, not a URL, so an ad can only ever show one
 * of this Store's own images and link to one of this Store's own products.
 */
@Injectable()
export class CampaignDraftRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findProduct(
    orgId: string,
    storeId: string,
    productId: string,
  ): Promise<DestinationProduct | null> {
    const [row] = await this.db
      .select({ slug: products.slug, status: products.status })
      .from(products)
      .where(
        and(
          eq(products.id, productId),
          eq(products.organizationId, orgId),
          eq(products.storeId, storeId),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** The public URL of one of this Store's product images, or null. */
  async findProductImage(
    orgId: string,
    storeId: string,
    mediaId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ url: productMedia.url })
      .from(productMedia)
      .innerJoin(products, eq(products.id, productMedia.productId))
      .where(
        and(
          eq(productMedia.id, mediaId),
          eq(productMedia.organizationId, orgId),
          eq(productMedia.storeId, storeId),
          eq(productMedia.mediaType, 'image'),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);
    return row?.url ?? null;
  }
}
