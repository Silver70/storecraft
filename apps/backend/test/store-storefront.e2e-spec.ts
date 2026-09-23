/**
 * Where a Store's storefront lives, end to end through the admin REST API.
 *
 * The unit spec beside the util already covers the URL rules exhaustively.
 * What is asserted here is what only a running application can prove: that the
 * settings survive a round trip through a real database in the one normalized
 * form, that a bad value comes back as a 400 a merchant can read rather than a
 * 500, that writing them needs the same permission as every other Store
 * setting, and that one tenant cannot resolve a link on another's storefront.
 *
 * Production wiring against local Postgres throughout.
 */
import type { INestApplication } from '@nestjs/common';
import type request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './helpers/test-app';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

type StorefrontSettingsBody = {
  storefrontUrl: string | null;
  productPathPattern: string;
  canBuildLinks: boolean;
  missing: string[];
};

describe('Store storefront settings (e2e)', () => {
  let app: INestApplication<App>;
  let fixture: AdminFixture;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    fixture = await seedAdmin(app);
  });

  afterEach(async () => {
    await destroyAdmin(app, fixture);
  });

  const store = () => `/stores/${fixture.storeId}`;

  /** The Store row, as the settings screen reads it. */
  async function readStore(): Promise<StorefrontSettingsBody> {
    const res = await fixture.admin.client.get(store()).expect(200);
    return res.body as StorefrontSettingsBody;
  }

  /** The storefront panel: the two settings plus what is still missing. */
  async function readStorefront(): Promise<StorefrontSettingsBody> {
    const res = await fixture.admin.client
      .get(`${store()}/storefront`)
      .expect(200);
    return res.body as StorefrontSettingsBody;
  }

  /** The URL a destination resolves to, as the campaign form asks for it. */
  async function resolve(body: unknown): Promise<string> {
    const res = await fixture.admin.client
      .post(`${store()}/storefront/resolve`, body)
      .expect(200);
    return (res.body as { url: string }).url;
  }

  /** The reason a write or a destination was refused. */
  async function refusal(req: request.Test): Promise<string> {
    const res = await req;
    return (res.body as { message: string }).message;
  }

  // ─── The settings ─────────────────────────────────────────────────────────

  it('starts with no storefront URL and the Starter Storefront pattern', async () => {
    const body = await readStore();

    expect(body.storefrontUrl).toBeNull();
    expect(body.productPathPattern).toBe('/products/{slug}');
  });

  it('says links cannot be built yet, and what is missing', async () => {
    expect(await readStorefront()).toMatchObject({
      storefrontUrl: null,
      productPathPattern: '/products/{slug}',
      canBuildLinks: false,
      missing: ['storefrontUrl'],
    });
  });

  it('stores both settings, normalized, and reports itself ready', async () => {
    await fixture.admin.client
      .patch(store(), {
        storefrontUrl: 'https://shop.example.com/',
        productPathPattern: 'p/{slug}/',
      })
      .expect(200);

    expect(await readStorefront()).toMatchObject({
      storefrontUrl: 'https://shop.example.com',
      productPathPattern: '/p/{slug}',
      canBuildLinks: true,
      missing: [],
    });
  });

  it('refuses a storefront URL that is not an absolute web address', async () => {
    const message = await refusal(
      fixture.admin.client
        .patch(store(), { storefrontUrl: 'shop.example.com' })
        .expect(400),
    );

    expect(message).toMatch(/not a valid URL/i);
  });

  it('refuses a storefront URL carrying a query string or a fragment', async () => {
    await fixture.admin.client
      .patch(store(), { storefrontUrl: 'https://shop.example.com?ref=ad' })
      .expect(400);

    await fixture.admin.client
      .patch(store(), { storefrontUrl: 'https://shop.example.com/#top' })
      .expect(400);
  });

  it('refuses a product path with no slug placeholder, and says which', async () => {
    const message = await refusal(
      fixture.admin.client
        .patch(store(), { productPathPattern: '/products' })
        .expect(400),
    );

    expect(message).toMatch(/\{slug\}/);
  });

  it('leaves the settings untouched when a write is refused', async () => {
    await fixture.admin.client
      .patch(store(), { storefrontUrl: 'https://shop.example.com' })
      .expect(200);

    await fixture.admin.client
      .patch(store(), { storefrontUrl: 'not-a-url' })
      .expect(400);

    expect((await readStore()).storefrontUrl).toBe('https://shop.example.com');
  });

  it('clears the storefront URL when sent an empty value', async () => {
    await fixture.admin.client
      .patch(store(), { storefrontUrl: 'https://shop.example.com' })
      .expect(200);

    await fixture.admin.client
      .patch(store(), { storefrontUrl: '' })
      .expect(200);

    expect((await readStore()).storefrontUrl).toBeNull();
  });

  // ─── Resolving a destination ──────────────────────────────────────────────

  describe('with a storefront set', () => {
    beforeEach(async () => {
      await fixture.admin.client
        .patch(store(), { storefrontUrl: 'https://shop.example.com' })
        .expect(200);
    });

    it('builds a product URL, the all-products page and the home page', async () => {
      expect(await resolve({ kind: 'product', slug: 'linen-shirt' })).toBe(
        'https://shop.example.com/products/linen-shirt',
      );
      expect(await resolve({ kind: 'all_products' })).toBe(
        'https://shop.example.com/products',
      );
      expect(await resolve({ kind: 'home' })).toBe('https://shop.example.com/');
    });

    it('follows the product path pattern the merchant set', async () => {
      await fixture.admin.client
        .patch(store(), { productPathPattern: '/shop/item-{slug}' })
        .expect(200);

      expect(await resolve({ kind: 'product', slug: 'linen-shirt' })).toBe(
        'https://shop.example.com/shop/item-linen-shirt',
      );
    });

    it('accepts a custom path on the storefront', async () => {
      expect(await resolve({ kind: 'custom', path: '/summer-sale' })).toBe(
        'https://shop.example.com/summer-sale',
      );
    });

    it('refuses a destination off the storefront, saying why', async () => {
      const message = await refusal(
        fixture.admin.client
          .post(`${store()}/storefront/resolve`, {
            kind: 'custom',
            path: 'https://facebook.com/my-page',
          })
          .expect(400),
      );

      expect(message).toMatch(/your own storefront/i);
      expect(message).toMatch(/measure/i);
    });
  });

  it('refuses to build a link at all while the storefront URL is unset', async () => {
    const message = await refusal(
      fixture.admin.client
        .post(`${store()}/storefront/resolve`, { kind: 'home' })
        .expect(400),
    );

    expect(message).toMatch(/no storefront URL set/i);
  });

  // ─── Permission and tenancy ───────────────────────────────────────────────

  it('needs the same permission as every other Store setting to write', async () => {
    const manager = await fixture.addUser('product_manager');

    await manager.client
      .patch(store(), { storefrontUrl: 'https://shop.example.com' })
      .expect(403);

    // But a campaign builder may still read where the storefront lives, since
    // that is what every ad destination is resolved against.
    await manager.client.get(`${store()}/storefront`).expect(200);
  });

  it('keeps one store’s storefront out of another store’s links', async () => {
    const other = await fixture.addStore();

    await fixture.admin.client
      .patch(store(), { storefrontUrl: 'https://shop.example.com' })
      .expect(200);

    // The second store has no storefront of its own, so it cannot borrow the
    // first one's — these settings are per Store, not per Organization.
    await other.client
      .post(`/stores/${other.storeId}/storefront/resolve`, { kind: 'home' })
      .expect(400);
  });

  it('is unreachable from another Organization', async () => {
    const outsider = await seedAdmin(app);

    try {
      await fixture.admin.client
        .patch(store(), { storefrontUrl: 'https://shop.example.com' })
        .expect(200);

      // Same store id, a token minted in a different Organization.
      await outsider.admin.client.get(store()).expect(404);
      await outsider.admin.client
        .post(`${store()}/storefront/resolve`, { kind: 'home' })
        .expect(404);
    } finally {
      await destroyAdmin(app, outsider);
    }
  });
});
