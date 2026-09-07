/**
 * Content Slots, end to end through the admin REST API and the public
 * storefront GraphQL API.
 *
 * The failure this suite exists for is a draft reaching a shopper. Every other
 * mistake here is visible and reversible; a merchant's unfinished words on
 * their live Store, found by a customer rather than by them, cannot be
 * un-shown. So the public read is asserted from the outside — through the API
 * key a shopper's storefront actually uses — rather than by trusting a filter.
 */
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { createTestApp } from './helpers/test-app';
import {
  seedAdmin,
  destroyAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';
import { StorefrontClient } from './helpers/storefront-client';
import { ApiKeyService } from '../src/modules/auth/services/api-key.service';
import type { ContentSlot } from '../src/shared/database/schema';

const HERO = 'homepage.hero';
const PUBLISHED_SLOTS = `
  query {
    contentSlots {
      key
      type
      value
    }
  }
`;

describe('Content slots (e2e)', () => {
  let app: INestApplication<App>;
  let fixture: AdminFixture;
  let storefront: StorefrontClient;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    fixture = await seedAdmin(app);
    storefront = await apiKeyFor(fixture.organizationId, fixture.storeId);
  });
  afterEach(async () => {
    if (fixture) await destroyAdmin(app, fixture);
  });

  async function apiKeyFor(
    organizationId: string,
    storeId: string,
  ): Promise<StorefrontClient> {
    const { rawKey } = await app
      .get(ApiKeyService)
      .generate(organizationId, storeId, 'Content slots test');
    return new StorefrontClient(app, rawKey);
  }

  type Slot = { key: string; type: string; value: string };
  async function published(client = storefront): Promise<Slot[]> {
    const data = await client.query<{ contentSlots: Slot[] }>(PUBLISHED_SLOTS);
    return data.contentSlots;
  }

  function saveDraft(
    value: string,
    key = HERO,
    client = fixture.admin.client,
    type = 'heading',
  ) {
    return client.put(`/content/slots/${key}/draft`, { type, value });
  }

  function publish(key = HERO, client = fixture.admin.client) {
    return client.post(`/content/slots/${key}/publish`);
  }

  function discard(key = HERO, client = fixture.admin.client) {
    return client.delete(`/content/slots/${key}/draft`);
  }

  describe('what a shopper can see', () => {
    it('does not show a slot that has only ever been drafted', async () => {
      await saveDraft('Next week’s promotion').expect(200);

      expect(await published()).toEqual([]);
    });

    it('shows the published value and never the draft alongside it', async () => {
      await saveDraft('Winter kit, ready when you are.').expect(200);
      await publish().expect(201);
      await saveDraft('Spring, eventually.').expect(200);

      expect(await published()).toEqual([
        {
          key: HERO,
          type: 'heading',
          value: 'Winter kit, ready when you are.',
        },
      ]);
    });

    it('offers no way to ask for a draft', async () => {
      await saveDraft('Unfinished').expect(200);

      // The field does not exist on the public type, so there is nothing to
      // pass and nothing to forget to filter.
      const response = await storefront.raw(
        'query { contentSlots { key draftValue } }',
      );
      const body = response.body as { errors?: { message: string }[] };
      expect(body.errors?.[0]?.message).toMatch(/draftValue/);

      const withArgument = await storefront.raw(
        'query { contentSlots(includeDrafts: true) { key value } }',
      );
      expect(
        (withArgument.body as { errors?: unknown[] }).errors,
      ).toBeDefined();
    });

    it('keeps rendering the published value while a replacement is drafted', async () => {
      await saveDraft('Live copy').expect(200);
      await publish().expect(201);
      await saveDraft('Half-written replacement').expect(200);

      expect((await published())[0].value).toBe('Live copy');
    });

    it('publishes the drafted value when the merchant says so', async () => {
      await saveDraft('Live copy').expect(200);
      await publish().expect(201);
      await saveDraft('The new headline').expect(200);

      expect((await published())[0].value).toBe('Live copy');

      const republished = await publish().expect(201);
      expect(await published()).toEqual([
        { key: HERO, type: 'heading', value: 'The new headline' },
      ]);
      const row = republished.body as ContentSlot;
      expect(row.status).toBe('published');
      expect(row.draftValue).toBeNull();
      expect(row.lastPublishedAt).not.toBeNull();
    });
  });

  describe('abandoning a draft', () => {
    it('leaves the published value unchanged and still public', async () => {
      await saveDraft('Live copy').expect(200);
      await publish().expect(201);
      await saveDraft('An idea I thought better of').expect(200);

      const discarded = await discard().expect(200);
      const row = discarded.body as ContentSlot;
      expect(row.draftValue).toBeNull();
      expect(row.status).toBe('published');
      expect(row.value).toBe('Live copy');
      expect(row.lastPublishedAt).not.toBeNull();

      // What matters is what a shopper reads: abandoning an idea never takes
      // live copy down with it.
      expect(await published()).toEqual([
        { key: HERO, type: 'heading', value: 'Live copy' },
      ]);
    });

    it('leaves a never-published slot showing nothing at all', async () => {
      await saveDraft('Never mind').expect(200);

      await discard().expect(200);

      expect(await published()).toEqual([]);
      const list = await fixture.admin.client.get('/content/slots').expect(200);
      const slots = list.body as ContentSlot[];
      expect(slots).toHaveLength(1);
      expect(slots[0].draftValue).toBeNull();
      expect(slots[0].value).toBeNull();
      expect(slots[0].status).toBe('draft');
    });

    it('is not an error when there is no draft to discard', async () => {
      await saveDraft('Live copy').expect(200);
      await publish().expect(201);

      await discard().expect(200);

      expect((await published())[0].value).toBe('Live copy');
    });

    it('refuses a slot this store does not have', async () => {
      await discard('never.declared').expect(400);
    });
  });

  describe('one store’s slots are not another’s', () => {
    it('is invisible to another store’s API key', async () => {
      await saveDraft('Ours, published').expect(200);
      await publish().expect(201);

      const other = await seedAdmin(app);
      try {
        const theirs = await apiKeyFor(other.organizationId, other.storeId);
        expect(await published(theirs)).toEqual([]);
      } finally {
        await destroyAdmin(app, other);
      }
    });

    it('treats the same key in two stores as two different slots', async () => {
      await saveDraft('Our headline').expect(200);
      await publish().expect(201);

      const second = await fixture.addStore();
      await saveDraft('Their headline', HERO, second.client).expect(200);
      await publish(HERO, second.client).expect(201);

      expect((await published())[0].value).toBe('Our headline');
      const theirs = await apiKeyFor(fixture.organizationId, second.storeId);
      expect((await published(theirs))[0].value).toBe('Their headline');
    });
  });

  describe('who may change what a store says', () => {
    it('refuses a support agent both saving a draft and publishing', async () => {
      const support = await fixture.addUser('support_agent');

      await saveDraft('Not theirs to write', HERO, support.client).expect(403);

      await saveDraft('The real copy').expect(200);
      await publish(HERO, support.client).expect(403);

      // Refused, and nothing of theirs is stored or live either way.
      expect(await published()).toEqual([]);
    });

    it('lets a product manager draft and publish', async () => {
      const manager = await fixture.addUser('product_manager');

      await saveDraft('Theirs to write', HERO, manager.client).expect(200);
      await publish(HERO, manager.client).expect(201);

      expect((await published())[0].value).toBe('Theirs to write');
    });

    it('refuses a support agent discarding a draft', async () => {
      const support = await fixture.addUser('support_agent');
      await saveDraft('Live copy').expect(200);
      await publish().expect(201);
      await saveDraft('Mine to abandon').expect(200);

      await discard(HERO, support.client).expect(403);

      // Refused, so the merchant's own unpublished work is still there.
      const list = await fixture.admin.client.get('/content/slots').expect(200);
      expect((list.body as ContentSlot[])[0].draftValue).toBe(
        'Mine to abandon',
      );
    });

    it('refuses a support agent the slot list', async () => {
      const support = await fixture.addUser('support_agent');
      await support.client.get('/content/slots').expect(403);
    });
  });

  describe('what a slot may hold', () => {
    it('stores what the merchant pasted as text, without its markup', async () => {
      await saveDraft('<h1>Winter, <b>sorted</b>.</h1>').expect(200);
      await publish().expect(201);

      expect((await published())[0].value).toBe('Winter, sorted.');
    });

    it('refuses an oversized value rather than truncating it', async () => {
      await saveDraft('a'.repeat(200)).expect(400);

      const list = await fixture.admin.client.get('/content/slots').expect(200);
      expect(list.body).toEqual([]);
    });

    it('refuses a value of a type the region was not declared with', async () => {
      await saveDraft('Winter, sorted.').expect(200);
      await publish().expect(201);

      // The storefront declared this region a heading. A value claiming to be
      // something else is refused rather than stored, so the Slot can never
      // hold content the page that renders it has no layout for.
      const refused = await saveDraft(
        'a'.repeat(500),
        HERO,
        fixture.admin.client,
        'text',
      ).expect(400);
      expect((refused.body as { message: string }).message).toMatch(/heading/);

      expect((await published())[0].value).toBe('Winter, sorted.');
      const list = await fixture.admin.client.get('/content/slots').expect(200);
      const slot = (list.body as ContentSlot[])[0];
      expect(slot.type).toBe('heading');
      expect(slot.draftValue).toBeNull();
    });

    it('refuses a type that is not one the protocol carries', async () => {
      await saveDraft('Fine copy', HERO, fixture.admin.client, 'html').expect(
        400,
      );

      const list = await fixture.admin.client.get('/content/slots').expect(200);
      expect(list.body).toEqual([]);
    });

    it('refuses to publish a slot with no draft', async () => {
      await publish().expect(400);
    });

    it('leaves the published value untouched when a draft save fails', async () => {
      await saveDraft('Good copy').expect(200);
      await publish().expect(201);

      await saveDraft('a'.repeat(200)).expect(400);

      expect((await published())[0].value).toBe('Good copy');
    });
  });
});
