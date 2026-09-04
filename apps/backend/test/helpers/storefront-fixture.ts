/**
 * Seeds the minimum a storefront purchase needs — an Organization, a Store, an
 * API key, a product with one variant in stock, and a shipping method — and
 * removes all of it afterwards.
 *
 * Teardown is a single delete of the Organization row. Every tenant-scoped
 * table cascades from it, so nothing the fixture (or the flow under test)
 * created can survive. Slugs and SKUs are unique per fixture, so two runs never
 * collide and residue from a crashed run never fails the next one.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../../src/shared/database/database.module';
import { ApiKeyService } from '../../src/modules/auth/services/api-key.service';
import {
  inventoryItems,
  organizations,
  productVariants,
  products,
  shippingMethods,
  shippingZones,
  stores,
} from '../../src/shared/database/schema';
import { TEST_ORG_SLUG_PREFIX } from './test-env';
import { StorefrontClient } from './storefront-client';

export interface SeedStorefrontOptions {
  /** Unit price of the seeded variant, in minor units. */
  variantPrice?: number;
  /** Flat shipping price, in minor units. */
  shippingPrice?: number;
  /** Units of the variant on hand. */
  stockQuantity?: number;
  /**
   * Cost price of the seeded variant, in minor units. Omitted by default,
   * because that is the state most stores are actually in — `cost_price` is
   * nullable and merchants fill it in late, and a fixture that always set one
   * would hide every path that has to cope without it.
   */
  variantCostPrice?: number;
  currency?: string;
}

export interface StorefrontFixture {
  organizationId: string;
  storeId: string;
  apiKey: string;
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  variantPrice: number;
  /** What the seeded variant costs, or null where no cost price was set. */
  variantCostPrice: number | null;
  shippingMethodId: string;
  shippingPrice: number;
  currency: string;
  /** A storefront API client already authenticated as this fixture's Store. */
  storefront: StorefrontClient;
}

export async function seedStorefront(
  app: INestApplication<App>,
  options: SeedStorefrontOptions = {},
): Promise<StorefrontFixture> {
  const {
    variantPrice = 2500,
    shippingPrice = 500,
    stockQuantity = 100,
    variantCostPrice = null,
    currency = 'USD',
  } = options;

  const db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  const unique = randomUUID().slice(0, 8);

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `E2E Org ${unique}`,
      slug: `${TEST_ORG_SLUG_PREFIX}${unique}`,
      currency,
    })
    .returning();

  const [store] = await db
    .insert(stores)
    .values({
      organizationId: organization.id,
      name: `E2E Store ${unique}`,
      slug: `store-${unique}`,
      currency,
    })
    .returning();

  const productName = `E2E Product ${unique}`;
  const [product] = await db
    .insert(products)
    .values({
      organizationId: organization.id,
      storeId: store.id,
      name: productName,
      slug: `product-${unique}`,
      status: 'active',
    })
    .returning();

  const sku = `E2E-SKU-${unique}`;
  const [variant] = await db
    .insert(productVariants)
    .values({
      organizationId: organization.id,
      storeId: store.id,
      productId: product.id,
      sku,
      name: 'Default',
      price: variantPrice,
      costPrice: variantCostPrice,
    })
    .returning();

  await db.insert(inventoryItems).values({
    organizationId: organization.id,
    storeId: store.id,
    variantId: variant.id,
    quantity: stockQuantity,
  });

  const [zone] = await db
    .insert(shippingZones)
    .values({
      organizationId: organization.id,
      storeId: store.id,
      name: 'E2E Zone',
      countries: ['US'],
      isDefault: true,
    })
    .returning();

  const [method] = await db
    .insert(shippingMethods)
    .values({
      organizationId: organization.id,
      storeId: store.id,
      zoneId: zone.id,
      name: 'Standard',
      rateType: 'flat_rate',
      price: shippingPrice,
    })
    .returning();

  // Issued through the real service so the key the tests send is hashed and
  // looked up exactly as a merchant's would be.
  const { rawKey } = await app
    .get(ApiKeyService)
    .generate(organization.id, store.id, `e2e-${unique}`);

  return {
    organizationId: organization.id,
    storeId: store.id,
    apiKey: rawKey,
    productId: product.id,
    variantId: variant.id,
    sku,
    productName,
    variantPrice,
    variantCostPrice,
    shippingMethodId: method.id,
    shippingPrice,
    currency,
    storefront: new StorefrontClient(app, rawKey),
  };
}

/** Removes a fixture and everything created under it. */
export async function destroyStorefront(
  app: INestApplication<App>,
  organizationId: string,
): Promise<void> {
  const db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}
