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
import { createAdMatcher, type MatchableAdRule } from './ad-matching.util';
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

const VIDEO_A = 'ad-summer-video-a';
const STILL_B = 'ad-summer-still-b';
/** Spring's own `video-a`: the same tag under a different Campaign. */
const SPRING_VIDEO_A = 'ad-spring-video-a';

const AD_RULES: MatchableAdRule[] = [
  {
    adId: VIDEO_A,
    campaignId: SUMMER,
    field: 'utm_content',
    operator: 'equals',
    value: 'video-a',
    adCreatedAt: new Date('2026-02-01T00:00:00Z'),
  },
  {
    adId: STILL_B,
    campaignId: SUMMER,
    field: 'utm_content',
    operator: 'equals',
    value: 'still-b',
    adCreatedAt: new Date('2026-02-02T00:00:00Z'),
  },
  {
    adId: SPRING_VIDEO_A,
    campaignId: SPRING,
    field: 'utm_content',
    operator: 'equals',
    value: 'video-a',
    adCreatedAt: new Date('2026-02-03T00:00:00Z'),
  },
];

const adMatcher = createAdMatcher(AD_RULES);
const noAds = createAdMatcher([]);

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
  const tally = (orders: CostedOrder[], m = matcher, a = noAds) =>
    tallyAttributedRevenue(orders, m, a, DEFAULT_ATTRIBUTION_LOOKBACK_DAYS);

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

  // ─── The split by ad ────────────────────────────────────────────────────────

  describe('the split by ad', () => {
    /** The same order, arriving through a creative's link. */
    const via = (
      utmContent: string | null,
      overrides: Partial<CostedOrder> = {},
    ) =>
      order({
        ...overrides,
        touch: { ...order().touch, ...overrides.touch, utmContent },
      });

    const split = (orders: CostedOrder[]) => tally(orders, matcher, adMatcher);

    it('credits each ad the orders its tag claimed', () => {
      const result = split([
        via('video-a', { total: 3000 }),
        via('video-a', { total: 1000 }),
        via('still-b', { total: 500 }),
      ]);

      const ads = result.adsByCampaign.get(SUMMER)!;
      expect(ads.byAd.get(VIDEO_A)).toEqual({ orders: 2, revenue: 4000 });
      expect(ads.byAd.get(STILL_B)).toEqual({ orders: 1, revenue: 500 });
    });

    it('keeps an order that matched no ad of the campaign unassigned', () => {
      const result = split([
        via('video-a', { total: 3000 }),
        via('carousel-c', { total: 700 }),
        via(null, { total: 300 }),
      ]);

      const ads = result.adsByCampaign.get(SUMMER)!;
      expect(ads.byAd.get(VIDEO_A)).toEqual({ orders: 1, revenue: 3000 });
      // Its own bucket. Never spread across the ads that do exist, which would
      // make both of them look better than they are.
      expect(ads.unassigned).toEqual({ orders: 2, revenue: 1000 });
      expect(ads.byAd.has(STILL_B)).toBe(false);
    });

    it('never folds unassigned into unattributed', () => {
      // Two different outcomes: one order has a campaign and no ad, the other
      // has no campaign at all.
      const result = split([
        via('carousel-c', { total: 700 }),
        via('video-a', {
          total: 900,
          touch: { ...order().touch, utmCampaign: 'nothing-owns-this' },
        }),
      ]);

      expect(result.adsByCampaign.get(SUMMER)!.unassigned).toEqual({
        orders: 1,
        revenue: 700,
      });
      expect(result.unattributed).toEqual({ orders: 1, revenue: 900 });
      expect(result.adsByCampaign.has(SPRING)).toBe(false);
    });

    it('resolves two campaigns owning the same ad tag independently', () => {
      const result = split([
        via('video-a', { total: 3000 }),
        via('Video_A', {
          total: 900,
          touch: { ...order().touch, utmCampaign: 'Spring-Sale' },
        }),
      ]);

      expect(result.adsByCampaign.get(SUMMER)!.byAd.get(VIDEO_A)).toEqual({
        orders: 1,
        revenue: 3000,
      });
      expect(
        result.adsByCampaign.get(SPRING)!.byAd.get(SPRING_VIDEO_A),
      ).toEqual({ orders: 1, revenue: 900 });
      // Neither campaign's tally has heard of the other's creative.
      expect(result.adsByCampaign.get(SUMMER)!.byAd.has(SPRING_VIDEO_A)).toBe(
        false,
      );
      expect(result.adsByCampaign.get(SPRING)!.byAd.has(VIDEO_A)).toBe(false);
    });

    it('offers an uncredited order to no ad at all', () => {
      // The second pass only ever runs on an order a campaign already claimed.
      const result = split([
        via('video-a', { total: 3000, isBot: true }),
        via('video-a', { total: 500, touch: { ...order().touch, at: null } }),
      ]);

      expect(result.adsByCampaign.size).toBe(0);
      expect(result.unattributed).toEqual({ orders: 2, revenue: 3500 });
    });

    it('leaves a campaign’s own totals unchanged by the split', () => {
      // The figure a merchant already trusted must not move because the report
      // learned to divide it.
      const orders = [
        via('video-a', { total: 3000 }),
        via('still-b', { total: 1000 }),
        via('carousel-c', { total: 700 }),
      ];

      expect(split(orders).byCampaign.get(SUMMER)).toEqual(
        tally(orders).byCampaign.get(SUMMER),
      );
    });

    it('reconciles the ads plus unassigned back to the campaign line', () => {
      const orders = [
        via('video-a', {
          total: 3000,
          goodsRevenue: 2500,
          cost: 1000,
          revenueWithCost: 2500,
          discount: 100,
        }),
        via('still-b', {
          total: 1000,
          goodsRevenue: 900,
          cost: 300,
          revenueWithCost: 900,
          discount: 0,
        }),
        via('carousel-c', {
          total: 700,
          goodsRevenue: 600,
          cost: 0,
          revenueWithCost: 0,
          discount: 50,
        }),
      ];
      const result = split(orders);
      const ads = result.adsByCampaign.get(SUMMER)!;

      const sum = <T>(
        buckets: T[],
        key: { [K in keyof T]: T[K] extends number ? K : never }[keyof T],
      ) =>
        buckets.reduce((total, bucket) => total + (bucket[key] as number), 0);

      const revenueBuckets = [...ads.byAd.values(), ads.unassigned];
      expect(sum(revenueBuckets, 'revenue')).toBe(
        result.byCampaign.get(SUMMER)!.revenue,
      );
      expect(sum(revenueBuckets, 'orders')).toBe(
        result.byCampaign.get(SUMMER)!.orders,
      );

      const goodsBuckets = [...ads.goodsByAd.values(), ads.unassignedGoods];
      const campaignGoods = result.goodsByCampaign.get(SUMMER)!;
      for (const key of [
        'goodsRevenue',
        'cost',
        'revenueWithCost',
        'discount',
      ] as const) {
        expect(sum(goodsBuckets, key)).toBe(campaignGoods[key]);
      }
    });

    it('buckets the goods basis by the same ad as the revenue', () => {
      const result = split([
        via('video-a', {
          goodsRevenue: 2500,
          cost: 1000,
          revenueWithCost: 2500,
        }),
        via('video-a', {
          goodsRevenue: 1000,
          cost: 400,
          revenueWithCost: 1000,
        }),
        via('carousel-c', {
          goodsRevenue: 600,
          cost: 200,
          revenueWithCost: 600,
        }),
      ]);
      const ads = result.adsByCampaign.get(SUMMER)!;

      expect(ads.goodsByAd.get(VIDEO_A)).toEqual({
        goodsRevenue: 3500,
        cost: 1400,
        revenueWithCost: 3500,
        discount: 0,
      });
      // Unassigned carries a goods basis where unattributed does not: money was
      // spent against this campaign, and the split has to reconcile with it.
      expect(ads.unassignedGoods).toEqual({
        goodsRevenue: 600,
        cost: 200,
        revenueWithCost: 600,
        discount: 0,
      });
    });

    it('assigns nothing when the campaign has no ads', () => {
      // A campaign nobody split reports exactly as it did before ads existed.
      const result = tally([via('video-a', { total: 3000 })], matcher, noAds);
      const ads = result.adsByCampaign.get(SUMMER)!;

      expect(ads.byAd.size).toBe(0);
      expect(ads.unassigned).toEqual({ orders: 1, revenue: 3000 });
    });
  });
});
