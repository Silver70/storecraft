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
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import type { App } from 'supertest/types';
import request from 'supertest';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  ads,
  campaignMatchingRules,
  campaigns,
} from '../src/shared/database/schema';
import type {
  Ad,
  Campaign,
  CampaignMatchingRule,
} from '../src/shared/database/schema';
import { CampaignService } from '../src/modules/marketing/services/campaign.service';
import { isUniqueViolation } from '../src/shared/database/db-error.util';
import type { AttributionTuple } from '../src/modules/marketing/utils/campaign-matching.util';
import { createTestApp } from './helpers/test-app';
import type { FakeStorageService } from './helpers/fake-storage.service';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

describe('Admin campaigns (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let fixture: AdminFixture;
  let storage: FakeStorageService;

  beforeAll(async () => {
    ({ app, storage } = await createTestApp());
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

  describe('matching rules', () => {
    /**
     * Resolves an attribution tuple the way a report will: through the service,
     * over the rules actually persisted for one organization and store.
     *
     * Matching has no HTTP surface of its own until attributed revenue lands, so
     * these assertions reach one layer in. They are still behavioural — real
     * rows, real scoping, and the answer a merchant's report would print.
     */
    async function resolve(
      tuple: AttributionTuple,
      orgId = fixture.organizationId,
      storeId = fixture.storeId,
    ): Promise<string | null> {
      const matcher = await app
        .get(CampaignService)
        .buildMatcher(orgId, storeId);
      return matcher(tuple)?.campaignId ?? null;
    }

    async function addRule(
      campaignId: string,
      body: Record<string, unknown>,
    ): Promise<CampaignMatchingRule> {
      const res = await fixture.admin.client
        .post(`/campaigns/${campaignId}/rules`, body)
        .expect(201);
      return res.body as CampaignMatchingRule;
    }

    it('adds a rule and lists it after the campaign’s own tag rule', async () => {
      const campaign = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });

      const rule = await addRule(campaign.id, {
        field: 'utm_source',
        operator: 'equals',
        value: 'instagram',
      });

      expect(rule).toMatchObject({
        campaignId: campaign.id,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        field: 'utm_source',
        operator: 'equals',
        value: 'instagram',
        isCanonical: false,
      });

      const list = await fixture.admin.client
        .get(`/campaigns/${campaign.id}/rules`)
        .expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ value: campaign.tag, isCanonical: true }),
        expect.objectContaining({ id: rule.id }),
      ]);
    });

    it('claims every variant of the value the links actually went out with', async () => {
      // The whole point of the feature: one push tagged inconsistently is one
      // campaign, not three each looking a third as profitable as it was.
      const campaign = await createCampaign({
        name: 'Summer Push 2026',
        platform: 'meta',
      });
      await addRule(campaign.id, {
        field: 'utm_campaign',
        operator: 'equals',
        value: 'Summer_Sale',
      });

      for (const utmCampaign of [
        'summer_sale',
        'Summer-Sale',
        'summer sale',
        '  SUMMER-SALE  ',
      ]) {
        await expect(resolve({ utmCampaign })).resolves.toBe(campaign.id);
      }
    });

    it('reduces a pasted referrer URL to the host it means', async () => {
      const campaign = await createCampaign({
        name: 'Instagram Bio',
        platform: 'instagram',
      });

      const rule = await addRule(campaign.id, {
        field: 'referrer_host',
        operator: 'equals',
        value: 'https://www.instagram.com/p/abc123/',
      });
      expect(rule.value).toBe('instagram.com');

      await expect(
        resolve({ referrer: 'https://instagram.com/stories/xyz' }),
      ).resolves.toBe(campaign.id);
    });

    it('refuses a rule that already means the same as one on the campaign', async () => {
      const campaign = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });
      await addRule(campaign.id, {
        field: 'utm_source',
        operator: 'equals',
        value: 'paid_social',
      });

      await fixture.admin.client
        .post(`/campaigns/${campaign.id}/rules`, {
          field: 'utm_source',
          operator: 'equals',
          value: 'Paid-Social',
        })
        .expect(409);

      // Including the tag rule it was created with.
      await fixture.admin.client
        .post(`/campaigns/${campaign.id}/rules`, {
          field: 'utm_campaign',
          operator: 'equals',
          value: campaign.tag.toUpperCase(),
        })
        .expect(409);
    });

    it('refuses a rule value that could never match a visit', async () => {
      const campaign = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });

      await fixture.admin.client
        .post(`/campaigns/${campaign.id}/rules`, {
          field: 'utm_source',
          operator: 'equals',
          value: '---',
        })
        .expect(400);
      await fixture.admin.client
        .post(`/campaigns/${campaign.id}/rules`, {
          field: 'utm_source',
          operator: 'equals',
          value: '   ',
        })
        .expect(400);
    });

    it('removes a rule, and the traffic it claimed goes back to unattributed', async () => {
      const campaign = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });
      const rule = await addRule(campaign.id, {
        field: 'utm_source',
        operator: 'equals',
        value: 'instagram',
      });
      await expect(resolve({ utmSource: 'Instagram' })).resolves.toBe(
        campaign.id,
      );

      await fixture.admin.client
        .delete(`/campaigns/${campaign.id}/rules/${rule.id}`)
        .expect(204);

      await expect(resolve({ utmSource: 'Instagram' })).resolves.toBeNull();
      const rows = await db
        .select()
        .from(campaignMatchingRules)
        .where(eq(campaignMatchingRules.campaignId, campaign.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].isCanonical).toBe(true);
    });

    it('will not remove the campaign’s own tag rule', async () => {
      // Every link generated from the campaign carries that tag: removing the
      // rule would unattribute every ad already running under it.
      const campaign = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });
      const [canonical] = await db
        .select()
        .from(campaignMatchingRules)
        .where(eq(campaignMatchingRules.campaignId, campaign.id));

      await fixture.admin.client
        .delete(`/campaigns/${campaign.id}/rules/${canonical.id}`)
        .expect(409);

      await expect(resolve({ utmCampaign: campaign.tag })).resolves.toBe(
        campaign.id,
      );
    });

    it('resolves to unattributed rather than erroring when nothing claims a tuple', async () => {
      // A store with no campaigns at all — an empty rule set is unattributed,
      // not a failure.
      await expect(resolve({ utmCampaign: 'anything' })).resolves.toBeNull();

      await createCampaign({ name: 'Summer Sale', platform: 'meta' });
      await expect(resolve({ utmCampaign: 'winter-sale' })).resolves.toBeNull();
      await expect(resolve({})).resolves.toBeNull();
    });

    it('lets the documented precedence decide when two campaigns could claim a tuple', async () => {
      const older = await createCampaign({ name: 'Spring', platform: 'meta' });
      const newer = await createCampaign({ name: 'Summer', platform: 'meta' });
      await addRule(older.id, {
        field: 'utm_source',
        operator: 'equals',
        value: 'instagram',
      });
      await addRule(newer.id, {
        field: 'utm_campaign',
        operator: 'starts_with',
        value: 'summer',
      });

      // A campaign-field rule outranks a source rule, even a broader one on a
      // campaign created later.
      await expect(
        resolve({ utmCampaign: 'summer-sale', utmSource: 'instagram' }),
      ).resolves.toBe(newer.id);

      // With no campaign tag to go on, the source rule claims it.
      await expect(resolve({ utmSource: 'instagram' })).resolves.toBe(older.id);
    });

    describe('tenancy', () => {
      it('never lets one organization’s rules claim another’s traffic', async () => {
        const other = await seedAdmin(app);
        try {
          const mine = await createCampaign({
            name: 'Summer Sale',
            platform: 'meta',
          });
          const theirsRes = await other.admin.client
            .post('/campaigns', { name: 'Summer Sale', platform: 'meta' })
            .expect(201);
          const theirs = theirsRes.body as Campaign;
          expect(theirs.tag).toBe(mine.tag);

          // The same tuple resolves to each merchant's own campaign, and never
          // to the other's, even though both stores tagged it identically.
          await expect(resolve({ utmCampaign: 'summer-sale' })).resolves.toBe(
            mine.id,
          );
          await expect(
            resolve(
              { utmCampaign: 'summer-sale' },
              other.organizationId,
              other.storeId,
            ),
          ).resolves.toBe(theirs.id);
        } finally {
          await destroyAdmin(app, other);
        }
      });

      it('hides another organization’s rules from every verb', async () => {
        const other = await seedAdmin(app);
        try {
          const mine = await createCampaign({
            name: 'Summer Sale',
            platform: 'meta',
          });
          const rule = await addRule(mine.id, {
            field: 'utm_source',
            operator: 'equals',
            value: 'instagram',
          });

          await other.admin.client
            .get(`/campaigns/${mine.id}/rules`)
            .expect(404);
          await other.admin.client
            .post(`/campaigns/${mine.id}/rules`, {
              field: 'utm_source',
              operator: 'equals',
              value: 'stolen',
            })
            .expect(404);
          await other.admin.client
            .delete(`/campaigns/${mine.id}/rules/${rule.id}`)
            .expect(404);

          const rows = await db
            .select()
            .from(campaignMatchingRules)
            .where(eq(campaignMatchingRules.campaignId, mine.id));
          expect(rows).toHaveLength(2);
        } finally {
          await destroyAdmin(app, other);
        }
      });

      it('scopes rules to the store, not just the organization', async () => {
        const mine = await createCampaign({
          name: 'Summer Sale',
          platform: 'meta',
        });
        await addRule(mine.id, {
          field: 'utm_source',
          operator: 'equals',
          value: 'instagram',
        });
        const second = await fixture.addStore();

        await second.client.get(`/campaigns/${mine.id}/rules`).expect(404);
        await expect(
          resolve(
            { utmSource: 'instagram' },
            fixture.organizationId,
            second.storeId,
          ),
        ).resolves.toBeNull();
      });
    });
  });

  describe('tagged links', () => {
    /** The storefront a path destination resolves against — read from the
     * running application rather than restated, so the assertion is that the
     * configured storefront was used, not that a literal was matched. */
    const storefront = () =>
      app.get(ConfigService).get<string>('STOREFRONT_URL')!;

    interface TaggedLink {
      url: string;
      destination: string;
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      utmContent: string | null;
      campaignId: string;
      campaignName: string;
    }

    async function generateLink(
      campaignId: string,
      query: Record<string, string>,
    ): Promise<TaggedLink> {
      const params = new URLSearchParams(query).toString();
      const res = await fixture.admin.client
        .get(`/campaigns/${campaignId}/link?${params}`)
        .expect(200);
      return res.body as TaggedLink;
    }

    /** Resolves the link the way a report will: through the persisted rules. */
    async function resolveLink(link: TaggedLink): Promise<string | null> {
      const params = new URL(link.url).searchParams;
      const matcher = await app
        .get(CampaignService)
        .buildMatcher(fixture.organizationId, fixture.storeId);
      return (
        matcher({
          utmCampaign: params.get('utm_campaign'),
          utmSource: params.get('utm_source'),
          utmMedium: params.get('utm_medium'),
        })?.campaignId ?? null
      );
    }

    it('generates a tagged URL for a campaign from a destination, source and medium', async () => {
      const campaign = await createCampaign({
        name: 'Summer Sale',
        platform: 'meta',
      });

      const link = await generateLink(campaign.id, {
        destination: '/products/summer-tee',
        source: 'Instagram',
        medium: 'paid_social',
      });

      expect(new URL(link.url).origin).toBe(storefront());
      expect(new URL(link.url).pathname).toBe('/products/summer-tee');
      expect(link.destination).toBe(`${storefront()}/products/summer-tee`);
      expect(Object.fromEntries(new URL(link.url).searchParams)).toEqual({
        utm_source: 'instagram',
        utm_medium: 'paid-social',
        utm_campaign: campaign.tag,
      });
    });

    it("uses the campaign's canonical tag, which the merchant never types", async () => {
      const campaign = await createCampaign({
        name: 'Été Promo!',
        platform: 'meta',
      });

      const link = await generateLink(campaign.id, {
        source: 'instagram',
        medium: 'paid_social',
      });

      expect(link.utmCampaign).toBe(campaign.tag);
      expect(new URL(link.url).searchParams.get('utm_campaign')).toBe(
        campaign.tag,
      );
    });

    it('attributes to its campaign with no rule authored by hand', async () => {
      const campaign = await createCampaign({
        name: 'Flash Friday',
        platform: 'meta',
      });

      const link = await generateLink(campaign.id, {
        source: 'instagram',
        medium: 'paid_social',
      });

      // The campaign has only the rule it was created with.
      const rules = await fixture.admin.client
        .get(`/campaigns/${campaign.id}/rules`)
        .expect(200);
      expect(rules.body).toHaveLength(1);

      expect(await resolveLink(link)).toBe(campaign.id);
    });

    it('reports several links differing by source or medium as one campaign', async () => {
      // The same push running on more than one platform. Splitting it across
      // buckets would make each half look a fraction as profitable as it was.
      const campaign = await createCampaign({
        name: 'Spring Launch',
        platform: 'meta',
      });

      const links = await Promise.all([
        generateLink(campaign.id, {
          source: 'instagram',
          medium: 'paid_social',
        }),
        generateLink(campaign.id, { source: 'facebook', medium: 'cpc' }),
        generateLink(campaign.id, {
          source: 'newsletter',
          medium: 'email',
          destination: '/collections/spring',
          content: 'Hero Banner',
        }),
      ]);

      expect(links.map((l) => l.utmCampaign)).toEqual([
        campaign.tag,
        campaign.tag,
        campaign.tag,
      ]);
      const resolved = await Promise.all(links.map(resolveLink));
      expect(resolved).toEqual([campaign.id, campaign.id, campaign.id]);
    });

    it('points at any page of the store, not only the home page', async () => {
      const campaign = await createCampaign({ name: 'Deep', platform: 'meta' });

      const home = await generateLink(campaign.id, {
        source: 'instagram',
        medium: 'paid_social',
      });
      const product = await generateLink(campaign.id, {
        destination: '/products/tee?variant=large#reviews',
        source: 'instagram',
        medium: 'paid_social',
      });

      expect(new URL(home.url).pathname).toBe('/');
      expect(new URL(product.url).pathname).toBe('/products/tee');
      // A link to one variant of a product, anchored at its reviews, survives
      // being tagged — that is the whole reason for sending an ad deep.
      expect(new URL(product.url).searchParams.get('variant')).toBe('large');
      expect(new URL(product.url).hash).toBe('#reviews');
    });

    it('labels a creative with utm_content when one is given', async () => {
      const campaign = await createCampaign({
        name: 'Creative Test',
        platform: 'meta',
      });

      const link = await generateLink(campaign.id, {
        source: 'instagram',
        medium: 'paid_social',
        content: 'Video A',
      });

      expect(link.utmContent).toBe('video-a');
      expect(new URL(link.url).searchParams.get('utm_content')).toBe('video-a');
    });

    it('refuses a destination that is not a page of the store', async () => {
      const campaign = await createCampaign({ name: 'Bad', platform: 'meta' });

      await fixture.admin.client
        .get(
          `/campaigns/${campaign.id}/link?source=instagram&medium=paid_social&destination=${encodeURIComponent('javascript:alert(1)')}`,
        )
        .expect(400);
    });

    it('refuses a link with no source or medium to identify it', async () => {
      const campaign = await createCampaign({ name: 'Bare', platform: 'meta' });

      await fixture.admin.client
        .get(`/campaigns/${campaign.id}/link?medium=paid_social`)
        .expect(400);
      await fixture.admin.client
        .get(`/campaigns/${campaign.id}/link?source=instagram&medium=%20`)
        .expect(400);
    });

    it('stores nothing, so the same choices give the same link', async () => {
      // A link is derived from the campaign, which is why one tagged by hand
      // before the campaign existed is still claimable by a rule.
      const campaign = await createCampaign({
        name: 'Stable',
        platform: 'meta',
      });
      const query = { source: 'instagram', medium: 'paid_social' };

      const first = await generateLink(campaign.id, query);
      const second = await generateLink(campaign.id, query);

      expect(second.url).toBe(first.url);
    });

    it('still generates a link for an archived campaign', async () => {
      const campaign = await createCampaign({ name: 'Done', platform: 'meta' });
      await fixture.admin.client
        .post(`/campaigns/${campaign.id}/archive`)
        .expect(201);

      const link = await generateLink(campaign.id, {
        source: 'instagram',
        medium: 'paid_social',
      });
      expect(link.utmCampaign).toBe(campaign.tag);
    });

    it('never generates a link for another organization’s campaign', async () => {
      const other = await seedAdmin(app);
      try {
        const mine = await createCampaign({ name: 'Mine', platform: 'meta' });

        await other.admin.client
          .get(`/campaigns/${mine.id}/link?source=instagram&medium=paid_social`)
          .expect(404);
      } finally {
        await destroyAdmin(app, other);
      }
    });
  });

  /**
   * Ads — the creatives running under one Campaign.
   *
   * The properties asserted here are the ones that would silently corrupt a
   * per-creative report if they broke: that an Ad is born carrying the tag its
   * Orders will later find it by, that the tag is unique inside its Campaign and
   * deliberately *not* inside the Store, that it survives a rename, that
   * archiving cascades one way and not the other, and that none of it — nor the
   * new `utm_content` rule field it introduces — can reach the decision about
   * which Campaign an Order belongs to.
   */
  describe('ads', () => {
    /** A real 1x1 PNG — the smallest honest stand-in for a creative. */
    const PNG_PIXEL = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    async function createAd(
      campaignId: string,
      body: Record<string, unknown>,
    ): Promise<Ad> {
      const res = await fixture.admin.client
        .post(`/campaigns/${campaignId}/ads`, body)
        .expect(201);
      return res.body as Ad;
    }

    async function listAds(campaignId: string, query = ''): Promise<Ad[]> {
      const res = await fixture.admin.client
        .get(`/campaigns/${campaignId}/ads${query}`)
        .expect(200);
      return res.body as Ad[];
    }

    /** The rules persisted for one ad, read from the table rather than an API. */
    async function adRules(adId: string): Promise<CampaignMatchingRule[]> {
      return db
        .select()
        .from(campaignMatchingRules)
        .where(eq(campaignMatchingRules.adId, adId));
    }

    describe('creating', () => {
      it('creates an ad under a campaign and lists it there', async () => {
        const campaign = await createCampaign({
          name: 'Summer Sale',
          platform: 'meta',
        });

        const ad = await createAd(campaign.id, { name: 'Beach video A' });

        expect(ad).toMatchObject({
          name: 'Beach video A',
          campaignId: campaign.id,
          status: 'active',
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          startsAt: null,
          endsAt: null,
        });

        expect(await listAds(campaign.id)).toEqual([
          expect.objectContaining({ id: ad.id }),
        ]);
      });

      it('takes a start date and an end date, and either one alone', async () => {
        // A merchant often knows when a test started and not when it will stop.
        const campaign = await createCampaign({
          name: 'Flights',
          platform: 'meta',
        });

        const both = await createAd(campaign.id, {
          name: 'Both',
          startsAt: '2026-06-01T00:00:00.000Z',
          endsAt: '2026-06-08T00:00:00.000Z',
        });
        expect(new Date(both.startsAt!).toISOString()).toBe(
          '2026-06-01T00:00:00.000Z',
        );
        expect(new Date(both.endsAt!).toISOString()).toBe(
          '2026-06-08T00:00:00.000Z',
        );

        const startOnly = await createAd(campaign.id, {
          name: 'Start only',
          startsAt: '2026-06-01T00:00:00.000Z',
        });
        expect(startOnly.startsAt).not.toBeNull();
        expect(startOnly.endsAt).toBeNull();

        const endOnly = await createAd(campaign.id, {
          name: 'End only',
          endsAt: '2026-06-08T00:00:00.000Z',
        });
        expect(endOnly.startsAt).toBeNull();
        expect(endOnly.endsAt).not.toBeNull();
      });

      it('refuses a flight that ends before it starts', async () => {
        const campaign = await createCampaign({
          name: 'Backwards',
          platform: 'meta',
        });

        await fixture.admin.client
          .post(`/campaigns/${campaign.id}/ads`, {
            name: 'Impossible',
            startsAt: '2026-06-08T00:00:00.000Z',
            endsAt: '2026-06-01T00:00:00.000Z',
          })
          .expect(400);
      });

      it('assigns an ad tag by the same derivation the campaign tag uses', async () => {
        // Both sides of a later comparison have to normalize identically, so the
        // same name has to produce the same slug whichever it is naming.
        const campaign = await createCampaign({
          name: 'Beach Video A',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Beach Video A' });

        expect(ad.tag).toBe('beach-video-a');
        expect(ad.tag).toBe(campaign.tag);
      });

      it('matches its own ad tag on utm_content with no rule authored by hand', async () => {
        const campaign = await createCampaign({
          name: 'Summer Sale',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Beach video A' });

        expect(await adRules(ad.id)).toEqual([
          expect.objectContaining({
            organizationId: fixture.organizationId,
            storeId: fixture.storeId,
            campaignId: campaign.id,
            adId: ad.id,
            field: 'utm_content',
            operator: 'equals',
            value: ad.tag,
            isCanonical: true,
          }),
        ]);
      });

      it('keeps an ad tag unique within its campaign', async () => {
        const campaign = await createCampaign({
          name: 'Summer Sale',
          platform: 'meta',
        });

        const first = await createAd(campaign.id, { name: 'Video A' });
        const second = await createAd(campaign.id, { name: 'Video A' });

        expect(first.tag).toBe('video-a');
        expect(second.tag).toBe('video-a-2');
      });

      it('lets two campaigns each own an ad tagged video-a', async () => {
        // The thing merchants actually do, and the reason ad tags are scoped to
        // the campaign rather than the store. It is only safe because an ad is
        // resolved among its own campaign's ads (ADR-0004).
        const summer = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const spring = await createCampaign({
          name: 'Spring',
          platform: 'google',
        });

        const mine = await createAd(summer.id, { name: 'Video A' });
        const theirs = await createAd(spring.id, { name: 'Video A' });

        expect(mine.tag).toBe('video-a');
        expect(theirs.tag).toBe('video-a');
        expect(theirs.id).not.toBe(mine.id);
      });

      it('leaves the database as the authority on that uniqueness', async () => {
        // Two admins naming an ad the same thing at the same moment must not
        // both win, and the read that precedes the insert cannot promise that —
        // the unique index on (campaign_id, tag) is what does.
        const campaign = await createCampaign({
          name: 'Race',
          platform: 'meta',
        });
        const [ad] = await db
          .select()
          .from(ads)
          .where(eq(ads.campaignId, campaign.id))
          .limit(1);
        expect(ad).toBeUndefined();

        const first = await createAd(campaign.id, { name: 'Video A' });

        // Straight at the table, past the service that picks a free tag: the
        // index is what refuses this, and nothing else could.
        const duplicate = await db
          .insert(ads)
          .values({
            organizationId: fixture.organizationId,
            storeId: fixture.storeId,
            campaignId: campaign.id,
            name: 'Video A again',
            tag: first.tag,
          })
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(duplicate).not.toBeNull();
        expect(isUniqueViolation(duplicate)).toBe(true);
      });

      it('refuses an ad under another organization’s campaign', async () => {
        const other = await seedAdmin(app);
        try {
          const mine = await createCampaign({
            name: 'Mine',
            platform: 'meta',
          });

          await other.admin.client
            .post(`/campaigns/${mine.id}/ads`, { name: 'Stolen' })
            .expect(404);

          expect(
            await db.select().from(ads).where(eq(ads.campaignId, mine.id)),
          ).toEqual([]);
        } finally {
          await destroyAdmin(app, other);
        }
      });
    });

    describe('editing', () => {
      it('updates the name, flight dates and ad-platform id', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });

        const res = await fixture.admin.client
          .patch(`/campaigns/${campaign.id}/ads/${ad.id}`, {
            name: 'Beach video A',
            externalId: '9876543210',
            startsAt: '2026-06-01T00:00:00.000Z',
            endsAt: '2026-06-08T00:00:00.000Z',
          })
          .expect(200);

        expect(res.body).toMatchObject({
          name: 'Beach video A',
          externalId: '9876543210',
        });

        const [row] = await db.select().from(ads).where(eq(ads.id, ad.id));
        expect(row).toMatchObject({
          name: 'Beach video A',
          externalId: '9876543210',
        });
        expect(row.startsAt).not.toBeNull();
        expect(row.endsAt).not.toBeNull();
      });

      it('clears a flight date when it is sent as null', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, {
          name: 'Video A',
          startsAt: '2026-06-01T00:00:00.000Z',
        });

        const res = await fixture.admin.client
          .patch(`/campaigns/${campaign.id}/ads/${ad.id}`, { startsAt: null })
          .expect(200);

        expect((res.body as Ad).startsAt).toBeNull();
      });

      it('refuses an edit that would end a flight before it starts', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, {
          name: 'Video A',
          startsAt: '2026-06-08T00:00:00.000Z',
        });

        await fixture.admin.client
          .patch(`/campaigns/${campaign.id}/ads/${ad.id}`, {
            endsAt: '2026-06-01T00:00:00.000Z',
          })
          .expect(400);
      });

      it('keeps the ad tag across a rename', async () => {
        // A link already running in an ad platform cannot be recalled, so
        // re-deriving the tag from the new name would orphan it.
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });

        const res = await fixture.admin.client
          .patch(`/campaigns/${campaign.id}/ads/${ad.id}`, {
            name: 'Beach video, second cut',
          })
          .expect(200);

        expect((res.body as Ad).tag).toBe(ad.tag);
        expect((await adRules(ad.id))[0].value).toBe(ad.tag);
      });

      it('refuses to take a tag in an update at all', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });

        await fixture.admin.client
          .patch(`/campaigns/${campaign.id}/ads/${ad.id}`, {
            tag: 'something-else',
          })
          .expect(400);
      });
    });

    /**
     * The creative is the picture a merchant recognises an Ad by instead of
     * decoding its slug. It is optional and expected to stay absent for most
     * Ads — permanently for Campaigns on a platform nothing will ever supply an
     * image for — so what is asserted here is that both states are ordinary:
     * an Ad carries one when a merchant uploads one, and reads back as an Ad
     * with none when they do not.
     *
     * Object storage is the in-memory fake, which is also what lets the tenancy
     * case assert the interesting half: a refused upload leaves nothing behind.
     */
    describe('creative', () => {
      function uploadCreative(
        campaignId: string,
        adId: string,
        file: { bytes?: Buffer; filename?: string; contentType?: string } = {},
      ) {
        return fixture.admin.client.attach(
          `/campaigns/${campaignId}/ads/${adId}/creative`,
          'file',
          file.bytes ?? PNG_PIXEL,
          {
            filename: file.filename ?? 'beach-video.png',
            contentType: file.contentType ?? 'image/png',
          },
        );
      }

      /** The ad as persisted, not as an endpoint chose to answer. */
      async function adRow(adId: string): Promise<Ad> {
        const [row] = await db.select().from(ads).where(eq(ads.id, adId));
        return row;
      }

      it('is absent on a new ad, which is a state and not a gap', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });

        expect(ad.creativeUrl).toBeNull();
        expect((await listAds(campaign.id))[0].creativeUrl).toBeNull();
      });

      it('stores an uploaded image and shows it against that ad', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Beach video A' });

        const res = await uploadCreative(campaign.id, ad.id).expect(201);

        const url = (res.body as Ad).creativeUrl;
        expect(url).toEqual(expect.any(String));

        // The bytes reached storage under this ad, with the type they arrived
        // as — and the URL the merchant is shown is the one for that object.
        const object = storage.stored.at(-1)!;
        expect(object.key).toMatch(new RegExp(`^ads/${ad.id}/`));
        expect(object).toMatchObject({
          contentType: 'image/png',
          bytes: PNG_PIXEL.byteLength,
        });
        expect(url).toBe(storage.getPublicUrl(object.key));

        // And it is on the ad wherever the ad is read from.
        const fetched = await fixture.admin.client
          .get(`/campaigns/${campaign.id}/ads/${ad.id}`)
          .expect(200);
        expect((fetched.body as Ad).creativeUrl).toBe(url);
        expect((await listAds(campaign.id))[0].creativeUrl).toBe(url);
        expect((await adRow(ad.id)).creativeUrl).toBe(url);
      });

      it('replaces a creative without touching anything else about the ad', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Beach video A' });

        const first = await uploadCreative(campaign.id, ad.id, {
          filename: 'first.png',
        }).expect(201);
        const second = await uploadCreative(campaign.id, ad.id, {
          filename: 'second.jpg',
          contentType: 'image/jpeg',
        }).expect(201);

        const replaced = second.body as Ad;
        expect(replaced.creativeUrl).not.toBe((first.body as Ad).creativeUrl);
        expect(replaced).toMatchObject({
          name: 'Beach video A',
          tag: ad.tag,
          status: 'active',
        });
        expect((await adRow(ad.id)).creativeUrl).toBe(replaced.creativeUrl);
      });

      it('removes a creative, returning the ad to the state most ads are in', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Beach video A' });
        await uploadCreative(campaign.id, ad.id).expect(201);

        const cleared = await fixture.admin.client
          .delete(`/campaigns/${campaign.id}/ads/${ad.id}/creative`)
          .expect(200);

        // Removing a picture is not retiring a creative: the ad stays active
        // and keeps the tag its live links match on.
        expect(cleared.body).toMatchObject({
          id: ad.id,
          name: 'Beach video A',
          tag: ad.tag,
          status: 'active',
          creativeUrl: null,
        });
        expect((await adRow(ad.id)).creativeUrl).toBeNull();
      });

      it('refuses a file that is not an image, and stores nothing', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });
        const before = storage.stored.length;

        await uploadCreative(campaign.id, ad.id, {
          bytes: Buffer.from('not an image'),
          filename: 'spend.csv',
          contentType: 'text/csv',
        }).expect(400);

        expect(storage.stored.length).toBe(before);
        expect((await adRow(ad.id)).creativeUrl).toBeNull();
      });
    });

    describe('archiving', () => {
      it('removes an archived ad from the active list but keeps it', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });

        const archived = await fixture.admin.client
          .post(`/campaigns/${campaign.id}/ads/${ad.id}/archive`)
          .expect(201);
        expect(archived.body).toMatchObject({ status: 'archived' });
        expect((archived.body as Ad).archivedAt).not.toBeNull();

        expect(await listAds(campaign.id)).toEqual([]);

        await fixture.admin.client
          .get(`/campaigns/${campaign.id}/ads/${ad.id}`)
          .expect(200);
        expect(await listAds(campaign.id, '?status=archived')).toEqual([
          expect.objectContaining({ id: ad.id }),
        ]);
        expect(await listAds(campaign.id, '?status=all')).toHaveLength(1);
      });

      it('returns an archived ad to the active list', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });
        await fixture.admin.client
          .post(`/campaigns/${campaign.id}/ads/${ad.id}/archive`)
          .expect(201);

        const restored = await fixture.admin.client
          .post(`/campaigns/${campaign.id}/ads/${ad.id}/unarchive`)
          .expect(201);
        expect(restored.body).toMatchObject({
          status: 'active',
          archivedAt: null,
        });
        expect(await listAds(campaign.id)).toHaveLength(1);
      });

      it('archives a campaign’s ads along with the campaign', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const first = await createAd(campaign.id, { name: 'Video A' });
        const second = await createAd(campaign.id, { name: 'Video B' });

        await fixture.admin.client
          .post(`/campaigns/${campaign.id}/archive`)
          .expect(201);

        expect(await listAds(campaign.id)).toEqual([]);
        const rows = await db
          .select()
          .from(ads)
          .where(eq(ads.campaignId, campaign.id));
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.status).toBe('archived');
          expect(row.archivedAt).not.toBeNull();
        }
        expect(rows.map((r) => r.id).sort()).toEqual(
          [first.id, second.id].sort(),
        );
      });

      it('leaves an ad’s own archive date alone when the campaign is archived', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });
        const archived = await fixture.admin.client
          .post(`/campaigns/${campaign.id}/ads/${ad.id}/archive`)
          .expect(201);
        const retiredAt = (archived.body as Ad).archivedAt;

        await fixture.admin.client
          .post(`/campaigns/${campaign.id}/archive`)
          .expect(201);

        const [row] = await db.select().from(ads).where(eq(ads.id, ad.id));
        expect(row.archivedAt!.toISOString()).toBe(
          new Date(retiredAt!).toISOString(),
        );
      });

      it('does not restore a campaign’s ads when the campaign is restored', async () => {
        // Archiving cascades and restoring does not: a merchant retires a push
        // once, but retires creatives one at a time as each finishes.
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });

        await fixture.admin.client
          .post(`/campaigns/${campaign.id}/archive`)
          .expect(201);
        await fixture.admin.client
          .post(`/campaigns/${campaign.id}/unarchive`)
          .expect(201);

        expect(await listAds(campaign.id)).toEqual([]);
        const [row] = await db.select().from(ads).where(eq(ads.id, ad.id));
        expect(row.status).toBe('archived');
      });

      it('offers no way to delete an ad', async () => {
        // Revenue already reported against an ad would be silently re-bucketed.
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });

        await fixture.admin.client
          .delete(`/campaigns/${campaign.id}/ads/${ad.id}`)
          .expect(404);

        const [row] = await db.select().from(ads).where(eq(ads.id, ad.id));
        expect(row).toBeDefined();
      });

      it('does not let a merchant delete an ad’s canonical rule', async () => {
        // Same reason the campaign's own tag rule cannot be removed: every link
        // already running under the ad carries that tag.
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });
        const [rule] = await adRules(ad.id);

        await fixture.admin.client
          .delete(`/campaigns/${campaign.id}/rules/${rule.id}`)
          .expect(404);

        expect(await adRules(ad.id)).toHaveLength(1);
      });
    });

    describe('tenancy', () => {
      it('never resolves an ad id belonging to another organization', async () => {
        const other = await seedAdmin(app);
        try {
          const campaign = await createCampaign({
            name: 'Summer',
            platform: 'meta',
          });
          const ad = await createAd(campaign.id, { name: 'Video A' });

          await other.admin.client
            .get(`/campaigns/${campaign.id}/ads/${ad.id}`)
            .expect(404);
          await other.admin.client
            .patch(`/campaigns/${campaign.id}/ads/${ad.id}`, { name: 'Stolen' })
            .expect(404);
          await other.admin.client
            .post(`/campaigns/${campaign.id}/ads/${ad.id}/archive`)
            .expect(404);
          await other.admin.client
            .get(`/campaigns/${campaign.id}/ads`)
            .expect(404);

          const [row] = await db.select().from(ads).where(eq(ads.id, ad.id));
          expect(row).toMatchObject({ name: 'Video A', status: 'active' });
        } finally {
          await destroyAdmin(app, other);
        }
      });

      it('refuses a creative upload aimed at another organization, and stores nothing', async () => {
        // The refusal has to come before the bytes are written, not after: an
        // upload that is rejected must leave no object behind in the bucket.
        const other = await seedAdmin(app);
        try {
          const campaign = await createCampaign({
            name: 'Summer',
            platform: 'meta',
          });
          const ad = await createAd(campaign.id, { name: 'Video A' });
          const before = storage.stored.length;

          await other.admin.client
            .attach(
              `/campaigns/${campaign.id}/ads/${ad.id}/creative`,
              'file',
              PNG_PIXEL,
              { filename: 'stolen.png', contentType: 'image/png' },
            )
            .expect(404);
          await other.admin.client
            .delete(`/campaigns/${campaign.id}/ads/${ad.id}/creative`)
            .expect(404);

          expect(storage.stored.length).toBe(before);
          const [row] = await db.select().from(ads).where(eq(ads.id, ad.id));
          expect(row.creativeUrl).toBeNull();
        } finally {
          await destroyAdmin(app, other);
        }
      });

      it('never resolves an ad under a campaign that does not own it', async () => {
        const summer = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const spring = await createCampaign({
          name: 'Spring',
          platform: 'meta',
        });
        const ad = await createAd(summer.id, { name: 'Video A' });

        await fixture.admin.client
          .get(`/campaigns/${spring.id}/ads/${ad.id}`)
          .expect(404);
        expect(await listAds(spring.id)).toEqual([]);
      });

      it('scopes an ad to the store its campaign was created in', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });
        const second = await fixture.addStore();

        await second.client.get(`/campaigns/${campaign.id}/ads`).expect(404);
        await second.client
          .get(`/campaigns/${campaign.id}/ads/${ad.id}`)
          .expect(404);
        await second.client
          .delete(`/campaigns/${campaign.id}/ads/${ad.id}/creative`)
          .expect(404);
      });
    });

    /**
     * ADR-0004, asserted where a merchant would feel it break. The Campaign
     * matcher fails silently — a mis-match makes a Campaign look unprofitable
     * forever — so the property that an Ad rule can never decide a Campaign is
     * asserted here as well as in the pure matcher spec.
     */
    describe('campaign resolution is unchanged', () => {
      async function resolveCampaign(
        tuple: AttributionTuple,
      ): Promise<string | null> {
        const matcher = await app
          .get(CampaignService)
          .buildMatcher(fixture.organizationId, fixture.storeId);
        return matcher(tuple)?.campaignId ?? null;
      }

      it('never lets an ad rule claim a tuple for its campaign', async () => {
        const summer = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const spring = await createCampaign({
          name: 'Spring',
          platform: 'meta',
        });
        await createAd(spring.id, { name: 'Video A' });

        // Summer's campaign tag, Spring's ad tag. Summer wins, and it is not
        // close: the ad rule is not in the contest at all.
        expect(
          await resolveCampaign({
            utmCampaign: summer.tag,
            utmContent: 'video-a',
          }),
        ).toBe(summer.id);
      });

      it('leaves a tuple only an ad tag could claim unattributed', async () => {
        const spring = await createCampaign({
          name: 'Spring',
          platform: 'meta',
        });
        await createAd(spring.id, { name: 'Video A' });

        expect(await resolveCampaign({ utmContent: 'video-a' })).toBeNull();
      });

      it('resolves a campaign the same way before and after it gains ads', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const before = await resolveCampaign({ utmCampaign: campaign.tag });

        await createAd(campaign.id, { name: 'Video A' });
        await createAd(campaign.id, { name: 'Video B' });

        expect(await resolveCampaign({ utmCampaign: campaign.tag })).toBe(
          before,
        );
        expect(before).toBe(campaign.id);
      });

      it('keeps an ad’s rule out of the campaign’s own rule list', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        await createAd(campaign.id, { name: 'Video A' });

        const res = await fixture.admin.client
          .get(`/campaigns/${campaign.id}/rules`)
          .expect(200);
        expect(res.body).toEqual([
          expect.objectContaining({ field: 'utm_campaign', adId: null }),
        ]);
      });

      it('refuses a campaign rule authored on utm_content', async () => {
        // The field is in the vocabulary but belongs to an ad. A campaign rule
        // on it could never match, so offering it would only mislead.
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });

        await fixture.admin.client
          .post(`/campaigns/${campaign.id}/rules`, {
            field: 'utm_content',
            operator: 'equals',
            value: 'video-a',
          })
          .expect(400);
      });
    });

    describe('permissions', () => {
      it('lets a product manager manage ads', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const pm = await fixture.addUser('product_manager');

        const created = await pm.client
          .post(`/campaigns/${campaign.id}/ads`, { name: 'Video A' })
          .expect(201);
        const adId = (created.body as Ad).id;

        await pm.client.get(`/campaigns/${campaign.id}/ads`).expect(200);
        await pm.client
          .patch(`/campaigns/${campaign.id}/ads/${adId}`, { name: 'Video A2' })
          .expect(200);
        await pm.client
          .attach(
            `/campaigns/${campaign.id}/ads/${adId}/creative`,
            'file',
            PNG_PIXEL,
            {
              filename: 'video-a.png',
              contentType: 'image/png',
            },
          )
          .expect(201);
        await pm.client
          .delete(`/campaigns/${campaign.id}/ads/${adId}/creative`)
          .expect(200);
        await pm.client
          .post(`/campaigns/${campaign.id}/ads/${adId}/archive`)
          .expect(201);
      });

      it('refuses a support agent, who has no marketing permission', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });
        const ad = await createAd(campaign.id, { name: 'Video A' });
        const support = await fixture.addUser('support_agent');

        await support.client.get(`/campaigns/${campaign.id}/ads`).expect(403);
        await support.client
          .post(`/campaigns/${campaign.id}/ads`, { name: 'Nope' })
          .expect(403);
        await support.client
          .patch(`/campaigns/${campaign.id}/ads/${ad.id}`, { name: 'Nope' })
          .expect(403);
        await support.client
          .attach(
            `/campaigns/${campaign.id}/ads/${ad.id}/creative`,
            'file',
            PNG_PIXEL,
            {
              filename: 'nope.png',
              contentType: 'image/png',
            },
          )
          .expect(403);
        await support.client
          .post(`/campaigns/${campaign.id}/ads/${ad.id}/archive`)
          .expect(403);
      });

      it('rejects a request carrying no admin token', async () => {
        const campaign = await createCampaign({
          name: 'Summer',
          platform: 'meta',
        });

        await request(app.getHttpServer())
          .get(`/api/admin/campaigns/${campaign.id}/ads`)
          .expect(401);
      });
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
      const campaignId = (created.body as Campaign).id;
      await pm.client
        .post(`/campaigns/${campaignId}/rules`, {
          field: 'utm_source',
          operator: 'equals',
          value: 'instagram',
        })
        .expect(201);
      await pm.client.post(`/campaigns/${campaignId}/archive`).expect(201);
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
      await support.client.get(`/campaigns/${created.id}/rules`).expect(403);
      await support.client
        .get(
          `/campaigns/${created.id}/link?source=instagram&medium=paid_social`,
        )
        .expect(403);
      await support.client
        .post(`/campaigns/${created.id}/rules`, {
          field: 'utm_source',
          operator: 'equals',
          value: 'instagram',
        })
        .expect(403);
    });
  });
});
