import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './helpers/test-app';
import {
  seedAdmin,
  destroyAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';
import { StorefrontClient } from './helpers/storefront-client';
import { ApiKeyService } from '../src/modules/auth/services/api-key.service';

describe('Inline product-name commits (e2e)', () => {
  let app: INestApplication<App>;
  let fixture: AdminFixture;
  let storefront: StorefrontClient;
  let productId: string;
  const original = 'Original product name';

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    fixture = await seedAdmin(app);
    const key = await app
      .get(ApiKeyService)
      .generate(fixture.organizationId, fixture.storeId, 'Inline edit test');
    storefront = new StorefrontClient(app, key.rawKey);
    const created = await fixture.admin.client
      .post('/products', {
        name: original,
        status: 'active',
        variants: [{ price: 1000 }],
      })
      .expect(201);
    productId = (created.body as { id: string }).id;
  });
  afterEach(async () => {
    if (fixture) await destroyAdmin(app, fixture);
  });

  async function publicName() {
    const data = await storefront.query<{ product: { name: string } }>(
      'query($id: ID!) { product(id: $id) { name } }',
      { id: productId },
    );
    return data.product.name;
  }

  it('uses the existing endpoint and immediately exposes the saved name to shoppers', async () => {
    const manager = await fixture.addUser('product_manager');
    const saved = await manager.client
      .patch(`/products/${productId}`, { name: 'Renamed product' })
      .expect(200);
    expect(saved.body).toMatchObject({
      id: productId,
      name: 'Renamed product',
    });
    expect(await publicName()).toBe('Renamed product');
    const publicBySlug = await storefront.query<{
      product: { id: string; name: string };
    }>('query($slug: String!) { product(slug: $slug) { id name } }', {
      slug: (saved.body as { slug: string }).slug,
    });
    expect(publicBySlug.product).toEqual({
      id: productId,
      name: 'Renamed product',
    });
  });

  it('refuses a support agent without changing the stored name', async () => {
    const support = await fixture.addUser('support_agent');
    const config = await support.client.get('/inline-edit').expect(200);
    expect(config.body).toMatchObject({ canEditProducts: false });
    await support.client
      .patch(`/products/${productId}`, { name: 'Unauthorized' })
      .expect(403);
    expect(await publicName()).toBe(original);
  });

  it('leaves the stored value untouched after failed validation and accepts a retry', async () => {
    await fixture.admin.client
      .patch(`/products/${productId}`, { name: 'x'.repeat(256) })
      .expect(400);
    expect(await publicName()).toBe(original);
    await fixture.admin.client
      .patch(`/products/${productId}`, { name: 'Valid retry' })
      .expect(200);
    expect(await publicName()).toBe('Valid retry');
  });

  it('cannot commit a target in another Organization or Store', async () => {
    const other = await seedAdmin(app);
    try {
      await other.admin.client
        .patch(`/products/${productId}`, { name: 'Other tenant' })
        .expect(404);
      const otherStore = await fixture.addStore();
      await otherStore.client
        .patch(`/products/${productId}`, { name: 'Other store' })
        .expect(404);
      expect(await publicName()).toBe(original);
    } finally {
      await destroyAdmin(app, other);
    }
  });

  it('resolves the editor address from the existing backend setting and requires admin auth', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/inline-edit')
      .expect(401);
    const config = await fixture.admin.client.get('/inline-edit').expect(200);
    expect(config.body).toEqual({
      storefrontUrl: app.get(ConfigService).get<string>('STOREFRONT_URL'),
      canEditProducts: true,
    });
    await request(app.getHttpServer())
      .patch(`/api/admin/products/${productId}`)
      .send({ name: 'Anonymous' })
      .expect(401);
    expect(await publicName()).toBe(original);
  });

  it('serves the workspace IIFE publicly at the root with cache validation', async () => {
    const script = await request(app.getHttpServer()).get('/ie.js').expect(200);
    expect(script.headers['content-type']).toContain('application/javascript');
    expect(script.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(script.text).toContain('commerce-inline-edit');
    await request(app.getHttpServer())
      .get('/ie.js')
      .set('If-None-Match', script.headers.etag)
      .expect(304);
  });
});
