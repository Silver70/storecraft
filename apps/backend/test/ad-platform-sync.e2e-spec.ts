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
import { adPlatformConnections } from '../src/shared/database/schema';
import type {
  Ad,
  AdPlatform,
  AdPlatformState,
} from '../src/shared/database/schema';
import type { AdPlatformConnectionView } from '../src/modules/ad-platform/services/ad-platform-connection.service';
import type {
  AdTree,
  ReportedAd,
  ReportedAdDay,
} from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import {
  AdPlatformSyncService,
  type SyncOutcome,
} from '../src/modules/ad-platform/services/ad-platform-sync.service';
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

/** The fields of a reported ad that default to absent when a case is silent. */
type OptionalAdFields =
  | 'creativeUrl'
  | 'startsAt'
  | 'endsAt'
  | 'platformState'
  | 'placement';

/** A tree written with only the fields a case cares about. */
interface TestAdTree {
  currency: string;
  ads: Array<
    Omit<ReportedAd, OptionalAdFields> &
      Partial<Pick<ReportedAd, OptionalAdFields>>
  >;
}

/** The store's timezone is UTC in the fixture, so its today is this one. */
const today = (): string => new Date().toISOString().slice(0, 10);

/** One day of figures, already in minor units the way the interface requires. */
function day(
  date: string,
  figures: Partial<ReportedAdDay> = {},
): ReportedAdDay {
  return { day: date, spend: 0, impressions: 0, clicks: 0, ...figures };
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
        // Absent unless a case says otherwise, which is what most platform ads
        // report and what most of these cases are indifferent to.
        platformState: null,
        placement: null,
        ...ad,
      })),
    } satisfies AdTree);
  }

  const syncNow = async (
    client: AdminClient,
    platform: AdPlatform = 'meta',
  ): Promise<SyncOutcome[]> => {
    const res = await client.post(`/ad-platforms/${platform}/sync`).expect(201);
    return res.body as never;
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

  /**
   * A campaign with one ad already claiming a platform ad — the only shape a
   * sync may write spend against.
   *
   * Built through the ordinary admin routes rather than by an insert, so the
   * tag derivation and the per-store uniqueness of a platform id are the real
   * ones.
   */
  async function claimedAd(
    externalId: string,
    client: AdminClient = fixture.admin.client,
    name = 'Summer reel',
  ): Promise<{ campaignId: string; adId: string }> {
    const campaign = (
      await client
        .post('/campaigns', { name: 'Summer Sale 2026', platform: 'meta' })
        .expect(201)
    ).body as { id: string };
    const ad = (
      await client
        .post(`/campaigns/${campaign.id}/ads`, { name, externalId })
        .expect(201)
    ).body as { id: string };
    return { campaignId: campaign.id, adId: ad.id };
  }

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

      // The point of a backfill: day one asks for the history the platform
      // offers rather than for today, so the page is worth reading on the day
      // the merchant connected instead of in a month.
      expect(provider.fetched[0].from < longAgo).toBe(true);
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
      expect(provider.fetched).toHaveLength(1);
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

  // ─── What the platform says about the ad itself ─────────────────────────────

  /**
   * Platform State and Placement: the platform's own view of an ad, landing
   * beside ours and never on top of it.
   *
   * The case the whole feature is for is `it('reads as active here and
   * rejected there')`. It only exists because these are two columns — one the
   * merchant writes and one the sync writes — so every other case here is
   * really about protecting that one.
   */
  describe('the platform’s own view of an ad', () => {
    /** One ad, claimed, with whatever the platform is saying about it today. */
    async function claimedAdReportedAs(
      reported: {
        platformState?: AdPlatformState | null;
        placement?: string | null;
      },
      externalId = 'ad_meta_1',
    ): Promise<{ campaignId: string; adId: string; providerRef: string }> {
      const { providerRef } = await connect(fixture.admin.client);
      const { campaignId, adId } = await claimedAd(externalId);

      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: externalId,
            name: 'Summer reel',
            platformState: reported.platformState ?? null,
            placement: reported.placement ?? null,
            days: [day(today(), { spend: 40_00 })],
          },
        ],
      });

      return { campaignId, adId, providerRef };
    }

    /** The ad as the merchant reads it back off their own card. */
    const readAd = async (
      campaignId: string,
      adId: string,
      client: AdminClient = fixture.admin.client,
    ): Promise<Ad> => {
      const res = await client
        .get(`/campaigns/${campaignId}/ads/${adId}`)
        .expect(200);
      return res.body as Ad;
    };

    it('records what the platform says, against the ad that claims its ad', async () => {
      const { campaignId, adId } = await claimedAdReportedAs({
        platformState: 'delivering',
        placement: 'Instagram Stories',
      });

      const [outcome] = await syncNow(fixture.admin.client);
      const ad = await readAd(campaignId, adId);

      expect(outcome.platformStateWritten).toBe(1);
      expect(ad.platformState).toBe('delivering');
      expect(ad.placement).toBe('Instagram Stories');
      expect(ad.platformReportedAt).toBeTruthy();
    });

    /**
     * The card this stage exists to produce, and the assertion that says the
     * two facts are two facts. An ad rejected at the platform keeps the status
     * the merchant gave it, keeps its place on their active list, and keeps its
     * spend and its history — and says, beside all of that, that the platform
     * has rejected it.
     */
    it('reads as active here and rejected there, both at once', async () => {
      const { campaignId, adId } = await claimedAdReportedAs({
        platformState: 'rejected',
      });

      await syncNow(fixture.admin.client);
      const ad = await readAd(campaignId, adId);

      expect(ad.status).toBe('active');
      expect(ad.platformState).toBe('rejected');
      expect(ad.archivedAt).toBeNull();

      // And still on the merchant's active list — the failure this design
      // exists to prevent is the card quietly leaving.
      const active = (
        await fixture.admin.client
          .get(`/campaigns/${campaignId}/ads`)
          .expect(200)
      ).body as Ad[];
      expect(active.map((row) => row.id)).toContain(adId);
    });

    it.each<AdPlatformState>(['rejected', 'paused', 'in_review'])(
      'never writes the ad’s own status, however %s the platform says it is',
      async (platformState) => {
        const { campaignId, adId } = await claimedAdReportedAs({
          platformState,
        });

        await syncNow(fixture.admin.client);
        const ad = await readAd(campaignId, adId);

        expect(ad.status).toBe('active');
        expect(ad.archivedAt).toBeNull();
      },
    );

    /**
     * The other direction of the same rule. The merchant's decision about their
     * own campaign is theirs; it says nothing about what the platform thinks,
     * and must not erase it.
     */
    it('keeps reporting the platform’s state for an ad the merchant archived', async () => {
      const { campaignId, adId } = await claimedAdReportedAs({
        platformState: 'delivering',
      });
      await syncNow(fixture.admin.client);

      await fixture.admin.client
        .post(`/campaigns/${campaignId}/ads/${adId}/archive`)
        .expect(201);
      await syncNow(fixture.admin.client);

      const ad = await readAd(campaignId, adId);
      expect(ad.status).toBe('archived');
      expect(ad.platformState).toBe('delivering');
    });

    it('leaves an ad that was never synced carrying neither field', async () => {
      const { campaignId } = await claimedAd('ad_meta_never_synced');
      const created = (
        await fixture.admin.client
          .post(`/campaigns/${campaignId}/ads`, { name: 'Hand-made' })
          .expect(201)
      ).body as Ad;

      expect(created.platformState).toBeNull();
      expect(created.placement).toBeNull();
      expect(created.platformReportedAt).toBeNull();
    });

    it('holds no placement for an ad the platform named none for', async () => {
      const { campaignId, adId } = await claimedAdReportedAs({
        platformState: 'approved',
      });

      await syncNow(fixture.admin.client);
      const ad = await readAd(campaignId, adId);

      // Null rather than an empty string, so the card renders no badge at all
      // instead of an empty one. A placement is a recognition label, and an
      // empty label recognises nothing.
      expect(ad.placement).toBeNull();
      expect(ad.platformState).toBe('approved');
    });

    it('writes nothing at all for an ad nothing here claims', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      const { campaignId, adId } = await claimedAd('ad_meta_ours');

      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_someone_elses',
            name: 'Not claimed by anything',
            platformState: 'rejected',
            placement: 'Facebook Feed',
            days: [day(today(), { spend: 10_00 })],
          },
        ],
      });

      const [outcome] = await syncNow(fixture.admin.client);
      const ad = await readAd(campaignId, adId);

      expect(outcome.platformStateWritten).toBe(0);
      expect(ad.platformState).toBeNull();
      expect(ad.placement).toBeNull();
    });

    it('follows the platform when it changes its mind', async () => {
      const { campaignId, adId, providerRef } = await claimedAdReportedAs({
        platformState: 'in_review',
        placement: 'Facebook Feed',
      });
      await syncNow(fixture.admin.client);
      expect((await readAd(campaignId, adId)).platformState).toBe('in_review');

      platformReports(providerRef, {
        currency: 'USD',
        ads: [
          {
            externalAdId: 'ad_meta_1',
            name: 'Summer reel',
            platformState: 'rejected',
            placement: 'Facebook Feed, Instagram Stories',
            days: [day(today(), { spend: 40_00 })],
          },
        ],
      });
      await syncNow(fixture.admin.client);

      const ad = await readAd(campaignId, adId);
      expect(ad.platformState).toBe('rejected');
      expect(ad.placement).toBe('Facebook Feed, Instagram Stories');
      expect(ad.status).toBe('active');
    });

    /**
     * The stated behaviour, asserted so it stays stated: **both fields are
     * preserved**, not cleared, when the platform stops reporting an ad.
     *
     * An ad leaves a tree for reasons that are not facts about the ad — it fell
     * outside the window asked for, a quota refusal truncated the answer, the
     * account was disconnected — so clearing would flicker the card against the
     * sync's luck rather than against anything at the platform. What keeps that
     * honest is `platformReportedAt`, which does not move: a stale "rejected"
     * is readable as stale.
     */
    it('preserves both fields when the platform stops reporting the ad', async () => {
      const { campaignId, adId, providerRef } = await claimedAdReportedAs({
        platformState: 'rejected',
        placement: 'Instagram Stories',
      });
      await syncNow(fixture.admin.client);
      const afterFirst = await readAd(campaignId, adId);

      platformReports(providerRef, { currency: 'USD', ads: [] });
      await syncNow(fixture.admin.client);

      const afterSecond = await readAd(campaignId, adId);
      expect(afterSecond.platformState).toBe('rejected');
      expect(afterSecond.placement).toBe('Instagram Stories');
      // Dated by the run that actually reported it, so the claim ages visibly
      // rather than looking freshly confirmed on every empty sync.
      expect(afterSecond.platformReportedAt).toBe(
        afterFirst.platformReportedAt,
      );
    });

    it('leaves both fields alone through a provider failure', async () => {
      const { campaignId, adId } = await claimedAdReportedAs({
        platformState: 'delivering',
        placement: 'Facebook Feed',
      });
      await syncNow(fixture.admin.client);

      provider.failAlways = new Error('the vendor is down');
      const [outcome] = await syncNow(fixture.admin.client);

      expect(outcome.status).toBe('failed');
      expect(outcome.platformStateWritten).toBe(0);
      const ad = await readAd(campaignId, adId);
      expect(ad.platformState).toBe('delivering');
      expect(ad.placement).toBe('Facebook Feed');
      expect(ad.status).toBe('active');
    });

    /**
     * The one case where clearing is the honest answer: an Ad that claims no
     * platform ad has no platform state, and a preserved "rejected" on it would
     * be a confident sentence about somebody else's ad. Its own status still
     * does not move — the Ad is kept, because it may already have earned
     * revenue through its own tag.
     */
    it('keeps one organization’s platform state off another’s ad', async () => {
      const { campaignId, adId } = await claimedAdReportedAs({
        platformState: 'rejected',
      });
      await syncNow(fixture.admin.client);

      const other = await seedAdmin(app);
      try {
        await other.admin.client
          .get(`/campaigns/${campaignId}/ads/${adId}`)
          .expect(404);
      } finally {
        await destroyAdmin(app, other);
      }
    });
  });

  describe('permissions', () => {
    it('lets a product manager refresh and read the connection', async () => {
      const { providerRef } = await connect(fixture.admin.client);
      platformReports(providerRef, { currency: 'USD', ads: [] });
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
