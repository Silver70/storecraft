/**
 * The credit rule and the tally on top of it, as a pure unit.
 *
 * `creditFor` is the one place the latest-ad-click rule is written, so it is
 * asserted here directly: which Touch wins, when the other one is consulted,
 * that an Ad can only be credited under the Campaign its own Touch named, and
 * that money qualifying for no Campaign lands in its own bucket while still
 * counting toward the totals a merchant reconciles against their sales report.
 * No database, no framework, no clock.
 */
import {
  creditFor,
  tallyAttributedRevenue,
  type AttributableOrder,
  type CreditIndex,
  type OrderTouch,
} from './attributed-revenue.util';
import { DEFAULT_ATTRIBUTION_LOOKBACK_DAYS } from '../../../shared/attribution/lookback';

// Platform ids, as Meta writes them into the link at click time.
const SUMMER_EXT = '120200000000000001';
const SPRING_EXT = '120200000000000002';
const SUMMER_VIDEO_EXT = '120210000000000001';
const SUMMER_STILL_EXT = '120210000000000002';
const SPRING_VIDEO_EXT = '120210000000000003';

// Our own row ids.
const SUMMER = 'campaign-summer';
const SPRING = 'campaign-spring';
const SUMMER_VIDEO = 'ad-summer-video';
const SUMMER_STILL = 'ad-summer-still';
const SPRING_VIDEO = 'ad-spring-video';

const INDEX: CreditIndex = {
  campaigns: new Map([
    [SUMMER_EXT, SUMMER],
    [SPRING_EXT, SPRING],
  ]),
  ads: new Map([
    [SUMMER_VIDEO_EXT, { adId: SUMMER_VIDEO, campaignId: SUMMER }],
    [SUMMER_STILL_EXT, { adId: SUMMER_STILL, campaignId: SUMMER }],
    [SPRING_VIDEO_EXT, { adId: SPRING_VIDEO, campaignId: SPRING }],
  ]),
};

const EMPTY_INDEX: CreditIndex = { campaigns: new Map(), ads: new Map() };

const LOOKBACK = DEFAULT_ATTRIBUTION_LOOKBACK_DAYS;
const PLACED_AT = new Date('2026-06-01T12:00:00Z');

const daysBefore = (days: number) =>
  new Date(PLACED_AT.getTime() - days * 24 * 60 * 60 * 1000);

const NO_TOUCH: OrderTouch = { utmCampaign: null, utmContent: null, at: null };

function touch(
  utmCampaign: string | null,
  utmContent: string | null = null,
  at: Date = daysBefore(1),
): OrderTouch {
  return { utmCampaign, utmContent, at };
}

function order(
  touches: { first?: OrderTouch; last?: OrderTouch },
  overrides: Partial<AttributableOrder> = {},
): AttributableOrder {
  return {
    total: 3000,
    placedAt: PLACED_AT,
    firstTouch: touches.first ?? NO_TOUCH,
    lastTouch: touches.last ?? NO_TOUCH,
    isBot: false,
    ...overrides,
  };
}

describe('creditFor — the latest ad click', () => {
  it('credits the Campaign and the Ad the last touch names', () => {
    expect(
      creditFor(
        order({ last: touch(SUMMER_EXT, SUMMER_VIDEO_EXT) }),
        INDEX,
        LOOKBACK,
      ),
    ).toEqual({ campaignId: SUMMER, adId: SUMMER_VIDEO });
  });

  it('prefers the last touch when both touches name different Campaigns', () => {
    const credit = creditFor(
      order({
        first: touch(SPRING_EXT, SPRING_VIDEO_EXT, daysBefore(10)),
        last: touch(SUMMER_EXT, SUMMER_STILL_EXT, daysBefore(1)),
      }),
      INDEX,
      LOOKBACK,
    );
    expect(credit).toEqual({ campaignId: SUMMER, adId: SUMMER_STILL });
  });

  it('falls back to the first touch when the last touch names no Campaign', () => {
    // An ad click, then a search for the store's name: the search must not
    // cancel the ad's credit.
    const credit = creditFor(
      order({
        first: touch(SPRING_EXT, SPRING_VIDEO_EXT, daysBefore(5)),
        last: touch(null, null, daysBefore(1)),
      }),
      INDEX,
      LOOKBACK,
    );
    expect(credit).toEqual({ campaignId: SPRING, adId: SPRING_VIDEO });
  });

  it('falls back to the first touch when the last touch names a value no Campaign has', () => {
    // A newsletter link tagged by hand is a Touch, but not a Campaign.
    const credit = creditFor(
      order({
        first: touch(SPRING_EXT, null, daysBefore(5)),
        last: touch('newsletter', 'footer-link', daysBefore(1)),
      }),
      INDEX,
      LOOKBACK,
    );
    expect(credit).toEqual({ campaignId: SPRING, adId: null });
  });

  it('falls back to the first touch when the order carries no last touch at all', () => {
    expect(
      creditFor(order({ first: touch(SUMMER_EXT) }), INDEX, LOOKBACK),
    ).toEqual({ campaignId: SUMMER, adId: null });
  });

  it('is Unattributed when neither touch names a Campaign', () => {
    expect(
      creditFor(
        order({ first: touch('newsletter'), last: touch(null) }),
        INDEX,
        LOOKBACK,
      ),
    ).toBeNull();
    expect(creditFor(order({}), INDEX, LOOKBACK)).toBeNull();
  });

  it('matches only exact platform ids — no normalization', () => {
    // A leading space or a different id is simply not that campaign.
    expect(
      creditFor(order({ last: touch(` ${SUMMER_EXT}`) }), INDEX, LOOKBACK),
    ).toBeNull();
  });

  it('matches nothing against another store’s index', () => {
    expect(
      creditFor(order({ last: touch(SUMMER_EXT) }), EMPTY_INDEX, LOOKBACK),
    ).toBeNull();
  });

  describe('the Ad', () => {
    it('is Unassigned when the touch names the Campaign but none of its Ads', () => {
      expect(
        creditFor(
          order({ last: touch(SUMMER_EXT, '999999') }),
          INDEX,
          LOOKBACK,
        ),
      ).toEqual({ campaignId: SUMMER, adId: null });
    });

    it('is Unassigned when the touch carries no utm_content', () => {
      expect(
        creditFor(order({ last: touch(SUMMER_EXT, null) }), INDEX, LOOKBACK),
      ).toEqual({ campaignId: SUMMER, adId: null });
    });

    it('never credits an Ad running under a different Campaign', () => {
      // A hand-edited link naming Summer's campaign and Spring's ad.
      expect(
        creditFor(
          order({ last: touch(SUMMER_EXT, SPRING_VIDEO_EXT) }),
          INDEX,
          LOOKBACK,
        ),
      ).toEqual({ campaignId: SUMMER, adId: null });
    });

    it('is read from the same touch that named the Campaign', () => {
      // The last touch names no campaign but carries an ad id of Summer's; the
      // first touch names Spring. Credit is Spring's, and the ad is the first
      // touch's — never a mix of the two touches.
      expect(
        creditFor(
          order({
            first: touch(SPRING_EXT, SPRING_VIDEO_EXT, daysBefore(4)),
            last: touch(null, SUMMER_VIDEO_EXT, daysBefore(1)),
          }),
          INDEX,
          LOOKBACK,
        ),
      ).toEqual({ campaignId: SPRING, adId: SPRING_VIDEO });
    });
  });

  describe('the Lookback Window', () => {
    it('credits a touch exactly at the window edge', () => {
      expect(
        creditFor(
          order({ last: touch(SUMMER_EXT, null, daysBefore(LOOKBACK)) }),
          INDEX,
          LOOKBACK,
        ),
      ).toEqual({ campaignId: SUMMER, adId: null });
    });

    it('denies a last touch older than the window, and falls back to nothing older still', () => {
      expect(
        creditFor(
          order({
            first: touch(SPRING_EXT, null, daysBefore(LOOKBACK + 20)),
            last: touch(SUMMER_EXT, null, daysBefore(LOOKBACK + 1)),
          }),
          INDEX,
          LOOKBACK,
        ),
      ).toBeNull();
    });

    it('treats a touch dated after the order as clock skew, not as stale', () => {
      const later = new Date(PLACED_AT.getTime() + 60 * 1000);
      expect(
        creditFor(
          order({ last: touch(SUMMER_EXT, null, later) }),
          INDEX,
          LOOKBACK,
        ),
      ).toEqual({ campaignId: SUMMER, adId: null });
    });

    it('ignores a touch with no timestamp', () => {
      expect(
        creditFor(
          order({
            last: { utmCampaign: SUMMER_EXT, utmContent: null, at: null },
          }),
          INDEX,
          LOOKBACK,
        ),
      ).toBeNull();
    });
  });

  it('never credits a bot', () => {
    expect(
      creditFor(
        order({ last: touch(SUMMER_EXT, SUMMER_VIDEO_EXT) }, { isBot: true }),
        INDEX,
        LOOKBACK,
      ),
    ).toBeNull();
  });
});

describe('tallyAttributedRevenue', () => {
  it('sums Campaigns, their Ads and the Unassigned residue from one pass', () => {
    const tally = tallyAttributedRevenue(
      [
        order({ last: touch(SUMMER_EXT, SUMMER_VIDEO_EXT) }, { total: 1000 }),
        order({ last: touch(SUMMER_EXT, SUMMER_VIDEO_EXT) }, { total: 2000 }),
        order({ last: touch(SUMMER_EXT, SUMMER_STILL_EXT) }, { total: 500 }),
        order({ last: touch(SUMMER_EXT, 'hand-edited') }, { total: 700 }),
        order({ first: touch(SPRING_EXT) }, { total: 300 }),
        order({}, { total: 4000 }),
      ],
      INDEX,
      LOOKBACK,
    );

    expect(tally.byCampaign.get(SUMMER)).toEqual({ orders: 4, revenue: 4200 });
    expect(tally.byCampaign.get(SPRING)).toEqual({ orders: 1, revenue: 300 });

    const summerAds = tally.adsByCampaign.get(SUMMER)!;
    expect(summerAds.byAd.get(SUMMER_VIDEO)).toEqual({
      orders: 2,
      revenue: 3000,
    });
    expect(summerAds.byAd.get(SUMMER_STILL)).toEqual({
      orders: 1,
      revenue: 500,
    });
    expect(summerAds.unassigned).toEqual({ orders: 1, revenue: 700 });

    expect(tally.unattributed).toEqual({ orders: 1, revenue: 4000 });
    expect(tally.totals).toEqual({ orders: 6, revenue: 8500 });
  });

  it('adds every Ad and the Unassigned line back up to the Campaign exactly', () => {
    const tally = tallyAttributedRevenue(
      [
        order({ last: touch(SUMMER_EXT, SUMMER_VIDEO_EXT) }, { total: 1234 }),
        order({ last: touch(SUMMER_EXT, SUMMER_STILL_EXT) }, { total: 999 }),
        order({ last: touch(SUMMER_EXT, SPRING_VIDEO_EXT) }, { total: 1 }),
        order(
          {
            first: touch(SUMMER_EXT, SUMMER_STILL_EXT, daysBefore(3)),
            last: touch(null),
          },
          { total: 77 },
        ),
      ],
      INDEX,
      LOOKBACK,
    );

    const campaign = tally.byCampaign.get(SUMMER)!;
    const ads = tally.adsByCampaign.get(SUMMER)!;
    const adSum = [...ads.byAd.values()].reduce(
      (sum, b) => ({
        orders: sum.orders + b.orders,
        revenue: sum.revenue + b.revenue,
      }),
      ads.unassigned,
    );
    expect(adSum).toEqual(campaign);
  });

  it('counts an unattributed order in the totals and nowhere else', () => {
    const tally = tallyAttributedRevenue(
      [order({ last: touch('newsletter') }, { total: 2500 })],
      INDEX,
      LOOKBACK,
    );
    expect(tally.byCampaign.size).toBe(0);
    expect(tally.adsByCampaign.size).toBe(0);
    expect(tally.unattributed).toEqual({ orders: 1, revenue: 2500 });
    expect(tally.totals).toEqual({ orders: 1, revenue: 2500 });
  });
});
