/**
 * Campaign management, end to end through the admin REST API.
 *
 * A Campaign is the unit money is attributed to, so the properties worth
 * asserting are the ones that would silently corrupt a revenue report if they
 * broke: that a campaign gets a tag unique within its store, that it matches
 * that tag without anyone authoring a rule, that the tag survives a rename,
 * that archiving hides it without destroying it, and that none of it is visible
 * across an organization boundary. Everything runs against the real application
 * and a local Postgres database, and asserts on the rows as persisted.
 */
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { App } from 'supertest/types';
import request from 'supertest';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  campaignMatchingRules,
  campaigns,
} from '../src/shared/database/schema';
import type { Campaign } from '../src/shared/database/schema';
import { createTestApp } from './helpers/test-app';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

describe('Admin campaigns (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let fixture: AdminFixture;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    fixture = await seedAdmin(app);
  });

  afterEach(async () => {
    await destroyAdmin(app, fixture);
  });

  /** Creates a campaign through the API and returns the created row. */
  async function createCampaign(
    body: Record<string, unknown>,
  ): Promise<Campaign> {
    const res = await fixture.admin.client.post('/campaigns', body).expect(201);
    return res.body as Campaign;
  }

  describe('creating', () => {
    it('creates a campaign with a name and platform and lists it', async () => {
      const created = await createCampaign({
        name: 'Summer Sale 2026',
        platform: 'meta',
      });

      expect(created).toMatchObject({
        name: 'Summer Sale 2026',
        platform: 'meta',
        status: 'active',
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
      });

      const list = await fixture.admin.client.get('/campaigns').expect(200);
      expect(list.body).toEqual([expect.objectContaining({ id: created.id })]);
    });

    it('assigns a canonical tag derived from the name', async () => {
      const created = await createCampaign({
        name: 'Summer Sale 2026',
        platform: 'meta',
      });

      expect(created.tag).toBe('summer-sale-2026');
    });

    it('keeps the tag unique within the store', async () => {
      const first = await createCampaign({ name: 'Spring', platform: 'meta' });
      const second = await createCampaign({
        name: 'Spring',
        platform: 'google',
      });

      expect(first.tag).toBe('spring');
      expect(second.tag).toBe('spring-2');
    });

    it('lets two stores each hold the same tag', async () => {
      // Uniqueness is per store, not global — two merchants, and one merchant's
      // two stores, must be able to run a campaign of the same name.
      const other = await seedAdmin(app);
      try {
        const mine = await createCampaign({ name: 'Spring', platform: 'meta' });
        const theirs = await other.admin.client
          .post('/campaigns', { name: 'Spring', platform: 'meta' })
          .expect(201);

        expect((theirs.body as Campaign).tag).toBe(mine.tag);
      } finally {
        await destroyAdmin(app, other);
      }
    });

    it('matches its own canonical tag with no rule authored by hand', async () => {
      const created = await createCampaign({
        name: 'Summer Sale 2026',
        platform: 'meta',
      });

      const rules = await db
        .select()
        .from(campaignMatchingRules)
        .where(eq(campaignMatchingRules.campaignId, created.id));

      expect(rules).toEqual([
        expect.objectContaining({
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          field: 'utm_campaign',
          operator: 'equals',
          value: created.tag,
          isCanonical: true,
        }),
      ]);
    });

    it('rejects a campaign with no platform', async () => {
      await fixture.admin.client
        .post('/campaigns', { name: 'No platform' })
        .expect(400);
    });
  });

  describe('editing', () => {
    it('updates the name, platform and ad-platform id', async () => {
      const created = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });

      const res = await fixture.admin.client
        .patch(`/campaigns/${created.id}`, {
          name: 'Summer Sale (renamed)',
          platform: 'tiktok',
          externalId: '1234567890',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Summer Sale (renamed)',
        platform: 'tiktok',
        externalId: '1234567890',
      });

      const [row] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, created.id));
      expect(row).toMatchObject({
        name: 'Summer Sale (renamed)',
        platform: 'tiktok',
        externalId: '1234567890',
      });
    });

    it('keeps the canonical tag across a rename', async () => {
      // A tag already pasted into an ad platform cannot be recalled: re-deriving
      // it from the new name would orphan every ad running under the old one.
      const created = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });

      const res = await fixture.admin.client
        .patch(`/campaigns/${created.id}`, { name: 'Autumn Sale' })
        .expect(200);

      expect((res.body as Campaign).tag).toBe(created.tag);

      const [rule] = await db
        .select()
        .from(campaignMatchingRules)
        .where(eq(campaignMatchingRules.campaignId, created.id));
      expect(rule.value).toBe(created.tag);
    });

    it('refuses to take a tag in an update at all', async () => {
      const created = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });

      await fixture.admin.client
        .patch(`/campaigns/${created.id}`, { tag: 'something-else' })
        .expect(400);
    });
  });

  describe('archiving', () => {
    it('removes an archived campaign from the active list but keeps it', async () => {
      const created = await createCampaign({
        name: 'Spring',
        platform: 'meta',
      });

      const archived = await fixture.admin.client
        .post(`/campaigns/${created.id}/archive`)
        .expect(201);
      expect(archived.body).toMatchObject({ status: 'archived' });
      expect((archived.body as Campaign).archivedAt).not.toBeNull();

      const active = await fixture.admin.client.get('/campaigns').expect(200);
      expect(active.body).toEqual([]);

      // Still there, and still retrievable by id and by status.
      await fixture.admin.client.get(`/campaigns/${created.id}`).expect(200);
      const archivedList = await fixture.admin.client
        .get('/campaigns?status=archived')
        .expect(200);
      expect(archivedList.body).toEqual([
        expect.objectContaining({ id: created.id }),
      ]);

      const all = await fixture.admin.client
        .get('/campaigns?status=all')
        .expect(200);
      expect(all.body).toHaveLength(1);
    });

    it('returns an archived campaign to the active list', async () => {
      const created = await createCampaign({
        name: 'Spring',
        platform: 'meta',
      });
      await fixture.admin.client
        .post(`/campaigns/${created.id}/archive`)
        .expect(201);

      const restored = await fixture.admin.client
        .post(`/campaigns/${created.id}/unarchive`)
        .expect(201);
      expect(restored.body).toMatchObject({
        status: 'active',
        archivedAt: null,
      });

      const active = await fixture.admin.client.get('/campaigns').expect(200);
      expect(active.body).toHaveLength(1);
    });

    it('offers no way to delete a campaign', async () => {
      // Attribution is resolved from a campaign's rules at read time, so a
      // deleted campaign would move revenue that has already been reported into
      // Unattributed. Archiving is the only retirement path.
      const created = await createCampaign({
        name: 'Spring',
        platform: 'meta',
      });

      await fixture.admin.client.delete(`/campaigns/${created.id}`).expect(404);

      const [row] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, created.id));
      expect(row).toBeDefined();
    });
  });

  describe('tenancy', () => {
    it('never shows a campaign outside the organization that owns it', async () => {
      const other = await seedAdmin(app);
      try {
        const mine = await createCampaign({
          name: 'Summer Sale',
          platform: 'meta',
        });

        await other.admin.client.get(`/campaigns/${mine.id}`).expect(404);
        await other.admin.client
          .patch(`/campaigns/${mine.id}`, { name: 'Stolen' })
          .expect(404);
        await other.admin.client
          .post(`/campaigns/${mine.id}/archive`)
          .expect(404);

        const theirList = await other.admin.client
          .get('/campaigns?status=all')
          .expect(200);
        expect(theirList.body).toEqual([]);

        // And nothing they attempted touched the row.
        const [row] = await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, mine.id));
        expect(row).toMatchObject({ name: 'Summer Sale', status: 'active' });
      } finally {
        await destroyAdmin(app, other);
      }
    });

    it('scopes a campaign to the store it was created in', async () => {
      // Same organization, same admin, different store: an admin who can
      // legitimately reach both must still not see one store's campaigns while
      // working in the other.
      const created = await createCampaign({
        name: 'Spring',
        platform: 'meta',
      });
      const second = await fixture.addStore();

      const list = await second.client.get('/campaigns?status=all').expect(200);
      expect(list.body).toEqual([]);
      await second.client.get(`/campaigns/${created.id}`).expect(404);
      const [row] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.id, created.id),
            eq(campaigns.organizationId, fixture.organizationId),
            eq(campaigns.storeId, fixture.storeId),
          ),
        );
      expect(row).toBeDefined();
    });
  });

  describe('permissions', () => {
    it('rejects a request carrying no admin token', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/campaigns')
        .expect(401);
    });

    it('lets a product manager manage campaigns', async () => {
      const pm = await fixture.addUser('product_manager');

      const created = await pm.client
        .post('/campaigns', { name: 'PM Campaign', platform: 'google' })
        .expect(201);
      await pm.client.get('/campaigns').expect(200);
      await pm.client
        .post(`/campaigns/${(created.body as Campaign).id}/archive`)
        .expect(201);
    });

    it('refuses a support agent, who has no marketing permission', async () => {
      const created = await createCampaign({
        name: 'Spring',
        platform: 'meta',
      });
      const support = await fixture.addUser('support_agent');

      await support.client.get('/campaigns').expect(403);
      await support.client
        .post('/campaigns', { name: 'Nope', platform: 'meta' })
        .expect(403);
      await support.client
        .patch(`/campaigns/${created.id}`, { name: 'Nope' })
        .expect(403);
      await support.client.post(`/campaigns/${created.id}/archive`).expect(403);
    });
  });
});
