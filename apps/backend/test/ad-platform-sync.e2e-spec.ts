/**
 * Syncing what the ad platform already knows, end to end.
 *
 * The seam runs from the fake provider returning a tree, through the real sync
 * against a real database, to the merchant reading the result back through the
 * admin API — no repository is mocked and nothing is asserted about how a
 * payload was parsed. What is asserted is what a merchant ends up able to read,
 * against figures worked out by hand.
 *
 * The ad platform is the in-memory fake swapped in through the same
 * `overrideProvider` seam the payment provider's fake uses. Everything else is
 * production wiring against a local Postgres database.
 *
 * **The schedule is not tested here.** That a `@Cron` decorator fires is the
 * framework's behaviour; the sync is a plain public method and is invoked as
 * one.
 */
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  adPlatformConnections,
  adReportedFigures,
  ads,
  campaignSpend,
} from '../src/shared/database/schema';
import type { AdPlatform } from '../src/shared/database/schema';
import type { AdPlatformConnectionView } from '../src/modules/ad-platform/services/ad-platform-connection.service';
import type { ReportedFigureView } from '../src/modules/ad-platform/services/reported-figure.service';
import type {
  AdTree,
  ReportedAd,
  ReportedAdDay,
} from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import { AdPlatformSyncService } from '../src/modules/ad-platform/services/ad-platform-sync.service';
import { AdPlatformConnectionRepository } from '../src/modules/ad-platform/repositories/ad-platform-connection.repository';
import {
  DEFAULT_BACKFILL_DAYS,
  RESTATEMENT_DAYS,
  daysBefore,
} from '../src/modules/ad-platform/utils/sync-window.util';
import { createTestApp } from './helpers/test-app';
import type { AdminClient } from './helpers/admin-client';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

/** A tree written with only the fields a case cares about. */
interface TestAdTree {
  currency: string;
  ads: Array<
    Omit<ReportedAd, 'creativeUrl' | 'startsAt' | 'endsAt'> &
      Partial<Pick<ReportedAd, 'creativeUrl' | 'startsAt' | 'endsAt'>>
  >;
}

/** The store's timezone is UTC in the fixture, so its today is this one. */
const today = (): string => new Date().toISOString().slice(0, 10);

/** One day of figures, already in minor units the way the interface requires. */
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

describe('Ad platform sync (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let sync: AdPlatformSyncService;
  let connections: AdPlatformConnectionRepository;
  let fixture: AdminFixture;

  beforeAll(async () => {
    ({ app, adPlatform: provider } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
    sync = app.get(AdPlatformSyncService);
    connections = app.get(AdPlatformConnectionRepository);
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

  /** The whole connection round trip, ending with an approved ad account. */
  async function connect(
    client: AdminClient,
    platform: AdPlatform = 'meta',
    account: { currency?: string } = {},
  ): Promise<{ providerRef: string; accountId: string }> {
    const res = await client
      .post(`/ad-platforms/${platform}/connect`)
      .expect(201);
    const { approvalUrl } = res.body as { approvalUrl: string };
    const returnUrl = new URL(
      decodeURIComponent(new URL(approvalUrl).searchParams.get('return') ?? ''),
    );

    const { providerRef } = provider.begun[provider.begun.length - 1];
    const approved = provider.approve(providerRef, platform, account);

    await request(app.getHttpServer())
      .get(`${returnUrl.pathname}${returnUrl.search}`)
      .expect(302);

    return { providerRef, accountId: approved.externalAccountId };
  }

  /**
   * What the platform will say is running on this account.
   *
   * An ad may be written with only the fields the case is about. The creative
   * and the flight default to absent, which is what most platform ads report
   * and what most of these cases are indifferent to.
   */
  function platformReports(
    providerRef: string,
    tree: TestAdTree,
    platform: AdPlatform = 'meta',
  ): void {
    provider.setAdTree(providerRef, platform, {
      currency: tree.currency,
      ads: tree.ads.map((ad) => ({
        creativeUrl: null,
        startsAt: null,
        endsAt: null,
        ...ad,
      })),
    } satisfies AdTree);
  }

  const syncNow = async (
    client: AdminClient,
    platform: AdPlatform = 'meta',
  ): Promise<
    Array<{
      platform: AdPlatform;
      status: string;
      from: string;
      to: string;
      backfill: boolean;
      figuresWritten: number;
      message: string | null;
    }>
  > => {
    const res = await client.post(`/ad-platforms/${platform}/sync`).expect(201);
    return res.body as never;
  };

  const readFigures = async (
    client: AdminClient,
    query: Record<string, string> = {},
  ): Promise<ReportedFigureView[]> => {
    const res = await client
      .get('/ad-platforms/reported-figures')
      .query({ from: daysBefore(today(), 365), to: today(), ...query })
      .expect(200);
    return res.body as ReportedFigureView[];
  };

  const readConnection = async (
    client: AdminClient,
    platform: AdPlatform = 'meta',
  ): Promise<AdPlatformConnectionView> => {
    const res = await client.get('/ad-platforms').expect(200);
    const found = (res.body as AdPlatformConnectionView[]).find(
      (c) => c.platform === platform,
    );
    if (!found) throw new Error(`no ${platform} connection on this store`);
    return found;
  };

  const countFigures = async (): Promise<number> => {
    const rows = await db
      .select({ id: adReportedFigures.id })
      .from(adReportedFigures)
      .where(eq(adReportedFigures.organizationId, fixture.organizationId));
    return rows.length;
  };

  // ─── Pulling figures ────────────────────────────────────────────────────────

  describe('what a sync records', () => {
    it("stores the platform's figures per platform ad per day", async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [
              day(today(), {
                spend: 267500,
                impressions: 94_000,
                clicks: 1_820,
                conversions: 43,
                reportedRevenue: 668_750,
                reportedRoasBp: 25000,
              }),
            ],
          },
        ],
      });

      const [outcome] = await syncNow(fixture.admin.client);
      expect(outcome.status).toBe('synced');
      expect(outcome.figuresWritten).toBe(1);

      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(1);
      // Worked out by hand: $2,675.00 spend, $6,687.50 revenue, 2.5x ROAS —
      // integers in minor units and basis points, with nothing recomputed.
      expect(figures[0]).toMatchObject({
        platform: 'meta',
        externalAdId: 'ad_meta_1',
        day: today(),
        spend: 267500,
        impressions: 94_000,
        clicks: 1_820,
        conversions: 43,
        reportedRevenue: 668_750,
        reportedRoasBp: 25000,
        currency: 'USD',
      });
    });

    it('holds figures under the platform ad id, with no Ad created for them', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_nobody_claims',
            name: 'Built in Business Suite',
            days: [day(today(), { spend: 1_000 })],
          },
        ],
      });

      await syncNow(fixture.admin.client);

      // Nothing in this store claims that ad, and the sync did not invent
      // anything to claim it: an Ad conjured from a sync would carry real cost
      // and have no way to earn revenue, so it would read as the worst
      // performer in the account. Claiming is a merchant's decision, and it is
      // ticket 03's.
      const created = await db
        .select({ id: ads.id })
        .from(ads)
        .where(eq(ads.organizationId, fixture.organizationId));
      expect(created).toEqual([]);

      const figures = await readFigures(fixture.admin.client);
      expect(figures.map((f) => f.externalAdId)).toEqual(['ad_nobody_claims']);
    });

    it('never writes a platform figure into campaign_spend', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 500_00 })],
          },
        ],
      });

      await syncNow(fixture.admin.client);

      // ADR-0005: `campaign_spend` is the merchant's book of record and this is
      // the platform's. A sync that wrote into it would make a spend total
      // incomparable with itself.
      const spendRows = await db
        .select({ id: campaignSpend.id })
        .from(campaignSpend)
        .where(eq(campaignSpend.organizationId, fixture.organizationId));
      expect(spendRows).toEqual([]);
      expect(await countFigures()).toBe(1);
    });
  });

  // ─── Day one, and every day after ───────────────────────────────────────────

  describe('the first sync', () => {
    it('backfills the history the platform offers rather than starting from today', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      const longAgo = daysBefore(today(), 45);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [
              day(longAgo, { spend: 12_345 }),
              day(daysBefore(today(), 1), { spend: 6_000 }),
              day(today(), { spend: 3_000 }),
            ],
          },
        ],
      });

      const [outcome] = await syncNow(fixture.admin.client);

      expect(outcome.backfill).toBe(true);
      expect(provider.fetched).toHaveLength(1);
      expect(provider.fetched[0]).toMatchObject({
        from: daysBefore(today(), DEFAULT_BACKFILL_DAYS),
        to: today(),
      });

      // The point of a backfill: the merchant reads history on the day they
      // connected, not in a month.
      const figures = await readFigures(fixture.admin.client);
      expect(figures.map((f) => f.day)).toEqual([
        longAgo,
        daysBefore(today(), 1),
        today(),
      ]);
      expect(figures[0].spend).toBe(12_345);
    });

    it('asks for no more history than the platform will report', async () => {
      provider.maxBackfillDays = 14;
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, { currency: 'USD', ads: [] });

      await syncNow(fixture.admin.client);

      expect(provider.fetched[0].from).toBe(daysBefore(today(), 14));
    });

    it('re-asks only for a trailing window once it has synced', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, { currency: 'USD', ads: [] });

      await syncNow(fixture.admin.client);
      await syncNow(fixture.admin.client);

      const [first, second] = provider.fetched;
      expect(first.from).toBe(daysBefore(today(), DEFAULT_BACKFILL_DAYS));
      // Platforms restate for days after the fact, so a sync overlaps what it
      // already holds rather than asking only for today.
      expect(second.from).toBe(daysBefore(today(), RESTATEMENT_DAYS));
      expect(second.to).toBe(today());
    });
  });

  describe('running the same sync twice', () => {
    it('produces the same rows, not doubled ones', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [
              day(daysBefore(today(), 1), { spend: 6_000, clicks: 40 }),
              day(today(), { spend: 3_000, clicks: 20 }),
            ],
          },
          {
            externalAdId: 'ad_meta_2',
            name: 'Carousel',
            days: [day(today(), { spend: 1_500, clicks: 9 })],
          },
        ],
      });

      await syncNow(fixture.admin.client);
      const afterFirst = await readFigures(fixture.admin.client);

      await syncNow(fixture.admin.client);
      const afterSecond = await readFigures(fixture.admin.client);

      expect(await countFigures()).toBe(3);
      expect(afterSecond.map(({ syncedAt: _, ...rest }) => rest)).toEqual(
        afterFirst.map(({ syncedAt: _, ...rest }) => rest),
      );
      // The spend a merchant reads is the same figure, not twice the figure.
      expect(afterSecond.reduce((sum, f) => sum + f.spend, 0)).toBe(10_500);
    });

    it('corrects a day the platform restated', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 3_000, conversions: 2 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);

      // The platform finishes attributing and restates the same day.
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 3_000, conversions: 5 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);

      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(1);
      expect(figures[0].conversions).toBe(5);
    });
  });

  // ─── Currency ───────────────────────────────────────────────────────────────

  describe('a figure in another currency', () => {
    it('is stored as that currency, with no rate applied anywhere', async () => {
      // The store bills in USD; the ad account bills in EUR. ADR-0005 forbids
      // converting one into the other — an invented rate inside a margin is the
      // failure class this whole feature exists to avoid.
      const { providerRef } = await connect(fixture.admin.client, 'meta', {
        currency: 'EUR',
      });
      platformReports(providerRef, {
        currency: 'EUR',
        ads: [
          {
            externalAdId: 'ad_meta_eu',
            name: 'EU reel',
            days: [day(today(), { spend: 100_00, reportedRevenue: 250_00 })],
          },
        ],
      });

      await syncNow(fixture.admin.client);

      const [figure] = await readFigures(fixture.admin.client);
      expect(figure.currency).toBe('EUR');
      // The exact figure the platform stated, untouched.
      expect(figure.spend).toBe(100_00);
      expect(figure.reportedRevenue).toBe(250_00);
    });
  });

  // ─── When the platform does not answer ──────────────────────────────────────

  describe('a provider failure', () => {
    it('is surfaced on the page instead of thrown into the merchant read', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 4_200 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);
      const before = await readConnection(fixture.admin.client);

      provider.failAlways = new Error('upstream quota exhausted');
      const [outcome] = await syncNow(fixture.admin.client);

      // A 201 carrying a failure, not a 500 on a button the merchant pressed.
      expect(outcome.status).toBe('failed');
      expect(outcome.message).toBeTruthy();
      // The refusal is frequently a quota shared across every customer of the
      // provider, so the sentence must not send the merchant to check their
      // own ad account.
      expect(outcome.message).not.toMatch(/your (ad )?account/i);

      const after = await readConnection(fixture.admin.client);
      expect(after.lastSyncError).toBe(outcome.message);
      // Still pointing at the last success, which is what makes the figures
      // legibly stale rather than silently so.
      expect(after.lastSyncedAt).toBe(before.lastSyncedAt);
      expect(new Date(after.lastSyncAttemptAt!).getTime()).toBeGreaterThan(
        new Date(before.lastSyncAttemptAt!).getTime(),
      );
    });

    it('leaves the figures already pulled readable', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 4_200, clicks: 17 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);

      provider.failAlways = new Error('the vendor is down');
      await syncNow(fixture.admin.client);

      // A vendor outage costs freshness, not the dashboard.
      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(1);
      expect(figures[0]).toMatchObject({ spend: 4_200, clicks: 17 });
    });

    it('backs the connection off rather than retrying it hard', async () => {
      await connect(fixture.admin.client);
      provider.failAlways = new Error('429 from a shared quota');

      await syncNow(fixture.admin.client);

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
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, { currency: 'USD', ads: [] });

      provider.failAlways = new Error('the vendor is down');
      await syncNow(fixture.admin.client);
      expect(
        (await readConnection(fixture.admin.client)).lastSyncError,
      ).toBeTruthy();

      provider.failAlways = null;
      const [outcome] = await syncNow(fixture.admin.client);

      expect(outcome.status).toBe('synced');
      const connection = await readConnection(fixture.admin.client);
      expect(connection.lastSyncError).toBeNull();
      expect(connection.syncPausedUntil).toBeNull();
      expect(connection.lastSyncedAt).toBeTruthy();
    });
  });

  // ─── Freshness, and the method the schedule calls ───────────────────────────

  describe('the sync as a plain method', () => {
    it('runs every due connection without involving the scheduler', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 9_900 })],
          },
        ],
      });

      const outcomes = await sync.syncAllConnections();

      expect(outcomes.some((o) => o.status === 'synced')).toBe(true);
      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(1);
      expect(figures[0].spend).toBe(9_900);
    });

    it('records when the sync last succeeded, so a stale figure is legibly stale', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, { currency: 'USD', ads: [] });

      expect(
        (await readConnection(fixture.admin.client)).lastSyncedAt,
      ).toBeNull();

      const before = Date.now();
      await syncNow(fixture.admin.client);
      const connection = await readConnection(fixture.admin.client);

      expect(
        new Date(connection.lastSyncedAt!).getTime(),
      ).toBeGreaterThanOrEqual(before - 1000);
      expect(connection.lastSyncError).toBeNull();
    });

    it('never asks the platform to change anything', async () => {
      const { providerRef, accountId } = await connect(fixture.admin.client);
      platformReports(providerRef, { currency: 'USD', ads: [] });
      const disconnectsBefore = provider.disconnected.length;
      const revokesBefore = provider.revoked.length;

      await syncNow(fixture.admin.client);

      // Every call a sync makes is a read, against the account the merchant
      // approved. There is no write method on the provider to record.
      expect(provider.fetched).toEqual([
        expect.objectContaining({ providerRef, externalAccountId: accountId }),
      ]);
      expect(provider.disconnected).toHaveLength(disconnectsBefore);
      expect(provider.revoked).toHaveLength(revokesBefore);
    });
  });

  // ─── Whose figures these are ────────────────────────────────────────────────

  describe('scoping', () => {
    it('keeps figures unreachable from another organization', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 7_000 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);

      const other = await seedAdmin(app);
      try {
        expect(await readFigures(other.admin.client)).toEqual([]);
        // And a sync run by the other tenant reaches nothing of ours.
        const res = await other.admin.client
          .post('/ad-platforms/sync')
          .expect(201);
        expect(res.body).toEqual([]);

        expect(await readFigures(fixture.admin.client)).toHaveLength(1);
      } finally {
        await destroyAdmin(app, other);
      }
    });

    it('keeps one store of an organization out of another store of it', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 7_000 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);

      const { client: otherStore } = await fixture.addStore();
      expect(await readFigures(otherStore)).toEqual([]);
    });

    it('keeps figures readable after the platform is disconnected', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            days: [day(today(), { spend: 7_000 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);

      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      // Revoking access must not rewrite a past report.
      const figures = await readFigures(fixture.admin.client);
      expect(figures).toHaveLength(1);
      expect(figures[0].spend).toBe(7_000);

      // And a disconnected platform is not synced again.
      const res = await fixture.admin.client
        .post('/ad-platforms/sync')
        .expect(201);
      expect(res.body).toEqual([]);
    });
  });

  describe('permissions', () => {
    it('lets a product manager refresh and read the figures', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, { currency: 'USD', ads: [] });
      const manager = await fixture.addUser('product_manager');

      await manager.client.post('/ad-platforms/meta/sync').expect(201);
      await manager.client.get('/ad-platforms/reported-figures').expect(200);
    });

    it('keeps a support agent out of the ad account entirely', async () => {
      await connect(fixture.admin.client);
      const agent = await fixture.addUser('support_agent');

      await agent.client.get('/ad-platforms/reported-figures').expect(403);
      await agent.client.post('/ad-platforms/meta/sync').expect(403);
    });
  });
});
