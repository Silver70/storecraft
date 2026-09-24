/**
 * Syncing the connected ad account into Campaigns, Ads and their daily figures,
 * end to end.
 *
 * The seam runs from the fake provider returning a tree, through the real sync
 * against a real database, to the merchant reading the result back through the
 * admin API — no repository is mocked and nothing is asserted about how a
 * payload was parsed. What is asserted is what a merchant ends up able to read,
 * against figures worked out by hand.
 *
 * The ad platform is the in-memory fake swapped in through the same
 * `overrideProvider` seam the payment provider's fake uses, and object storage
 * is the storage fake. Everything else is production wiring against a local
 * Postgres database.
 *
 * Connecting runs the first sync, so every case says what the platform holds
 * *before* it connects — exactly as a real ad account already has its history
 * the moment a merchant approves.
 *
 * **The schedule is not tested here.** That a `@Cron` decorator fires is the
 * framework's behaviour; the sync is a plain public method and is invoked as
 * one.
 */
import type { INestApplication } from '@nestjs/common';
import { and, count, eq, sum } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  adDailyFigures,
  adPlatformConnections,
  ads,
  campaigns,
} from '../src/shared/database/schema';
import type { AdPlatformConnectionView } from '../src/modules/ad-platform/services/ad-platform-connection.service';
import type {
  AdTree,
  PlatformSignals,
  ReportedAd,
  ReportedAdDay,
  ReportedCampaign,
} from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import {
  AdPlatformSyncService,
  type SyncOutcome,
} from '../src/modules/ad-platform/services/ad-platform-sync.service';
import { AdPlatformConnectionRepository } from '../src/modules/ad-platform/repositories/ad-platform-connection.repository';
import type { AttributedRevenueReport } from '../src/modules/marketing/services/attributed-revenue.service';
import {
  DEFAULT_BACKFILL_DAYS,
  RESTATEMENT_DAYS,
  daysBefore,
} from '../src/modules/ad-platform/utils/sync-window.util';
import { buildLinkTags } from '../src/modules/ad-platform/utils/link-tags.util';
import { createTestApp } from './helpers/test-app';
import type { AdminClient } from './helpers/admin-client';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
import type { FakeStorageService } from './helpers/fake-storage.service';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

/** The store's timezone is UTC in the fixture, so its today is this one. */
const today = (): string => new Date().toISOString().slice(0, 10);

/** One day of figures, already in minor units the way the interface requires. */
function day(
  date: string,
  figures: Partial<Omit<ReportedAdDay, 'day'>> = {},
): ReportedAdDay {
  return { day: date, spend: 0, impressions: 0, clicks: 0, ...figures };
}

const DELIVERING: PlatformSignals = {
  delivery: 'active',
  review: 'approved',
  startsAt: null,
  endsAt: null,
};

/** An ad, written with only the fields a case cares about. */
function ad(
  externalAdId: string,
  days: ReportedAdDay[] = [],
  overrides: Partial<Omit<ReportedAd, 'signals'>> & {
    signals?: Partial<PlatformSignals>;
  } = {},
): ReportedAd {
  const { signals, ...rest } = overrides;
  return {
    externalAdId,
    name: `Ad ${externalAdId}`,
    format: 'image',
    creativeUrl: null,
    days,
    ...rest,
    signals: { ...DELIVERING, ...signals },
  };
}

/** A campaign, written with only the fields a case cares about. */
function campaign(
  externalCampaignId: string,
  campaignAds: ReportedAd[],
  overrides: Partial<Omit<ReportedCampaign, 'signals' | 'ads'>> & {
    signals?: Partial<PlatformSignals>;
  } = {},
): ReportedCampaign {
  const { signals, ...rest } = overrides;
  return {
    externalCampaignId,
    name: `Campaign ${externalCampaignId}`,
    ads: campaignAds,
    ...rest,
    signals: { ...DELIVERING, ...signals },
  };
}

function tree(
  treeCampaigns: ReportedCampaign[],
  extra: Partial<AdTree> = {},
): AdTree {
  return {
    currency: 'USD',
    campaigns: treeCampaigns,
    complete: true,
    ...extra,
  };
}

describe('Ad platform sync (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let storage: FakeStorageService;
  let sync: AdPlatformSyncService;
  let connections: AdPlatformConnectionRepository;
  let fixture: AdminFixture;

  beforeAll(async () => {
    ({ app, adPlatform: provider, storage } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
    sync = app.get(AdPlatformSyncService);
    connections = app.get(AdPlatformConnectionRepository);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    provider.reset();
    storage.stored.length = 0;
    fixture = await seedAdmin(app);
  });

  afterEach(async () => {
    await destroyAdmin(app, fixture);
  });

  // ─── Driving the flow the way a merchant does ───────────────────────────────

  /**
   * The whole connection round trip, ending with a chosen ad account — and,
   * because connecting runs it, the first sync.
   *
   * One ad account in the store's own currency, so the merchant is never asked
   * a question with a single answer and the connection settles on the way back.
   * Whatever the platform holds is set before the merchant approves.
   */
  async function connect(
    client: AdminClient,
    options: { accountId?: string; holds?: AdTree } = {},
  ): Promise<{ providerRef: string; accountId: string }> {
    const accountId = options.accountId ?? 'act_100';
    if (options.holds) provider.setAdTree(accountId, options.holds);

    const res = await client.post('/ad-platforms/meta/connect').expect(201);
    const { approvalUrl } = res.body as { approvalUrl: string };
    const returnUrl = new URL(
      decodeURIComponent(new URL(approvalUrl).searchParams.get('return') ?? ''),
    );

    const { providerRef } = provider.begun[provider.begun.length - 1];
    provider.approve(providerRef, 'meta', [{ externalAccountId: accountId }]);

    await request(app.getHttpServer())
      .get(`${returnUrl.pathname}${returnUrl.search}`)
      .expect(302);

    return { providerRef, accountId };
  }

  const refresh = async (client: AdminClient): Promise<SyncOutcome> => {
    const res = await client.post('/ad-platforms/meta/sync').expect(201);
    const [outcome] = res.body as SyncOutcome[];
    return outcome;
  };

  const readConnection = async (
    client: AdminClient,
  ): Promise<AdPlatformConnectionView> => {
    const res = await client.get('/ad-platforms').expect(200);
    const found = (res.body as AdPlatformConnectionView[]).find(
      (c) => c.platform === 'meta',
    );
    if (!found) throw new Error('no meta connection on this store');
    return found;
  };

  const report = async (
    client: AdminClient,
    period = '90d',
  ): Promise<AttributedRevenueReport> => {
    const res = await client
      .get(`/marketing/attributed-revenue?period=${period}`)
      .expect(200);
    return res.body as AttributedRevenueReport;
  };

  const campaignLine = async (client: AdminClient, externalId: string) => {
    const line = (await report(client)).campaigns.find(
      (c) => c.externalId === externalId,
    );
    if (!line) throw new Error(`campaign ${externalId} is not on the page`);
    return line;
  };

  /** Every figure row this Organization holds, as the database has it. */
  const figureRows = () =>
    db
      .select({
        externalId: ads.externalId,
        day: adDailyFigures.day,
        spend: adDailyFigures.spend,
        impressions: adDailyFigures.impressions,
        clicks: adDailyFigures.clicks,
      })
      .from(adDailyFigures)
      .innerJoin(ads, eq(ads.id, adDailyFigures.adId))
      .where(eq(adDailyFigures.organizationId, fixture.organizationId))
      .orderBy(ads.externalId, adDailyFigures.day);

  const rowCounts = async () => {
    const [c] = await db
      .select({ n: count() })
      .from(campaigns)
      .where(eq(campaigns.organizationId, fixture.organizationId));
    const [a] = await db
      .select({ n: count() })
      .from(ads)
      .where(eq(ads.organizationId, fixture.organizationId));
    const [f] = await db
      .select({ n: count(), spend: sum(adDailyFigures.spend) })
      .from(adDailyFigures)
      .where(eq(adDailyFigures.organizationId, fixture.organizationId));
    return { campaigns: c.n, ads: a.n, figures: f.n, spend: Number(f.spend) };
  };

  // ─── Day one ────────────────────────────────────────────────────────────────

  describe('connecting', () => {
    it('backfills the history the platform offers rather than starting from today', async () => {
      const longAgo = daysBefore(today(), 45);
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [
            ad('ad_1', [
              day(longAgo, { spend: 12_345, impressions: 900, clicks: 30 }),
              day(daysBefore(today(), 1), { spend: 6_000 }),
              day(today(), { spend: 3_000 }),
            ]),
          ]),
        ]),
      });

      // Connecting ran the sync; nobody pressed anything.
      expect(provider.fetched).toHaveLength(1);
      expect(provider.fetched[0]).toMatchObject({
        from: daysBefore(today(), DEFAULT_BACKFILL_DAYS),
        to: today(),
      });

      // The point of a backfill: the page is worth reading on the day the
      // merchant connected, including a day six weeks old.
      const line = await campaignLine(fixture.admin.client, 'cmp_1');
      expect(line.spend).toBe(12_345 + 6_000 + 3_000);
      expect(line.impressions).toBe(900);
      expect(line.clicks).toBe(30);

      const connection = await readConnection(fixture.admin.client);
      expect(connection.lastSyncedAt).toBeTruthy();
      expect(connection.lastSyncError).toBeNull();
    });

    it('asks for no more history than the platform will report', async () => {
      provider.maxBackfillDays = 14;
      await connect(fixture.admin.client, { holds: tree([]) });

      expect(provider.fetched[0].from).toBe(daysBefore(today(), 14));
    });

    it('re-asks only for a trailing window once it has synced', async () => {
      await connect(fixture.admin.client, { holds: tree([]) });
      const outcome = await refresh(fixture.admin.client);

      const [first, second] = provider.fetched;
      expect(first.from).toBe(daysBefore(today(), DEFAULT_BACKFILL_DAYS));
      // Platforms restate for days after the fact, so a sync overlaps what it
      // already holds rather than asking only for today.
      expect(outcome.backfill).toBe(false);
      expect(second.from).toBe(daysBefore(today(), RESTATEMENT_DAYS));
      expect(second.to).toBe(today());
    });

    it('keeps the connection when the first sync fails, and says why', async () => {
      provider.setAdTree('act_100', tree([]));
      // Fail every tree read, but not the connection itself.
      const fetchAdTree = provider.fetchAdTree.bind(provider);
      provider.fetchAdTree = () =>
        Promise.reject(new Error('upstream quota exhausted'));
      try {
        await connect(fixture.admin.client);
      } finally {
        provider.fetchAdTree = fetchAdTree;
      }

      const connection = await readConnection(fixture.admin.client);
      expect(connection.status).toBe('connected');
      expect(connection.lastSyncedAt).toBeNull();
      expect(connection.lastSyncError).toBeTruthy();

      // And the next sync is still the backfill it never got.
      const outcome = await refresh(fixture.admin.client);
      expect(outcome.status).toBe('synced');
      expect(outcome.backfill).toBe(true);
    });
  });

  // ─── Discovery ──────────────────────────────────────────────────────────────

  describe('a campaign built in Ads Manager', () => {
    it('is inserted with its ads, names, schedule, formats and platform ids', async () => {
      const starts = new Date('2026-08-01T00:00:00.000Z');
      await connect(fixture.admin.client, {
        holds: tree([
          campaign(
            '120210000000001',
            [
              ad('120210000000011', [day(today(), { spend: 500 })], {
                name: 'Spring reel',
                format: 'video',
              }),
              ad('120210000000012', [], {
                name: 'Spring carousel',
                format: 'carousel',
              }),
            ],
            { name: 'Spring sale', signals: { startsAt: starts } },
          ),
        ]),
      });

      const line = await campaignLine(fixture.admin.client, '120210000000001');
      expect(line).toMatchObject({
        name: 'Spring sale',
        platform: 'meta',
        status: 'active',
        startsAt: starts.toISOString(),
        endsAt: null,
      });
      expect(
        line.ads
          .map((a) => ({
            externalId: a.externalId,
            name: a.name,
            format: a.format,
          }))
          .sort((x, y) => x.externalId.localeCompare(y.externalId)),
      ).toEqual([
        { externalId: '120210000000011', name: 'Spring reel', format: 'video' },
        {
          externalId: '120210000000012',
          name: 'Spring carousel',
          format: 'carousel',
        },
      ]);
    });

    it('reads Not Tracked rather than as a campaign that earned nothing', async () => {
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_untagged', [
            ad('ad_untagged', [day(today(), { spend: 2_500 })]),
          ]),
        ]),
      });

      const line = await campaignLine(fixture.admin.client, 'cmp_untagged');
      // Spend with no revenue beside it is the reading this flag exists to
      // prevent: the page says the revenue is unknown, not that it is zero.
      expect(line.hasLinkTags).toBe(false);
      expect(line.ads[0].hasLinkTags).toBe(false);
      expect(line.spend).toBe(2_500);
    });

    it('reports what it discovered, and discovers nothing the second time', async () => {
      provider.setAdTree(
        'act_100',
        tree([
          campaign('cmp_1', [ad('ad_1'), ad('ad_2')]),
          campaign('cmp_2', []),
        ]),
      );
      await connect(fixture.admin.client);
      // The connect already discovered them, so a refresh finds nothing new.
      const again = await refresh(fixture.admin.client);
      expect(again).toMatchObject({ campaignsDiscovered: 0, adsDiscovered: 0 });

      provider.setAdTree(
        'act_100',
        tree([
          campaign('cmp_1', [ad('ad_1'), ad('ad_2'), ad('ad_3')]),
          campaign('cmp_2', []),
          campaign('cmp_3', [ad('ad_4')]),
        ]),
      );
      const later = await refresh(fixture.admin.client);
      expect(later).toMatchObject({ campaignsDiscovered: 1, adsDiscovered: 2 });
    });
  });

  // ─── The same sync twice ────────────────────────────────────────────────────

  describe('idempotency', () => {
    const holds = () =>
      tree([
        campaign('cmp_1', [
          ad('ad_1', [
            day(daysBefore(today(), 3), {
              spend: 1_111,
              impressions: 10,
              clicks: 1,
            }),
            day(daysBefore(today(), 2), {
              spend: 2_222,
              impressions: 20,
              clicks: 2,
            }),
          ]),
          ad('ad_2', [day(daysBefore(today(), 2), { spend: 3_333 })]),
        ]),
      ]);

    it('produces the same rows, not doubled ones', async () => {
      await connect(fixture.admin.client, { holds: holds() });
      const once = await rowCounts();
      const figuresOnce = await figureRows();

      await refresh(fixture.admin.client);
      await sync.syncAllConnections(new Date(Date.now() + 2 * 60 * 60 * 1000));

      expect(await rowCounts()).toEqual(once);
      expect(await figureRows()).toEqual(figuresOnce);
      expect(once).toEqual({
        campaigns: 1,
        ads: 2,
        figures: 3,
        spend: 1_111 + 2_222 + 3_333,
      });
    });

    it('overwrites a day the platform restated instead of adding to it', async () => {
      await connect(fixture.admin.client, { holds: holds() });

      provider.setAdTree(
        'act_100',
        tree([
          campaign('cmp_1', [
            ad('ad_1', [
              day(daysBefore(today(), 3), {
                spend: 1_111,
                impressions: 10,
                clicks: 1,
              }),
              // Restated upward two days later, as platforms do.
              day(daysBefore(today(), 2), {
                spend: 2_500,
                impressions: 25,
                clicks: 3,
              }),
            ]),
            // Restated to nothing: the day is gone from the report.
            ad('ad_2', []),
          ]),
        ]),
      );
      await refresh(fixture.admin.client);

      expect(await figureRows()).toEqual([
        {
          externalId: 'ad_1',
          day: daysBefore(today(), 3),
          spend: 1_111,
          impressions: 10,
          clicks: 1,
        },
        {
          externalId: 'ad_1',
          day: daysBefore(today(), 2),
          spend: 2_500,
          impressions: 25,
          clicks: 3,
        },
      ]);
    });

    it('leaves days older than the trailing window alone', async () => {
      const old = daysBefore(today(), 30);
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [ad('ad_1', [day(old, { spend: 9_000 })])]),
        ]),
      });

      // The trailing sync does not ask for that day and the platform does not
      // send it; it must not be taken as restated to nothing.
      provider.setAdTree('act_100', tree([campaign('cmp_1', [ad('ad_1')])]));
      await refresh(fixture.admin.client);

      expect(await figureRows()).toEqual([
        expect.objectContaining({ externalId: 'ad_1', day: old, spend: 9_000 }),
      ]);
    });

    it('holds spend as integer minor units', async () => {
      await connect(fixture.admin.client, { holds: holds() });
      for (const row of await figureRows()) {
        expect(Number.isInteger(row.spend)).toBe(true);
      }
    });
  });

  // ─── Tracked ────────────────────────────────────────────────────────────────

  describe('link tags', () => {
    it('marks a campaign Tracked when every one of its ads carries ours', async () => {
      provider.setLinkTags('ad_a', buildLinkTags());
      provider.setLinkTags(
        'ad_b',
        'utm_source=facebook&utm_campaign={{campaign.id}}&utm_content={{ad.id}}',
      );
      await connect(fixture.admin.client, {
        holds: tree([campaign('cmp_tagged', [ad('ad_a'), ad('ad_b')])]),
      });

      const line = await campaignLine(fixture.admin.client, 'cmp_tagged');
      expect(line.hasLinkTags).toBe(true);
      expect(line.ads.every((a) => a.hasLinkTags)).toBe(true);
    });

    it('keeps a campaign Not Tracked while any one of its ads lacks them', async () => {
      provider.setLinkTags('ad_a', buildLinkTags());
      provider.setLinkTags('ad_b', 'utm_campaign=spring-sale');
      await connect(fixture.admin.client, {
        holds: tree([campaign('cmp_mixed', [ad('ad_a'), ad('ad_b')])]),
      });

      const line = await campaignLine(fixture.admin.client, 'cmp_mixed');
      expect(line.hasLinkTags).toBe(false);
      expect(
        Object.fromEntries(line.ads.map((a) => [a.externalId, a.hasLinkTags])),
      ).toEqual({ ad_a: true, ad_b: false });
    });

    it('reads each ad’s tags once, not on every sync', async () => {
      provider.setLinkTags('ad_a', buildLinkTags());
      await connect(fixture.admin.client, {
        holds: tree([campaign('cmp_1', [ad('ad_a')])]),
      });
      await refresh(fixture.admin.client);
      await refresh(fixture.admin.client);

      expect(provider.tagReadsFor('ad_a')).toBe(1);

      // A new ad under the same campaign is read when it appears, and the
      // campaign's flag follows what it carries.
      provider.setAdTree(
        'act_100',
        tree([campaign('cmp_1', [ad('ad_a'), ad('ad_new')])]),
      );
      await refresh(fixture.admin.client);

      expect(provider.tagReadsFor('ad_a')).toBe(1);
      expect(provider.tagReadsFor('ad_new')).toBe(1);
      expect(
        (await campaignLine(fixture.admin.client, 'cmp_1')).hasLinkTags,
      ).toBe(false);
    });

    it('leaves an ad whose tags could not be read owed, and reads it next time', async () => {
      provider.setLinkTags('ad_a', buildLinkTags());
      provider.failTagReads = true;
      await connect(fixture.admin.client, {
        holds: tree([campaign('cmp_1', [ad('ad_a')])]),
      });

      // Not read is not the same as untagged, but until it is read the
      // conservative answer is Not Tracked — and the figures still landed.
      const before = await campaignLine(fixture.admin.client, 'cmp_1');
      expect(before.hasLinkTags).toBe(false);
      expect(
        (await readConnection(fixture.admin.client)).lastSyncError,
      ).toBeNull();

      provider.failTagReads = false;
      await refresh(fixture.admin.client);

      expect(provider.tagReadsFor('ad_a')).toBe(2);
      expect(
        (await campaignLine(fixture.admin.client, 'cmp_1')).hasLinkTags,
      ).toBe(true);
    });
  });

  // ─── Status ─────────────────────────────────────────────────────────────────

  describe('status', () => {
    it('collapses the platform’s signals for campaigns and ads alike', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_live', [
            ad('ad_paused', [], { signals: { delivery: 'paused' } }),
            ad('ad_rejected', [], { signals: { review: 'rejected' } }),
            ad('ad_review', [], {
              signals: { delivery: 'pending_review', review: 'in_review' },
            }),
          ]),
          campaign('cmp_paused', [], { signals: { delivery: 'paused' } }),
          campaign('cmp_finished', [], { signals: { endsAt: past } }),
        ]),
      });

      const page = await report(fixture.admin.client);
      const statusOf = Object.fromEntries(
        page.campaigns.map((c) => [c.externalId, c.status]),
      );
      expect(statusOf).toEqual({
        cmp_live: 'active',
        cmp_paused: 'paused',
        cmp_finished: 'ended',
      });

      const live = page.campaigns.find((c) => c.externalId === 'cmp_live')!;
      expect(
        Object.fromEntries(live.ads.map((a) => [a.externalId, a.status])),
      ).toEqual({
        ad_paused: 'paused',
        ad_rejected: 'needs_attention',
        ad_review: 'in_review',
      });
    });

    it('reads a campaign deleted on the platform as Ended and keeps its history', async () => {
      const spentOn = daysBefore(today(), 2);
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_doomed', [
            ad('ad_1', [day(spentOn, { spend: 7_700 })]),
          ]),
        ]),
      });

      provider.setAdTree(
        'act_100',
        tree([
          campaign(
            'cmp_doomed',
            [
              ad('ad_1', [day(spentOn, { spend: 7_700 })], {
                signals: { delivery: 'deleted' },
              }),
            ],
            { signals: { delivery: 'deleted' } },
          ),
        ]),
      );
      await refresh(fixture.admin.client);

      const line = await campaignLine(fixture.admin.client, 'cmp_doomed');
      expect(line.status).toBe('ended');
      expect(line.ads[0].status).toBe('ended');
      expect(line.spend).toBe(7_700);
    });

    it('ends a campaign the platform stopped reporting, without removing it', async () => {
      const spentOn = daysBefore(today(), 20);
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_gone', [ad('ad_1', [day(spentOn, { spend: 4_000 })])]),
          campaign('cmp_stays', [ad('ad_2')]),
        ]),
      });

      provider.setAdTree(
        'act_100',
        tree([campaign('cmp_stays', [ad('ad_2')])]),
      );
      await refresh(fixture.admin.client);

      const gone = await campaignLine(fixture.admin.client, 'cmp_gone');
      expect(gone.status).toBe('ended');
      expect(gone.ads[0].status).toBe('ended');
      expect(gone.spend).toBe(4_000);
      expect(
        (await campaignLine(fixture.admin.client, 'cmp_stays')).status,
      ).toBe('active');
    });
  });

  // ─── Creatives ──────────────────────────────────────────────────────────────

  describe('creatives', () => {
    const signed = (name: string) =>
      `https://scontent.platform.test/${name}.jpg?oh=signed&oe=expires`;

    it('are copied into our own storage on first sight, never stored as the platform’s link', async () => {
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [ad('ad_1', [], { creativeUrl: signed('one') })]),
        ]),
      });

      const line = await campaignLine(fixture.admin.client, 'cmp_1');
      const stored = line.ads[0].creativeUrl;
      expect(stored).toMatch(/^https:\/\/cdn\.test\.invalid\/ad-creatives\//);
      expect(stored).toContain(fixture.organizationId);
      expect(storage.stored).toEqual([
        expect.objectContaining({ contentType: 'image/jpeg' }),
      ]);

      await refresh(fixture.admin.client);
      // First sight only: the copy is ours now and does not expire.
      expect(provider.creativeFetches).toEqual([signed('one')]);
    });

    it('take the cover from the ad that spent the most', async () => {
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [
            ad('ad_small', [day(today(), { spend: 100 })], {
              creativeUrl: signed('small'),
            }),
            ad('ad_big', [day(today(), { spend: 9_000 })], {
              creativeUrl: signed('big'),
            }),
          ]),
        ]),
      });

      const line = await campaignLine(fixture.admin.client, 'cmp_1');
      const big = line.ads.find((a) => a.externalId === 'ad_big')!;
      expect(line.coverUrl).toBe(big.creativeUrl);
    });

    it('retries a copy that failed rather than keeping the expiring link', async () => {
      provider.failCreatives = true;
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [ad('ad_1', [], { creativeUrl: signed('one') })]),
        ]),
      });
      expect(
        (await campaignLine(fixture.admin.client, 'cmp_1')).ads[0].creativeUrl,
      ).toBeNull();

      provider.failCreatives = false;
      await refresh(fixture.admin.client);

      expect(
        (await campaignLine(fixture.admin.client, 'cmp_1')).ads[0].creativeUrl,
      ).toMatch(/^https:\/\/cdn\.test\.invalid\//);
    });
  });

  // ─── History still being gathered ───────────────────────────────────────────

  describe('a platform still gathering history', () => {
    it('writes what arrived but does not count the range as covered', async () => {
      await connect(fixture.admin.client, {
        holds: tree(
          [campaign('cmp_1', [ad('ad_1', [day(today(), { spend: 1_500 })])])],
          { complete: false },
        ),
      });

      expect((await campaignLine(fixture.admin.client, 'cmp_1')).spend).toBe(
        1_500,
      );
      const connection = await readConnection(fixture.admin.client);
      expect(connection.lastSyncedAt).toBeNull();
      expect(connection.lastSyncError).toMatch(/still gathering/i);
      expect(connection.lastSyncError).not.toMatch(/your (ad )?account/i);

      // The next sync asks for the whole history again, not a trailing week.
      provider.setAdTree(
        'act_100',
        tree([
          campaign('cmp_1', [ad('ad_1', [day(today(), { spend: 1_500 })])]),
        ]),
      );
      const outcome = await refresh(fixture.admin.client);
      expect(outcome).toMatchObject({ status: 'synced', backfill: true });
      expect(provider.fetched[1].from).toBe(
        daysBefore(today(), DEFAULT_BACKFILL_DAYS),
      );
    });

    it('does not end campaigns it may simply not have been sent yet', async () => {
      await connect(fixture.admin.client, {
        holds: tree([campaign('cmp_1', [ad('ad_1')]), campaign('cmp_2', [])]),
      });

      provider.setAdTree(
        'act_100',
        tree([campaign('cmp_1', [ad('ad_1')])], { complete: false }),
      );
      const outcome = await refresh(fixture.admin.client);

      expect(outcome.status).toBe('partial');
      expect((await campaignLine(fixture.admin.client, 'cmp_2')).status).toBe(
        'active',
      );
    });
  });

  // ─── When the platform does not answer ──────────────────────────────────────

  describe('a provider failure', () => {
    it('leaves the figures already held readable and surfaces the failure beside them', async () => {
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [ad('ad_1', [day(today(), { spend: 4_200 })])]),
        ]),
      });
      const before = await readConnection(fixture.admin.client);

      provider.failAlways = new Error('upstream quota exhausted');
      const outcome = await refresh(fixture.admin.client);

      // A 201 carrying a failure, not a 500 on a button the merchant pressed.
      expect(outcome.status).toBe('failed');
      expect(outcome.message).toBeTruthy();
      // The refusal is frequently a quota shared across every customer of the
      // provider, so the sentence must not send the merchant to check their
      // own ad account.
      expect(outcome.message).not.toMatch(/your (ad )?account/i);

      // The page still reads, and still shows what it had.
      expect((await campaignLine(fixture.admin.client, 'cmp_1')).spend).toBe(
        4_200,
      );

      const after = await readConnection(fixture.admin.client);
      expect(after.lastSyncError).toBe(outcome.message);
      // Still pointing at the last success, which is what makes the figures
      // legibly stale rather than silently so.
      expect(after.lastSyncedAt).toBe(before.lastSyncedAt);
      expect(new Date(after.lastSyncAttemptAt!).getTime()).toBeGreaterThan(
        new Date(before.lastSyncAttemptAt!).getTime(),
      );
    });

    it('backs the connection off rather than retrying it hard', async () => {
      await connect(fixture.admin.client, { holds: tree([]) });
      provider.failAlways = new Error('429 from a shared quota');

      await refresh(fixture.admin.client);

      const [row] = await db
        .select()
        .from(adPlatformConnections)
        .where(
          and(
            eq(adPlatformConnections.organizationId, fixture.organizationId),
            eq(adPlatformConnections.platform, 'meta'),
          ),
        );
      expect(row.syncFailureCount).toBe(1);
      expect(row.syncPausedUntil!.getTime()).toBeGreaterThan(Date.now());

      // The schedule skips it while it is backed off; a merchant pressing the
      // button is not a retry loop and is never held by it.
      const due = await connections.findDueForSync(new Date());
      expect(due.map((d) => d.connection.id)).not.toContain(row.id);

      const later = new Date(row.syncPausedUntil!.getTime() + 1000);
      expect(
        (await connections.findDueForSync(later)).map((d) => d.connection.id),
      ).toContain(row.id);
    });

    it('clears the failure once the platform answers again', async () => {
      await connect(fixture.admin.client, { holds: tree([]) });

      provider.failAlways = new Error('the vendor is down');
      await refresh(fixture.admin.client);
      expect(
        (await readConnection(fixture.admin.client)).lastSyncError,
      ).toBeTruthy();

      provider.failAlways = null;
      const outcome = await refresh(fixture.admin.client);

      expect(outcome.status).toBe('synced');
      const connection = await readConnection(fixture.admin.client);
      expect(connection.lastSyncError).toBeNull();
      expect(connection.syncPausedUntil).toBeNull();
      expect(connection.lastSyncedAt).toBeTruthy();
    });

    it('refuses a tree in a currency the account was not connected in', async () => {
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [ad('ad_1', [day(today(), { spend: 1_000 })])]),
        ]),
      });

      provider.setAdTree(
        'act_100',
        tree(
          [campaign('cmp_1', [ad('ad_1', [day(today(), { spend: 99_999 })])])],
          { currency: 'EUR' },
        ),
      );
      const outcome = await refresh(fixture.admin.client);

      expect(outcome.status).toBe('failed');
      expect((await campaignLine(fixture.admin.client, 'cmp_1')).spend).toBe(
        1_000,
      );
    });
  });

  // ─── Tenancy ────────────────────────────────────────────────────────────────

  describe('tenancy', () => {
    it('keeps a store’s campaigns and figures unreachable from another Organization', async () => {
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_private', [
            ad('ad_private', [day(today(), { spend: 5_000 })]),
          ]),
        ]),
      });
      const mine = await campaignLine(fixture.admin.client, 'cmp_private');

      const other = await seedAdmin(app);
      try {
        await other.admin.client
          .get(`/campaigns/${mine.campaignId}`)
          .expect(404);
        await other.admin.client
          .get(`/campaigns/${mine.campaignId}/ads`)
          .expect(404);
        const theirs = await report(other.admin.client);
        expect(theirs.campaigns).toEqual([]);

        // Their own sync, of their own account, touches none of it.
        await connect(other.admin.client, {
          accountId: 'act_200',
          holds: tree([
            campaign('cmp_private', [
              ad('ad_private', [day(today(), { spend: 1 })]),
            ]),
          ]),
        });
        expect(
          (await campaignLine(fixture.admin.client, 'cmp_private')).spend,
        ).toBe(5_000);
        expect(
          (await campaignLine(other.admin.client, 'cmp_private')).campaignId,
        ).not.toBe(mine.campaignId);
      } finally {
        await destroyAdmin(app, other);
      }
    });
  });

  // ─── The sync as a plain method ─────────────────────────────────────────────

  describe('the sync as a plain method', () => {
    it('runs every due connection without involving the scheduler', async () => {
      await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [ad('ad_1', [day(today(), { spend: 9_900 })])]),
        ]),
      });

      const outcomes = await sync.syncAllConnections();

      expect(outcomes.some((o) => o.status === 'synced')).toBe(true);
      expect(provider.fetched.length).toBeGreaterThanOrEqual(2);
    });

    it('records when the sync last succeeded, so a stale figure is legibly stale', async () => {
      const before = Date.now();
      await connect(fixture.admin.client, { holds: tree([]) });
      const connection = await readConnection(fixture.admin.client);

      expect(
        new Date(connection.lastSyncedAt!).getTime(),
      ).toBeGreaterThanOrEqual(before - 1000);
      expect(connection.lastSyncError).toBeNull();
    });

    it('only reads from the platform', async () => {
      const { providerRef, accountId } = await connect(fixture.admin.client, {
        holds: tree([
          campaign('cmp_1', [
            ad('ad_1', [], {
              creativeUrl: 'https://scontent.platform.test/a.jpg',
            }),
          ]),
        ]),
      });
      const disconnectsBefore = provider.disconnected.length;
      const revokesBefore = provider.revoked.length;

      await refresh(fixture.admin.client);

      // Every call a sync makes is a read, against the account the merchant
      // approved: the tree, the tags, and the creative.
      expect(provider.fetched).toEqual([
        expect.objectContaining({ providerRef, externalAccountId: accountId }),
        expect.objectContaining({ providerRef, externalAccountId: accountId }),
      ]);
      expect(provider.tagReads).toEqual([
        { providerRef, externalAdId: 'ad_1' },
      ]);
      expect(provider.purchases).toHaveLength(0);
      expect(provider.disconnected).toHaveLength(disconnectsBefore);
      expect(provider.revoked).toHaveLength(revokesBefore);
    });
  });

  describe('permissions', () => {
    it('lets a product manager refresh and read the connection', async () => {
      await connect(fixture.admin.client, { holds: tree([]) });
      const manager = await fixture.addUser('product_manager');

      await manager.client.post('/ad-platforms/meta/sync').expect(201);
      await manager.client.get('/ad-platforms').expect(200);
    });

    it('keeps a support agent out of the ad account entirely', async () => {
      await connect(fixture.admin.client);
      const agent = await fixture.addUser('support_agent');

      await agent.client.get('/ad-platforms').expect(403);
      await agent.client.post('/ad-platforms/meta/sync').expect(403);
    });
  });
});
