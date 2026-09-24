import {
  campaignRatios,
  contributionMargin,
  conversionRate,
  roas,
  roi,
  type CampaignFigures,
} from './campaign-performance.util';

const figures = (over: Partial<CampaignFigures> = {}): CampaignFigures => ({
  tracked: true,
  revenue: 300_00,
  orders: 6,
  spend: 100_00,
  clicks: 120,
  goods: { cost: 90_00, uncostedItems: 0 },
  ...over,
});

describe('roas', () => {
  it('is revenue over spend', () => {
    expect(roas(300_00, 100_00)).toBe(3);
  });

  it('is absent, not infinite, when nothing was spent', () => {
    expect(roas(300_00, 0)).toBeNull();
  });

  it('is absent, not zero or NaN, when nothing was spent or earned', () => {
    expect(roas(0, 0)).toBeNull();
  });

  it('is zero when money was spent and none came back', () => {
    expect(roas(0, 100_00)).toBe(0);
  });
});

describe('conversionRate', () => {
  it('is orders over clicks', () => {
    expect(conversionRate(6, 120)).toBe(0.05);
  });

  it('is absent when nobody clicked', () => {
    expect(conversionRate(2, 0)).toBeNull();
  });
});

describe('contributionMargin', () => {
  it('is revenue less the goods and the spend', () => {
    expect(
      contributionMargin(300_00, { cost: 90_00, uncostedItems: 0 }, 100_00),
    ).toBe(110_00);
  });

  it('is withheld when even one item sold has no cost price', () => {
    expect(
      contributionMargin(300_00, { cost: 90_00, uncostedItems: 1 }, 100_00),
    ).toBeNull();
  });

  it('is the spend lost when nothing sold', () => {
    expect(contributionMargin(0, { cost: 0, uncostedItems: 0 }, 100_00)).toBe(
      -100_00,
    );
  });

  it('can be negative', () => {
    expect(
      contributionMargin(100_00, { cost: 60_00, uncostedItems: 0 }, 80_00),
    ).toBe(-40_00);
  });
});

describe('roi', () => {
  it('is the margin over the spend', () => {
    expect(roi(110_00, 100_00)).toBe(1.1);
  });

  it('is absent whenever the margin is', () => {
    expect(roi(null, 100_00)).toBeNull();
  });

  it('is absent when nothing was spent', () => {
    expect(roi(0, 0)).toBeNull();
  });
});

describe('campaignRatios', () => {
  it('computes every ratio for a fully costed, tracked Campaign', () => {
    expect(campaignRatios(figures())).toEqual({
      roas: 3,
      conversionRate: 0.05,
      contributionMargin: 110_00,
      roi: 1.1,
    });
  });

  it('withholds margin and ROI, and only those, when costs are missing', () => {
    expect(
      campaignRatios(figures({ goods: { cost: 90_00, uncostedItems: 2 } })),
    ).toEqual({
      roas: 3,
      conversionRate: 0.05,
      contributionMargin: null,
      roi: null,
    });
  });

  it('shows nothing built on revenue for a Not Tracked Campaign', () => {
    // Its tally says zero because no Order could name it, not because it
    // earned nothing: a ROAS of 0 here would invent a failure.
    expect(
      campaignRatios(
        figures({
          tracked: false,
          revenue: 0,
          orders: 0,
          goods: { cost: 0, uncostedItems: 0 },
        }),
      ),
    ).toEqual({
      roas: null,
      conversionRate: null,
      contributionMargin: null,
      roi: null,
    });
  });
});
