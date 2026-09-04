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

  async function recordRange(
    body: Record<string, unknown>,
    expected = 201,
  ): Promise<CampaignSpend[]> {
    const res = await fixture.admin.client
      .post(spendPath('/range'), body)
      .expect(expected);
    return res.body as CampaignSpend[];
  }

  /** What the rows written actually add up to. The point of a range entry. */
  const sum = (rows: CampaignSpend[]): number =>
    rows.reduce((acc, row) => acc + row.amount, 0);

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

  describe('recording a range of days', () => {
    it('writes one row per day, summing to exactly the total submitted', async () => {
      // A merchant knows the week cost $700; they do not know what Tuesday
      // cost. Seven rows, and the week still reconciles against the invoice.
      const rows = await recordRange({
        startDay: daysAgo(6),
        endDay: daysAgo(0),
        total: 70000,
        currency: 'USD',
      });

      expect(rows).toHaveLength(7);
      expect(sum(rows)).toBe(70000);
      expect(rows.map((r) => r.day)).toEqual([
        daysAgo(6),
        daysAgo(5),
        daysAgo(4),
        daysAgo(3),
        daysAgo(2),
        daysAgo(1),
        daysAgo(0),
      ]);
      expect(rows.every((r) => r.amount === 10000)).toBe(true);

      const stored = await persisted();
      expect(stored).toHaveLength(7);
      expect(sum(stored)).toBe(70000);
    });

    it('puts the remainder on the first day rather than losing it', async () => {
      // $100 over 7 days is $14.28 with 4 cents left. Dropping them would make
      // the week read as $99.96 forever, against an invoice for $100.
      const rows = await recordRange({
        startDay: daysAgo(6),
        endDay: daysAgo(0),
        total: 10000,
        currency: 'USD',
      });

      expect(sum(rows)).toBe(10000);
      expect(rows[0]).toMatchObject({ day: daysAgo(6), amount: 1432 });
      expect(rows.slice(1).map((r) => r.amount)).toEqual([
        1428, 1428, 1428, 1428, 1428, 1428,
      ]);
      expect(sum(await persisted())).toBe(10000);
    });

    it('reads back through the period list as the same total', async () => {
      await recordRange({
        startDay: daysAgo(6),
        endDay: daysAgo(0),
        total: 10000,
        currency: 'USD',
      });

      const report = await list('7d');
      expect(report.rows).toHaveLength(7);
      expect(report.total).toBe(10000);
    });

    it('records a single-day range as one row holding the whole total', async () => {
      const rows = await recordRange({
        startDay: daysAgo(1),
        endDay: daysAgo(1),
        total: 12500,
        currency: 'USD',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ day: daysAgo(1), amount: 12500 });
    });

    it('writes the note against every day of the range', async () => {
      const rows = await recordRange({
        startDay: daysAgo(2),
        endDay: daysAgo(0),
        total: 3000,
        currency: 'USD',
        note: 'Launch week',
      });

      expect(rows.every((r) => r.note === 'Launch week')).toBe(true);
    });

    it("freezes the store's currency onto every row", async () => {
      const rows = await recordRange({
        startDay: daysAgo(2),
        endDay: daysAgo(0),
        total: 3000,
        currency: 'usd',
      });

      expect(rows.every((r) => r.currency === 'USD')).toBe(true);
    });

    it('accepts a range against an archived campaign', async () => {
      await fixture.admin.client
        .post(`/campaigns/${campaign.id}/archive`, {})
        .expect(201);

      const rows = await recordRange({
        startDay: daysAgo(2),
        endDay: daysAgo(0),
        total: 3000,
        currency: 'USD',
      });

      expect(rows).toHaveLength(3);
    });
  });

  describe('a range corrects the days it covers rather than adding to them', () => {
    it('leaves the same rows when the identical range is sent twice', async () => {
      const body = {
        startDay: daysAgo(6),
        endDay: daysAgo(0),
        total: 10000,
        currency: 'USD',
      };

      await recordRange(body);
      await recordRange(body);

      // The failure this guards is silent: an insert would leave fourteen rows
      // and a doubled week, halving the campaign's ROAS with nothing thrown.
      const stored = await persisted();
      expect(stored).toHaveLength(7);
      expect(sum(stored)).toBe(10000);
    });

    it('corrects rather than doubles where a second range overlaps the first', async () => {
      await recordRange({
        startDay: daysAgo(6),
        endDay: daysAgo(0),
        total: 70000,
        currency: 'USD',
      });

      // Three of these four days already have $100 on them.
      await recordRange({
        startDay: daysAgo(2),
        endDay: daysAgo(0),
        total: 6000,
        currency: 'USD',
      });

      const stored = await persisted();
      expect(stored).toHaveLength(7);

      const byDay = new Map(stored.map((r) => [r.day, r.amount]));
      expect(byDay.get(daysAgo(6))).toBe(10000);
      expect(byDay.get(daysAgo(3))).toBe(10000);
      // The overlap took the second range's figures, not the sum of both.
      expect(byDay.get(daysAgo(2))).toBe(2000);
      expect(byDay.get(daysAgo(1))).toBe(2000);
      expect(byDay.get(daysAgo(0))).toBe(2000);
      expect(sum(stored)).toBe(46000);
    });

    it('overwrites a day entered singly', async () => {
      await record({ day: daysAgo(1), amount: 99999, currency: 'USD' });

      await recordRange({
        startDay: daysAgo(2),
        endDay: daysAgo(0),
        total: 3000,
        currency: 'USD',
      });

      const stored = await persisted();
      expect(stored).toHaveLength(3);
      expect(sum(stored)).toBe(3000);
    });

    it('leaves days outside the range untouched', async () => {
      await record({ day: daysAgo(20), amount: 5000, currency: 'USD' });

      await recordRange({
        startDay: daysAgo(2),
        endDay: daysAgo(0),
        total: 3000,
        currency: 'USD',
      });

      const stored = await persisted();
      expect(stored).toHaveLength(4);
      expect(sum(stored)).toBe(8000);
    });
  });

  describe('refusing a range that cannot be true', () => {
    it('rejects a range that ends before it starts', async () => {
      // A swapped pair of fields, not a request for nothing: writing zero rows
      // would report success and leave a week of spend unrecorded.
      await recordRange(
        {
          startDay: daysAgo(0),
          endDay: daysAgo(6),
          total: 70000,
          currency: 'USD',
        },
        400,
      );
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects a negative total', async () => {
      await recordRange(
        {
          startDay: daysAgo(6),
          endDay: daysAgo(0),
          total: -70000,
          currency: 'USD',
        },
        400,
      );
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects a range with either end in the future', async () => {
      await recordRange(
        {
          startDay: daysAgo(0),
          endDay: TOMORROW(),
          total: 1000,
          currency: 'USD',
        },
        400,
      );
      await recordRange(
        {
          startDay: TOMORROW(),
          endDay: daysAgo(-2),
          total: 1000,
          currency: 'USD',
        },
        400,
      );
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects a currency other than the store’s', async () => {
      await recordRange(
        {
          startDay: daysAgo(6),
          endDay: daysAgo(0),
          total: 70000,
          currency: 'EUR',
        },
        400,
      );
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects an end day that is not a real date', async () => {
      await recordRange(
        {
          startDay: daysAgo(6),
          endDay: '2026-02-30',
          total: 70000,
          currency: 'USD',
        },
        400,
      );
      expect(await persisted()).toHaveLength(0);
    });

    it('rejects a range longer than one entry may cover', async () => {
      // Nothing bounds how far back a start date goes, so a mistyped year asks
      // for a row every day since 1900. The merchant is told, not obeyed.
      await recordRange(
        {
          startDay: '1900-01-01',
          endDay: daysAgo(0),
          total: 70000,
          currency: 'USD',
        },
        400,
      );
      expect(await persisted()).toHaveLength(0);
    });

    it('writes nothing at all when the range is refused', async () => {
      // Partial application would be the worst outcome: some days of a total
      // recorded, with no indication which are missing.
      await record({ day: daysAgo(1), amount: 5000, currency: 'USD' });

      await recordRange(
        {
          startDay: daysAgo(0),
          endDay: daysAgo(6),
          total: 70000,
          currency: 'USD',
        },
        400,
      );

      const stored = await persisted();
      expect(stored).toHaveLength(1);
      expect(stored[0].amount).toBe(5000);
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
          .post(spendPath('/range'), {
            startDay: daysAgo(2),
            endDay: daysAgo(0),
            total: 3000,
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
        .post(spendPath('/range'), {
          startDay: daysAgo(2),
          endDay: daysAgo(0),
          total: 3000,
          currency: 'USD',
        })
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
