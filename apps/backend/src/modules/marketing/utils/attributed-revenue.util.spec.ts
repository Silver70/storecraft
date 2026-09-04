/**
 * The credit decision and the arithmetic on top of it, as a pure unit.
 *
 * The matching rules themselves are covered next door in
 * `campaign-matching.util.spec.ts`. What is asserted here is everything wrapped
 * around them: the Lookback Window, the bot exclusion, and that money which
 * qualifies for no Campaign lands in its own bucket while still counting toward
 * the totals a merchant will reconcile against their sales report. No database,
 * no framework, no clock.
 */
import {
  campaignCreditFor,
  tallyAttributedRevenue,
  type CostedOrder,
} from './attributed-revenue.util';
import {
  createCampaignMatcher,
  type MatchableRule,
} from './campaign-matching.util';
import { DEFAULT_ATTRIBUTION_LOOKBACK_DAYS } from '../../../shared/attribution/lookback';

const SUMMER = 'campaign-summer';
const SPRING = 'campaign-spring';

const PLACED_AT = new Date('2026-06-01T12:00:00Z');

const daysBefore = (days: number) =>
  new Date(PLACED_AT.getTime() - days * 24 * 60 * 60 * 1000);

const RULES: MatchableRule[] = [
  {
    campaignId: SUMMER,
    field: 'utm_campaign',
    operator: 'equals',
    value: 'summer-sale',
    campaignCreatedAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    campaignId: SPRING,
    field: 'utm_campaign',
    operator: 'equals',
    value: 'spring-sale',
    campaignCreatedAt: new Date('2026-01-02T00:00:00Z'),
  },
];

const matcher = createCampaignMatcher(RULES);
const noRules = createCampaignMatcher([]);

function order(overrides: Partial<CostedOrder> = {}): CostedOrder {
  return {
    total: 3000,
    placedAt: PLACED_AT,
    isBot: false,
    // A $30 order is $25 of goods plus $5 of shipping, all of it costed at
    // $10. The two revenue figures differ by construction here, because a
    // fixture where they agreed would hide every place the wrong one is read.
    goodsRevenue: 2500,
    cost: 1000,
    revenueWithCost: 2500,
    discount: 0,
    touch: {
      utmSource: 'instagram',
      utmMedium: 'paid_social',
      utmCampaign: 'summer_sale',
      referrer: 'https://l.instagram.com/',
      at: daysBefore(1),
    },
    ...overrides,
  };
}

const credit = (o: CostedOrder, m = matcher) =>
  campaignCreditFor(o, m, DEFAULT_ATTRIBUTION_LOOKBACK_DAYS);

describe('campaignCreditFor', () => {
  it('credits the campaign whose rule claims the touch', () => {
    expect(credit(order())).toBe(SUMMER);
  });

  it('credits nothing when no rule claims the touch', () => {
    expect(
      credit(
        order({ touch: { ...order().touch, utmCampaign: 'winter_sale' } }),
      ),
    ).toBe(null);
  });

  it('credits nothing when the order carries no touch at all', () => {
    expect(
      credit(
        order({
          touch: {
            utmSource: null,
            utmMedium: null,
            utmCampaign: null,
            referrer: null,
            at: null,
          },
        }),
      ),
    ).toBe(null);
  });

  it('credits nothing when an empty rule set could match anything', () => {
    expect(credit(order(), noRules)).toBe(null);
  });

  describe('the lookback window', () => {
    it('credits a touch inside the window', () => {
      expect(
        credit(order({ touch: { ...order().touch, at: daysBefore(29) } })),
      ).toBe(SUMMER);
    });

    it('credits a touch exactly at the edge of the window', () => {
      expect(
        credit(
          order({
            touch: { ...order().touch, at: daysBefore(30) },
          }),
        ),
      ).toBe(SUMMER);
    });

    it('credits nothing for a touch older than the window', () => {
      // The visit happened. It just did not drive this sale, and saying so is
      // the difference between an honest report and one that flatters an ad
      // someone stopped running months ago.
      expect(
        credit(order({ touch: { ...order().touch, at: daysBefore(31) } })),
      ).toBe(null);
    });

    it('measures the window against the order, not the clock', () => {
      // An order placed a year ago with a touch the day before it must still
      // report the same campaign today, or every report would decay over time.
      const longAgo = new Date('2025-06-01T12:00:00Z');
      expect(
        credit(
          order({
            placedAt: longAgo,
            touch: {
              ...order().touch,
              at: new Date(longAgo.getTime() - 24 * 60 * 60 * 1000),
            },
          }),
        ),
      ).toBe(SUMMER);
    });

    it('still credits a touch timestamped after its order', () => {
      // Clock skew between a storefront and the server, not a stale visit.
      expect(
        credit(
          order({
            touch: {
              ...order().touch,
              at: new Date(PLACED_AT.getTime() + 60_000),
            },
          }),
        ),
      ).toBe(SUMMER);
    });
  });

  it('credits nothing to a visitor the event log called a bot', () => {
    expect(credit(order({ isBot: true }))).toBe(null);
  });
});

describe('tallyAttributedRevenue', () => {
  const tally = (orders: CostedOrder[], m = matcher) =>
    tallyAttributedRevenue(orders, m, DEFAULT_ATTRIBUTION_LOOKBACK_DAYS);

  it('sums revenue and order count per campaign', () => {
    const result = tally([
      order({ total: 3000 }),
      order({ total: 1250 }),
      order({
        total: 900,
        touch: { ...order().touch, utmCampaign: 'Spring-Sale' },
      }),
    ]);

    expect(result.byCampaign.get(SUMMER)).toEqual({ orders: 2, revenue: 4250 });
    expect(result.byCampaign.get(SPRING)).toEqual({ orders: 1, revenue: 900 });
  });

  it('leaves a campaign that earned nothing out of the map entirely', () => {
    const result = tally([order()]);
    expect(result.byCampaign.has(SPRING)).toBe(false);
  });

  it('keeps unattributed revenue in its own bucket', () => {
    const result = tally([
      order({ total: 3000 }),
      order({ total: 2000, isBot: true }),
      order({ total: 500, touch: { ...order().touch, at: daysBefore(90) } }),
    ]);

    expect(result.byCampaign.get(SUMMER)).toEqual({ orders: 1, revenue: 3000 });
    expect(result.unattributed).toEqual({ orders: 2, revenue: 2500 });
  });

  it('never spreads unattributed revenue across campaigns', () => {
    const result = tally(
      [order({ total: 3000 }), order({ total: 7000 })],
      noRules,
    );

    expect(result.byCampaign.size).toBe(0);
    expect(result.unattributed).toEqual({ orders: 2, revenue: 10000 });
  });

  it('counts every order in the totals, credited or not', () => {
    // This is what reconciles the report with the sales figures for the same
    // period: disqualifying a touch withholds a campaign, never the revenue.
    const orders = [
      order({ total: 3000 }),
      order({ total: 2000, isBot: true }),
      order({ total: 500, touch: { ...order().touch, at: null } }),
    ];
    const result = tally(orders);

    const attributed = [...result.byCampaign.values()].reduce(
      (sum, bucket) => sum + bucket.revenue,
      0,
    );

    expect(result.totals).toEqual({ orders: 3, revenue: 5500 });
    expect(attributed + result.unattributed.revenue).toBe(
      result.totals.revenue,
    );
  });

  it('returns empty buckets for a period with no orders', () => {
    const result = tally([]);

    expect(result.byCampaign.size).toBe(0);
    expect(result.goodsByCampaign.size).toBe(0);
    expect(result.unattributed).toEqual({ orders: 0, revenue: 0 });
    expect(result.totals).toEqual({ orders: 0, revenue: 0 });
  });

  // ─── The goods basis ────────────────────────────────────────────────────────

  describe('the goods basis', () => {
    it('buckets the goods figures by the same campaign as the revenue', () => {
      const result = tally([
        order({ goodsRevenue: 2500, cost: 1000, revenueWithCost: 2500 }),
        order({ goodsRevenue: 1000, cost: 400, revenueWithCost: 1000 }),
        order({
          goodsRevenue: 900,
          cost: 300,
          revenueWithCost: 900,
          touch: { ...order().touch, utmCampaign: 'Spring-Sale' },
        }),
      ]);

      expect(result.goodsByCampaign.get(SUMMER)).toEqual({
        goodsRevenue: 3500,
        cost: 1400,
        revenueWithCost: 3500,
        discount: 0,
      });
      expect(result.goodsByCampaign.get(SPRING)).toEqual({
        goodsRevenue: 900,
        cost: 300,
        revenueWithCost: 900,
        discount: 0,
      });
    });

    it('keeps the goods basis apart from the order-total basis', () => {
      // $30 orders holding $25 of goods. Reading either figure where the other
      // belongs is the mistake this separation exists to prevent, so the two
      // are asserted as different numbers rather than assumed to agree.
      const result = tally([order(), order()]);

      expect(result.byCampaign.get(SUMMER)!.revenue).toBe(6000);
      expect(result.goodsByCampaign.get(SUMMER)!.goodsRevenue).toBe(5000);
    });

    it('sums the discount once per order, on the goods side only', () => {
      const result = tally([
        order({ discount: 500 }),
        order({ discount: 250 }),
      ]);

      expect(result.goodsByCampaign.get(SUMMER)!.discount).toBe(750);
      // The order total already has the discount netted out at checkout, so
      // nothing subtracts it from the revenue bucket as well.
      expect(result.byCampaign.get(SUMMER)!.revenue).toBe(6000);
    });

    it('carries uncosted goods as revenue with no cost behind it', () => {
      // The variant has no cost price. The sale is real and the cost is
      // unknown, which is a different thing from a cost of zero.
      const result = tally([
        order({ goodsRevenue: 2500, cost: 0, revenueWithCost: 0 }),
      ]);

      expect(result.goodsByCampaign.get(SUMMER)).toEqual({
        goodsRevenue: 2500,
        cost: 0,
        revenueWithCost: 0,
        discount: 0,
      });
    });

    it('gives an uncredited order no goods bucket at all', () => {
      // Unattributed carries no cost data: nobody spent against it, so there
      // is no margin to build and a cost figure there would only invite one.
      const result = tally([order({ isBot: true })]);

      expect(result.goodsByCampaign.size).toBe(0);
      expect(result.unattributed).toEqual({ orders: 1, revenue: 3000 });
    });
  });
});
