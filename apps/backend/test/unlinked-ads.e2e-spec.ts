/**
 * Unlinked Ads: claiming and dismissing, end to end.
 *
 * The seam runs from the fake provider returning a tree, through the real sync
 * against a real database, to the merchant claiming or dismissing through the
 * admin API and reading the consequence back. No repository is mocked.
 *
 * Two properties are worth more than the rest and are asserted from several
 * directions:
 *
 * **No Ad is ever created by a sync.** An Ad invented from a platform's tree
 * carries real cost and has no Ad Tag rule, so it would show spend against zero
 * revenue and read as a catastrophic loser — the most alarming card in the UI,
 * generated automatically.
 *
 * **A claim attaches history rather than starting from zero.** Figures are
 * keyed on the platform's ad id, so the backfill pulled weeks before anybody
 * claimed the ad comes with it, and unlinking detaches it without deleting a
 * row of it.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import { ads, campaignMatchingRules } from '../src/shared/database/schema';
import type { Ad, AdPlatform, Campaign } from '../src/shared/database/schema';
import type { ReportedFigureView } from '../src/modules/ad-platform/services/reported-figure.service';
import type {
  ClaimResult,
  UnlinkedAdView,
} from '../src/modules/ad-platform/services/unlinked-ad.service';
import type {
  AdTree,
  ReportedAd,
  ReportedAdDay,
} from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import { daysBefore } from '../src/modules/ad-platform/utils/sync-window.util';
import { createTestApp } from './helpers/test-app';
import type { AdminClient } from './helpers/admin-client';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

/** The store's timezone is UTC in the fixture, so its today is this one. */
const today = (): string => new Date().toISOString().slice(0, 10);

function day(
  date: string,
  figures: Partial<ReportedAdDay> = {},
): ReportedAdDay {
  return {
    day: date,
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    reportedRevenue: 0,
    reportedRoasBp: null,
    ...figures,
  };
}

/** An ad written with only the fields the case cares about. */
function platformAd(
  externalAdId: string,
  overrides: Partial<ReportedAd> = {},
): ReportedAd {
  return {
    externalAdId,
    name: `Ad ${externalAdId}`,
    creativeUrl: null,
    startsAt: null,
    endsAt: null,
    days: [],
    ...overrides,
  };
}

describe('Unlinked ads (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let fixture: AdminFixture;

  beforeAll(async () => {
    ({ app, adPlatform: provider } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    provider.reset();
    fixture = await seedAdmin(app);
  });

  afterEach(async () => {
    await destroyAdmin(app, fixture);
  });

  // ─── Driving the flow the way a merchant does ───────────────────────────────

  async function connect(
    client: AdminClient,
    platform: AdPlatform = 'meta',
  ): Promise<string> {
    const res = await client
      .post(`/ad-platforms/${platform}/connect`)
      .expect(201);
    const { approvalUrl } = res.body as { approvalUrl: string };
    const returnUrl = new URL(
      decodeURIComponent(new URL(approvalUrl).searchParams.get('return') ?? ''),
    );

    const { providerRef } = provider.begun[provider.begun.length - 1];
    provider.approve(providerRef, platform);

    // The platform returns the merchant to our own callback, which is public
    // and carries no admin session — exactly as it does in the real flow.
    await request(app.getHttpServer())
      .get(`${returnUrl.pathname}${returnUrl.search}`)
      .expect(302);
    return providerRef;
  }

  function platformReports(providerRef: string, tree: AdTree): void {
    provider.setAdTree(providerRef, 'meta', tree);
  }

  const syncNow = async (client: AdminClient): Promise<void> => {
    await client.post('/ad-platforms/meta/sync').expect(201);
  };

  const listUnlinked = async (
    client: AdminClient,
    state?: string,
  ): Promise<UnlinkedAdView[]> => {
    const res = await client
      .get('/ad-platforms/unlinked-ads')
      .query(state ? { state } : {})
      .expect(200);
    return res.body as UnlinkedAdView[];
  };

  const counts = async (
    client: AdminClient,
  ): Promise<{ pending: number; claimed: number; dismissed: number }> => {
    const res = await client
      .get('/ad-platforms/unlinked-ads/count')
      .expect(200);
    return res.body as never;
  };

  const readFigures = async (
    client: AdminClient,
  ): Promise<ReportedFigureView[]> => {
    const res = await client
      .get('/ad-platforms/reported-figures')
      .query({ from: daysBefore(today(), 365), to: today() })
      .expect(200);
    return res.body as ReportedFigureView[];
  };

  async function createCampaign(
    client: AdminClient,
    name = 'Summer Sale',
  ): Promise<Campaign> {
    const res = await client
      .post('/campaigns', { name, platform: 'meta' })
      .expect(201);
    return res.body as Campaign;
  }

  const adRowsInOrg = async (): Promise<Ad[]> =>
    db.select().from(ads).where(eq(ads.organizationId, fixture.organizationId));

  /**
   * One connected store whose platform reports one ad nothing here claims,
   * spending over three days — the starting position for most of these cases.
   */
  async function oneUnlinkedAd(
    client: AdminClient = fixture.admin.client,
  ): Promise<{ providerRef: string; unlinked: UnlinkedAdView }> {
    const providerRef = await connect(client);
    platformReports(providerRef, {
      currency: 'USD',
      ads: [
        platformAd('ad_meta_1', {
          name: 'Summer reel',
          creativeUrl: 'https://platform.test/summer-reel.jpg',
          startsAt: new Date('2026-08-01T00:00:00.000Z'),
          endsAt: new Date('2026-08-31T00:00:00.000Z'),
          days: [
            day(daysBefore(today(), 2), { spend: 100_00 }),
            day(daysBefore(today(), 1), { spend: 150_00 }),
            day(today(), { spend: 50_00 }),
          ],
        }),
      ],
    });

    await syncNow(client);
    const [unlinked] = await listUnlinked(client);
    return { providerRef, unlinked };
  }

  // ─── What a sync produces, and what it refuses to produce ───────────────────

  describe('what a sync holds', () => {
    it('holds an ad nothing here claims, with what the merchant needs to recognise it', async () => {
      const { unlinked } = await oneUnlinkedAd();

      expect(unlinked).toMatchObject({
        platform: 'meta',
        externalAdId: 'ad_meta_1',
        name: 'Summer reel',
        creativeUrl: 'https://platform.test/summer-reel.jpg',
        state: 'pending',
        // $100 + $150 + $50, worked out by hand, in minor units of the ad
        // account's currency — which is not converted into the store's.
        spendToDate: 300_00,
        currency: 'USD',
        days: 3,
      });
      expect(new Date(unlinked.startsAt as unknown as string)).toEqual(
        new Date('2026-08-01T00:00:00.000Z'),
      );
    });

    /**
     * The single most important assertion in this file. An Ad conjured from a
     * sync has real cost and no way to earn revenue.
     */
    it('creates no Ad, on the first sync or on the second', async () => {
      const { providerRef } = await oneUnlinkedAd();
      expect(await adRowsInOrg()).toEqual([]);

      platformReports(providerRef, {
        currency: 'USD',
        ads: [platformAd('ad_meta_1', { days: [day(today(), { spend: 1 })] })],
      });
      await syncNow(fixture.admin.client);

      expect(await adRowsInOrg()).toEqual([]);
      expect(await listUnlinked(fixture.admin.client)).toHaveLength(1);
    });

    it('surfaces how many are waiting', async () => {
      await oneUnlinkedAd();
      expect(await counts(fixture.admin.client)).toEqual({
        pending: 1,
        claimed: 0,
        dismissed: 0,
      });
    });

    it('holds nothing for an ad an Ad in this store already claims', async () => {
      const providerRef = await connect(fixture.admin.client);
      const campaign = await createCampaign(fixture.admin.client);
      const res = await fixture.admin.client
        .post(`/campaigns/${campaign.id}/ads`, {
          name: 'Already ours',
          externalId: 'ad_known',
        })
        .expect(201);
      const ours = res.body as Ad;

      platformReports(providerRef, {
        currency: 'USD',
        ads: [platformAd('ad_known', { days: [day(today(), { spend: 500 })] })],
      });
      await syncNow(fixture.admin.client);

      expect(await listUnlinked(fixture.admin.client)).toEqual([]);
      // And its figures resolve onto the Ad that was already carrying the id.
      const figures = await readFigures(fixture.admin.client);
      expect(figures[0]).toMatchObject({
        adId: ours.id,
        adName: 'Already ours',
      });
    });

    it('refreshes what a held ad looks like without asking again', async () => {
      const { providerRef } = await oneUnlinkedAd();

      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          platformAd('ad_meta_1', {
            name: 'Summer reel v2',
            days: [day(today(), { spend: 50_00 })],
          }),
        ],
      });
      await syncNow(fixture.admin.client);

      const rows = await listUnlinked(fixture.admin.client);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Summer reel v2');
    });
  });

  // ─── Claiming ───────────────────────────────────────────────────────────────

  describe('claiming onto a campaign', () => {
    it('creates an Ad with a derived tag and its canonical rule, and attaches the history', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(201);
      const claim = res.body as ClaimResult;

      expect(claim.ad).toMatchObject({
        name: 'Summer reel',
        tag: 'summer-reel',
        externalId: 'ad_meta_1',
        campaignId: campaign.id,
        // The creative the platform hosts, carried onto the card.
        creativeUrl: 'https://platform.test/summer-reel.jpg',
      });
      expect(claim.unlinkedAd.state).toBe('claimed');

      // The canonical utm_content rule ticket 01 of Stage 5 established — the
      // only reason a tagged link will ever resolve back onto this ad.
      const rules = await db
        .select()
        .from(campaignMatchingRules)
        .where(eq(campaignMatchingRules.adId, claim.ad.id));
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        field: 'utm_content',
        operator: 'equals',
        value: 'summer-reel',
        isCanonical: true,
      });

      // Three days of history, $300, pulled before anything claimed it.
      expect(claim.attached).toEqual({
        days: 3,
        spend: 300_00,
        currency: 'USD',
      });
      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(3);
      for (const figure of figures) {
        expect(figure.adId).toBe(claim.ad.id);
        expect(figure.adName).toBe('Summer reel');
      }
    });

    /**
     * The merchant's next action, offered at the moment they make the decision
     * that creates the need for it. Without this link the claimed ad reports
     * cost against no revenue for as long as it runs.
     */
    it('offers the tagged link, carrying both the campaign tag and the ad tag', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(201);
      const claim = res.body as ClaimResult;

      expect(claim.taggedLinkProblem).toBeNull();
      expect(claim.taggedLink).toMatchObject({
        utmCampaign: campaign.tag,
        utmContent: claim.ad.tag,
        utmSource: 'facebook',
        utmMedium: 'paid-social',
      });

      const url = new URL((claim.taggedLink as { url: string }).url);
      expect(url.searchParams.get('utm_campaign')).toBe(campaign.tag);
      expect(url.searchParams.get('utm_content')).toBe(claim.ad.tag);
    });

    it('takes a name the merchant prefers over the platform’s', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
          name: 'Reel A',
        })
        .expect(201);

      expect((res.body as ClaimResult).ad).toMatchObject({
        name: 'Reel A',
        tag: 'reel-a',
      });
    });

    it('refuses a campaign belonging to another organization, creating nothing', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const other = await seedAdmin(app);
      try {
        const theirs = await createCampaign(other.admin.client, 'Theirs');

        await fixture.admin.client
          .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
            campaignId: theirs.id,
          })
          .expect(404);

        expect(await adRowsInOrg()).toEqual([]);
        const [still] = await listUnlinked(fixture.admin.client);
        expect(still.state).toBe('pending');
      } finally {
        await destroyAdmin(app, other);
      }
    });
  });

  describe('claiming onto an ad that already exists here', () => {
    it('records the platform id against it without creating a duplicate', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      const created = await fixture.admin.client
        .post(`/campaigns/${campaign.id}/ads`, { name: 'Summer reel' })
        .expect(201);
      const ours = created.body as Ad;

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
          adId: ours.id,
        })
        .expect(201);
      const claim = res.body as ClaimResult;

      expect(claim.ad.id).toBe(ours.id);
      expect(claim.ad.externalId).toBe('ad_meta_1');
      // One Ad, not two. The creative a merchant already built here is the same
      // creative running there.
      expect(await adRowsInOrg()).toHaveLength(1);

      const figures = await readFigures(fixture.admin.client);
      expect(figures.every((f) => f.adId === ours.id)).toBe(true);
    });

    it('refuses an ad already linked to a different platform ad', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      const created = await fixture.admin.client
        .post(`/campaigns/${campaign.id}/ads`, {
          name: 'Spoken for',
          externalId: 'ad_something_else',
        })
        .expect(201);

      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
          adId: (created.body as Ad).id,
        })
        .expect(409);
    });

    it('refuses an ad under a different campaign', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const mine = await createCampaign(fixture.admin.client, 'Mine');
      const other = await createCampaign(fixture.admin.client, 'Other');
      const created = await fixture.admin.client
        .post(`/campaigns/${other.id}/ads`, { name: 'Elsewhere' })
        .expect(201);

      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: mine.id,
          adId: (created.body as Ad).id,
        })
        .expect(404);
    });
  });

  // ─── The state machine, from the outside ────────────────────────────────────

  describe('the transitions a merchant can and cannot make', () => {
    it('refuses to claim an ad that is already claimed', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);

      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(201);

      const second = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(409);
      expect((second.body as { message: string }).message).toContain(
        'already been claimed',
      );

      // And the refusal created nothing on its way out.
      expect(await adRowsInOrg()).toHaveLength(1);
    });

    it('refuses to dismiss a claimed ad, and says to unlink it first', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(201);

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/dismiss`)
        .expect(409);
      expect((res.body as { message: string }).message).toContain(
        'Unlink it first',
      );
    });

    it('refuses to unlink something that was never claimed', async () => {
      const { unlinked } = await oneUnlinkedAd();
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/unlink`)
        .expect(409);
    });

    it('refuses to restore something that is not dismissed', async () => {
      const { unlinked } = await oneUnlinkedAd();
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/restore`)
        .expect(409);
    });
  });

  // ─── Dismissing ─────────────────────────────────────────────────────────────

  describe('dismissing', () => {
    it('stays dismissed across a second sync', async () => {
      const { providerRef, unlinked } = await oneUnlinkedAd();

      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/dismiss`)
        .expect(201);

      expect(await listUnlinked(fixture.admin.client)).toEqual([]);

      // The platform keeps reporting it, as it will on every run for as long as
      // the ad exists. The question has been answered and is not asked again.
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          platformAd('ad_meta_1', { days: [day(today(), { spend: 25_00 })] }),
        ],
      });
      await syncNow(fixture.admin.client);

      expect(await listUnlinked(fixture.admin.client)).toEqual([]);
      const dismissed = await listUnlinked(fixture.admin.client, 'dismissed');
      expect(dismissed).toHaveLength(1);
      expect(dismissed[0].externalAdId).toBe('ad_meta_1');
      expect(await counts(fixture.admin.client)).toMatchObject({
        pending: 0,
        dismissed: 1,
      });
    });

    it('keeps its figures readable — declining to attribute money is not declining to know about it', async () => {
      const { unlinked } = await oneUnlinkedAd();
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/dismiss`)
        .expect(201);

      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(3);
      expect(figures.every((f) => f.adId === null)).toBe(true);
      expect(figures.reduce((sum, f) => sum + f.spend, 0)).toBe(300_00);
    });

    it('can be restored, because a misclick must not be permanent', async () => {
      const { unlinked } = await oneUnlinkedAd();
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/dismiss`)
        .expect(201);

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/restore`)
        .expect(201);
      expect((res.body as UnlinkedAdView).state).toBe('pending');
      expect(await listUnlinked(fixture.admin.client)).toHaveLength(1);
    });

    it('can be claimed straight from dismissed', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/dismiss`)
        .expect(201);

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(201);
      expect((res.body as ClaimResult).unlinkedAd.state).toBe('claimed');
      expect((res.body as ClaimResult).attached.spend).toBe(300_00);
    });
  });

  // ─── Undoing a claim ────────────────────────────────────────────────────────

  describe('unlinking a claimed ad', () => {
    it('keeps the Ad, detaches the history, and deletes no figure', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      const claim = (
        await fixture.admin.client
          .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
            campaignId: campaign.id,
          })
          .expect(201)
      ).body as ClaimResult;

      const res = await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/unlink`)
        .expect(201);
      expect((res.body as UnlinkedAdView).state).toBe('pending');

      // The Ad survives: it may already have earned revenue through its own
      // tag, and deleting it would silently re-bucket that money.
      const [kept] = await db.select().from(ads).where(eq(ads.id, claim.ad.id));
      expect(kept).toBeDefined();
      expect(kept.externalId).toBeNull();

      // Every figure is still there; they are simply attached to nothing again.
      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(3);
      expect(figures.every((f) => f.adId === null)).toBe(true);
    });

    it('reattaches every day of history when it is claimed again', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(201);
      await fixture.admin.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/unlink`)
        .expect(201);

      const again = (
        await fixture.admin.client
          .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
            campaignId: campaign.id,
            name: 'Second attempt',
          })
          .expect(201)
      ).body as ClaimResult;

      expect(again.attached).toEqual({
        days: 3,
        spend: 300_00,
        currency: 'USD',
      });
      const figures = await readFigures(fixture.admin.client);
      expect(figures.every((f) => f.adId === again.ad.id)).toBe(true);
    });

    /**
     * The sync's own reconciliation, which goes through the same transition
     * engine a merchant's click does — there is no second writer of this state.
     */
    it('is released back to waiting when the platform id is cleared off the Ad by hand', async () => {
      const { providerRef, unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      const claim = (
        await fixture.admin.client
          .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
            campaignId: campaign.id,
          })
          .expect(201)
      ).body as ClaimResult;

      await fixture.admin.client
        .patch(`/campaigns/${campaign.id}/ads/${claim.ad.id}`, {
          externalId: null,
        })
        .expect(200);

      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          platformAd('ad_meta_1', { days: [day(today(), { spend: 10_00 })] }),
        ],
      });
      await syncNow(fixture.admin.client);

      const waiting = await listUnlinked(fixture.admin.client);
      expect(waiting).toHaveLength(1);
      expect(waiting[0].state).toBe('pending');
    });
  });

  // ─── Tenancy ────────────────────────────────────────────────────────────────

  describe('scoping', () => {
    it('is invisible to another organization', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const other = await seedAdmin(app);
      try {
        expect(await listUnlinked(other.admin.client)).toEqual([]);
        expect(await counts(other.admin.client)).toEqual({
          pending: 0,
          claimed: 0,
          dismissed: 0,
        });

        const theirs = await createCampaign(other.admin.client, 'Theirs');
        await other.admin.client
          .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
            campaignId: theirs.id,
          })
          .expect(404);
        await other.admin.client
          .post(`/ad-platforms/unlinked-ads/${unlinked.id}/dismiss`)
          .expect(404);
      } finally {
        await destroyAdmin(app, other);
      }
    });

    it('is invisible to another store of the same organization', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const second = await fixture.addStore();

      expect(await listUnlinked(second.client)).toEqual([]);
      await second.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/dismiss`)
        .expect(404);
    });

    it('lets a product manager claim, since it is the same authority as creating the ad', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      const pm = await fixture.addUser('product_manager');

      await pm.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(201);
    });

    it('refuses a support agent, who cannot create an ad either', async () => {
      const { unlinked } = await oneUnlinkedAd();
      const campaign = await createCampaign(fixture.admin.client);
      const agent = await fixture.addUser('support_agent');

      await agent.client
        .post(`/ad-platforms/unlinked-ads/${unlinked.id}/claim`, {
          campaignId: campaign.id,
        })
        .expect(403);
      await agent.client.get('/ad-platforms/unlinked-ads').expect(403);
    });
  });
});
