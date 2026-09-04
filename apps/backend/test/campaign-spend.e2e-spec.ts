/**
 * Recording what a Campaign cost, end to end through the admin REST API.
 *
 * Everything asserted here is something a merchant would notice going wrong
 * with their money: a day recorded twice doubling its cost, a figure surviving
 * a correction, a minus sign turning a losing Campaign profitable, a mistyped
 * year hiding a cost in a period nobody reads, or another tenant's spend
 * appearing against their Campaigns. The whole application runs against a local
 * Postgres database and the rows are read back as persisted.
 *
 * Nothing reads Spend into a report yet — that is ticket 03. What is under test
 * is that the figures recorded are exactly the figures stored.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import { campaignSpend } from '../src/shared/database/schema';
import type { Campaign, CampaignSpend } from '../src/shared/database/schema';
import { createTestApp } from './helpers/test-app';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

interface SpendReport {
  campaignId: string;
  period: string;
  currency: string;
  timezone: string;
  today: string;
  from: string;
  to: string;
  rows: CampaignSpend[];
  total: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A calendar day relative to today in UTC, which is the seeded store's
 * timezone — the same timezone the API reads a spend day in.
 */
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

const TODAY = () => daysAgo(0);
const TOMORROW = () => daysAgo(-1);

describe('Campaign spend (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let fixture: AdminFixture;
  let campaign: Campaign;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    fixture = await seedAdmin(app);
    const res = await fixture.admin.client
      .post('/campaigns', { name: 'Summer Sale 2026', platform: 'meta' })
      .expect(201);
    campaign = res.body as Campaign;
  });

  afterEach(async () => {
    await destroyAdmin(app, fixture);
  });

  const spendPath = (suffix = ''): string =>
    `/campaigns/${campaign.id}/spend${suffix}`;

  async function record(
    body: Record<string, unknown>,
    expected = 201,
  ): Promise<CampaignSpend> {
    const res = await fixture.admin.client
      .post(spendPath(), body)
      .expect(expected);
    return res.body as CampaignSpend;
  }

  async function list(period?: string): Promise<SpendReport> {
    const res = await fixture.admin.client
      .get(spendPath(period ? `?period=${period}` : ''))
      .expect(200);
    return res.body as SpendReport;
  }

  /** The rows actually in the table for this campaign, whatever the API says. */
  async function persisted(): Promise<CampaignSpend[]> {
    return db
      .select()
      .from(campaignSpend)
      .where(eq(campaignSpend.campaignId, campaign.id));
  }

  describe('recording', () => {
    it('records a day of spend and reads it back for the period', async () => {
      const saved = await record({
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
        note: 'Boosted the reel',
      });

      expect(saved).toMatchObject({
        campaignId: campaign.id,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
        note: 'Boosted the reel',
      });

      const report = await list();
      expect(report.rows).toEqual([expect.objectContaining({ id: saved.id })]);
      expect(report.total).toBe(12500);
    });

    it('keeps the amount as an integer in minor units', async () => {
      // $125.00 is 12500, not 125 and not 125.0. Money never becomes a float
      // anywhere in this system, and a spend row is the one figure a merchant
      // types by hand.
      await record({ day: TODAY(), amount: 12500, currency: 'USD' });

      const [row] = await persisted();
      expect(row.amount).toBe(12500);
      expect(Number.isInteger(row.amount)).toBe(true);
    });

    it("freezes the store's currency onto the row", async () => {
      // Read from the store at write time rather than at report time, so a
      // store that changes currency later cannot silently reinterpret spend
      // already recorded as a different unit of money.
      const saved = await record({
        day: TODAY(),
        amount: 5000,
        currency: 'usd',
      });

      expect(saved.currency).toBe('USD');
    });

    it('accepts a day that has already passed', async () => {
      // Setting this up after a campaign has been running must not lose its
      // cost history.
      const saved = await record({
        day: daysAgo(45),
        amount: 9900,
        currency: 'USD',
      });

      expect(saved.day).toBe(daysAgo(45));
    });

    it('accepts spend against an archived campaign', async () => {
      await fixture.admin.client
        .post(`/campaigns/${campaign.id}/archive`)
        .expect(201);

      const saved = await record({
        day: daysAgo(2),
        amount: 4200,
        currency: 'USD',
      });

      expect(saved.amount).toBe(4200);
    });

    it('records a day of zero spend', async () => {
      // Zero is a claim — the campaign ran that day and cost nothing — and is
      // different from having recorded nothing at all.
      const saved = await record({ day: TODAY(), amount: 0, currency: 'USD' });
      expect(saved.amount).toBe(0);
    });
  });

  describe('correcting a day rather than adding to it', () => {
    it('leaves one row holding the last amount when the same request is sent twice', async () => {
      // The failure this prevents is silent: an insert would leave two rows,
      // double the day's cost, and halve the campaign's ROAS forever without
      // anything throwing.
      const body = { day: daysAgo(1), amount: 12500, currency: 'USD' };

      const first = await record(body);
      const second = await record(body);

      expect(second.id).toBe(first.id);
      expect(await persisted()).toHaveLength(1);

      const report = await list();
      expect(report.total).toBe(12500);
    });

    it('replaces the amount when the day is recorded again with a new figure', async () => {
      const day = daysAgo(1);
      await record({ day, amount: 12500, currency: 'USD' });
      const corrected = await record({ day, amount: 9900, currency: 'USD' });

      expect(corrected.amount).toBe(9900);
      expect(await persisted()).toHaveLength(1);
      expect((await list()).total).toBe(9900);
    });

    it('replaces the note along with the amount', async () => {
      const day = daysAgo(1);
      await record({
        day,
        amount: 12500,
        currency: 'USD',
        note: 'First guess',
      });
      const corrected = await record({ day, amount: 12500, currency: 'USD' });

      expect(corrected.note).toBeNull();
    });

    it('keeps different days apart', async () => {
      await record({ day: daysAgo(1), amount: 1000, currency: 'USD' });
      await record({ day: daysAgo(2), amount: 2000, currency: 'USD' });

      const report = await list();
      expect(report.rows).toHaveLength(2);
      expect(report.total).toBe(3000);
      // Oldest first, so the list reads the way a platform report does.
      expect(report.rows.map((r) => r.day)).toEqual([daysAgo(2), daysAgo(1)]);
    });
  });

  describe('updating and removing', () => {
    it('corrects a saved amount', async () => {
      const saved = await record({
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
      });

      const res = await fixture.admin.client
        .patch(spendPath(`/${saved.id}`), { amount: 9900 })
        .expect(200);

      expect((res.body as CampaignSpend).amount).toBe(9900);
      expect((await list()).total).toBe(9900);
    });

    it('clears a note with an empty string', async () => {
      const saved = await record({
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
        note: 'Typo',
      });

      const res = await fixture.admin.client
        .patch(spendPath(`/${saved.id}`), { note: '' })
        .expect(200);

      expect((res.body as CampaignSpend).note).toBeNull();
    });

    it('removes a row entirely rather than zeroing it', async () => {
      const saved = await record({
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
      });

      await fixture.admin.client.delete(spendPath(`/${saved.id}`)).expect(204);

      expect(await persisted()).toHaveLength(0);
      const report = await list();
      expect(report.rows).toEqual([]);
      expect(report.total).toBe(0);
    });

    it('refuses a negative amount on an update as well as on a record', async () => {
      const saved = await record({
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
      });

      await fixture.admin.client
        .patch(spendPath(`/${saved.id}`), { amount: -1 })
        .expect(400);

      expect((await persisted())[0].amount).toBe(12500);
    });

    it('reports an unknown row as not found', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      await fixture.admin.client
        .patch(spendPath(`/${missing}`), { amount: 1 })
        .expect(404);
      await fixture.admin.client.delete(spendPath(`/${missing}`)).expect(404);
    });
  });

  describe('refusing what cannot be true', () => {
    it('rejects a negative amount', async () => {
      // A mistyped minus sign would make a losing campaign look profitable.
      await record({ day: TODAY(), amount: -500, currency: 'USD' }, 400);
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects a day in the future', async () => {
      // A mistyped year sits in the account distorting a period nobody reads.
      await record({ day: TOMORROW(), amount: 500, currency: 'USD' }, 400);
      await record({ day: '2062-01-01', amount: 500, currency: 'USD' }, 400);
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects a currency other than the store’s', async () => {
      // There is no conversion anywhere in this feature, so a figure in another
      // currency cannot be interpreted — only summed as if it were the store's.
      await record({ day: TODAY(), amount: 500, currency: 'EUR' }, 400);
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects a day that is not a real date', async () => {
      await record({ day: '2026-02-30', amount: 500, currency: 'USD' }, 400);
      await record({ day: '04/09/2026', amount: 500, currency: 'USD' }, 400);
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects an amount that is not a whole number of minor units', async () => {
      await record({ day: TODAY(), amount: 12.5, currency: 'USD' }, 400);
      expect(await persisted()).toHaveLength(0);
    });
  });

  describe('the period a list covers', () => {
    it('returns only the days inside it', async () => {
      await record({ day: daysAgo(1), amount: 1000, currency: 'USD' });
      await record({ day: daysAgo(45), amount: 2000, currency: 'USD' });

      const week = await list('7d');
      expect(week.rows.map((r) => r.amount)).toEqual([1000]);
      expect(week.total).toBe(1000);

      const quarter = await list('90d');
      expect(quarter.total).toBe(3000);
    });

    it("names the store's currency and today's date so an entry form can be correct", async () => {
      const report = await list();
      expect(report.currency).toBe('USD');
      expect(report.timezone).toBe('UTC');
      expect(report.today).toBe(TODAY());
      expect(report.to).toBe(TODAY());
    });
  });

  describe('tenancy', () => {
    it('never lets spend cross an organization boundary', async () => {
      const other = await seedAdmin(app);
      try {
        const mine = await record({
          day: daysAgo(1),
          amount: 12500,
          currency: 'USD',
        });

        // The campaign itself is invisible to them, so everything hanging off
        // it is too — a spend id from another tenant reads as "not found",
        // never as someone else's cost data.
        await other.admin.client.get(spendPath()).expect(404);
        await other.admin.client
          .post(spendPath(), {
            day: daysAgo(1),
            amount: 1,
            currency: 'USD',
          })
          .expect(404);
        await other.admin.client
          .patch(spendPath(`/${mine.id}`), { amount: 1 })
          .expect(404);
        await other.admin.client.delete(spendPath(`/${mine.id}`)).expect(404);

        // And nothing they attempted touched the row.
        const rows = await persisted();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          amount: 12500,
          organizationId: fixture.organizationId,
        });
      } finally {
        await destroyAdmin(app, other);
      }
    });

    it('keeps spend out of another store in the same organization', async () => {
      const mine = await record({
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
      });
      const second = await fixture.addStore();

      await second.client.get(spendPath()).expect(404);
      await second.client
        .patch(spendPath(`/${mine.id}`), { amount: 1 })
        .expect(404);

      expect((await persisted())[0].amount).toBe(12500);
    });
  });

  describe('permissions', () => {
    it('lets a support agent neither read nor alter cost data', async () => {
      // Budgets are not a support agent's business, and cost data is what every
      // ratio in the performance report is built on.
      const saved = await record({
        day: daysAgo(1),
        amount: 12500,
        currency: 'USD',
      });
      const support = await fixture.addUser('support_agent');

      await support.client.get(spendPath()).expect(403);
      await support.client
        .post(spendPath(), { day: TODAY(), amount: 1, currency: 'USD' })
        .expect(403);
      await support.client
        .patch(spendPath(`/${saved.id}`), { amount: 1 })
        .expect(403);
      await support.client.delete(spendPath(`/${saved.id}`)).expect(403);

      expect((await persisted())[0].amount).toBe(12500);
    });

    it('lets a product manager record and correct spend', async () => {
      const manager = await fixture.addUser('product_manager');

      const res = await manager.client
        .post(spendPath(), { day: TODAY(), amount: 7500, currency: 'USD' })
        .expect(201);
      const saved = res.body as CampaignSpend;

      await manager.client
        .patch(spendPath(`/${saved.id}`), { amount: 8500 })
        .expect(200);
      await manager.client.delete(spendPath(`/${saved.id}`)).expect(204);
    });
  });
});
