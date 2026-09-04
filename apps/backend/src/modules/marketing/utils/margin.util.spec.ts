/**
 * The margin arithmetic, exercised without a database, a clock or a Store.
 *
 * Two properties are worth more than the rest of this file put together, and
 * both are asserted in terms nobody can quietly reverse: a margin is refused
 * when no cost is known, and a loss is reported as a loss.
 */
import { blendMargin, marginFor, NO_GOODS } from './margin.util';

/** A Campaign that sold $100 of goods, all of it costed at $40, on $10 spend. */
const COSTED = {
  goodsRevenue: 100_00,
  cost: 40_00,
  revenueWithCost: 100_00,
  discount: 0,
  spend: 10_00,
};

describe('marginFor', () => {
  it('takes cost of goods and spend off the goods revenue', () => {
    expect(marginFor(COSTED)).toEqual({
      contributionMargin: 50_00,
      costCoveragePct: 100,
    });
  });

  it('refuses a margin when no cost is known at all', () => {
    // Goods were sold and not one of them has a cost price. Reporting the whole
    // $100 as margin would look like a triumph and be fiction; the blank is
    // what sends the merchant to fill their cost prices in.
    const margin = marginFor({
      goodsRevenue: 100_00,
      cost: 0,
      revenueWithCost: 0,
      discount: 0,
      spend: 10_00,
    });

    expect(margin.contributionMargin).toBeNull();
    expect(margin.contributionMargin).not.toBe(0);
    expect(margin.contributionMargin).not.toBe(90_00);
    expect(margin.costCoveragePct).toBe(0);
  });

  it('reports a margin on partial coverage, and the share it rests on', () => {
    // $100 of goods, $60 of it costed at $25. The margin is real as far as it
    // goes and understates cost; 60% is what says how far it goes. Refusing it
    // would blank the report for every merchant mid-way through entering costs,
    // which is most of them.
    const margin = marginFor({
      goodsRevenue: 100_00,
      cost: 25_00,
      revenueWithCost: 60_00,
      discount: 0,
      spend: 10_00,
    });

    expect(margin).toEqual({ contributionMargin: 65_00, costCoveragePct: 60 });
  });

  it('subtracts a discount exactly once', () => {
    // The goods basis is line totals *before* discount, so the $20 off comes
    // out here and nowhere else. Against the Order total — which already has it
    // netted out — the same subtraction would charge the merchant twice, and
    // the discounted order would report $20 less margin than it earned.
    const discounted = marginFor({ ...COSTED, discount: 20_00 });

    expect(discounted.contributionMargin).toBe(30_00);
    expect(discounted.contributionMargin).toBe(
      marginFor(COSTED).contributionMargin! - 20_00,
    );
  });

  it('returns a loss as a negative number and never clamps it', () => {
    // $100 of goods costing $40, bought with $200 of ads. The whole point of
    // the report is that this reads as −$140 and not as zero.
    const margin = marginFor({ ...COSTED, spend: 200_00 });

    expect(margin.contributionMargin).toBe(-140_00);
    expect(margin.contributionMargin).toBeLessThan(0);
  });

  it('charges a campaign that sold nothing exactly what it spent', () => {
    // Money out, nothing back. No cost prices are *missing* here — there are no
    // goods to have priced — so the margin is a fact, not an estimate, and it
    // is the most actionable figure in an ad account.
    const margin = marginFor({ ...NO_GOODS, spend: 250_00 });

    expect(margin.contributionMargin).toBe(-250_00);
    expect(margin.costCoveragePct).toBe(0);
  });

  it('is zero, not null, for a campaign that neither sold nor spent', () => {
    expect(marginFor({ ...NO_GOODS, spend: 0 })).toEqual({
      contributionMargin: 0,
      costCoveragePct: 0,
    });
  });

  it('keeps every figure an integer in the smallest currency unit', () => {
    // A margin is money and is never rounded; only the coverage percentage is.
    const margin = marginFor({
      goodsRevenue: 33_33,
      cost: 11_11,
      revenueWithCost: 33_33,
      discount: 1_11,
      spend: 7_77,
    });

    expect(margin.contributionMargin).toBe(13_34);
    expect(Number.isInteger(margin.contributionMargin)).toBe(true);
    expect(Number.isInteger(margin.costCoveragePct)).toBe(true);
  });

  it('rounds coverage to a whole percent the way the profit report does', () => {
    // Same convention as the analytics profit report's `coveragePct`, from the
    // same helper — two screens that rounded differently would disagree about
    // what coverage means while both looking right.
    expect(
      marginFor({ ...COSTED, revenueWithCost: 33_33 }).costCoveragePct,
    ).toBe(33);
    expect(
      marginFor({ ...COSTED, revenueWithCost: 66_67 }).costCoveragePct,
    ).toBe(67);
  });
});

describe('blendMargin', () => {
  it('sums every line and takes one margin of the sums', () => {
    const blended = blendMargin([
      COSTED,
      { ...COSTED, goodsRevenue: 50_00, cost: 20_00, revenueWithCost: 50_00 },
    ]);

    expect(blended).toEqual({
      goodsRevenue: 150_00,
      cost: 60_00,
      revenueWithCost: 150_00,
      discount: 0,
      spend: 20_00,
      contributionMargin: 70_00,
      costCoveragePct: 100,
    });
  });

  it('reports blended coverage as the share of all goods revenue, not an average', () => {
    // A $10 campaign fully costed beside a $990 one with nothing costed. The
    // mean of 100% and 0% is 50%; only 1% of the money on this account has a
    // cost behind it, and 1% is what has to be shown.
    const blended = blendMargin([
      {
        goodsRevenue: 10_00,
        cost: 4_00,
        revenueWithCost: 10_00,
        discount: 0,
        spend: 0,
      },
      {
        goodsRevenue: 990_00,
        cost: 0,
        revenueWithCost: 0,
        discount: 0,
        spend: 0,
      },
    ]);

    expect(blended.costCoveragePct).toBe(1);
  });

  it('counts a campaign whose own margin was refused', () => {
    // Its margin is unreportable; its revenue and its spend are not. The
    // account really did take that money in and pay that cost out.
    const blended = blendMargin([
      COSTED,
      {
        goodsRevenue: 40_00,
        cost: 0,
        revenueWithCost: 0,
        discount: 0,
        spend: 5_00,
      },
    ]);

    expect(blended.goodsRevenue).toBe(140_00);
    expect(blended.spend).toBe(15_00);
    expect(blended.contributionMargin).toBe(85_00);
    expect(blended.costCoveragePct).toBe(71);
  });

  it('refuses the blended margin when nothing anywhere has a cost', () => {
    const blended = blendMargin([
      {
        goodsRevenue: 40_00,
        cost: 0,
        revenueWithCost: 0,
        discount: 0,
        spend: 5_00,
      },
      {
        goodsRevenue: 60_00,
        cost: 0,
        revenueWithCost: 0,
        discount: 0,
        spend: 5_00,
      },
    ]);

    expect(blended.contributionMargin).toBeNull();
    expect(blended.costCoveragePct).toBe(0);
  });

  it('is empty rather than throwing when there are no campaigns', () => {
    expect(blendMargin([])).toEqual({
      ...NO_GOODS,
      spend: 0,
      contributionMargin: 0,
      costCoveragePct: 0,
    });
  });

  it('sums across many orders without drift', () => {
    // 10,000 lines of $3.33 goods costing $1.11, each discounted a cent, each
    // costing a cent in ads. Summed as integers the total is exact; a running
    // float would leave the report disagreeing with the sales figures by cents
    // nobody could account for.
    const lines = Array.from({ length: 10_000 }, () => ({
      goodsRevenue: 333,
      cost: 111,
      revenueWithCost: 333,
      discount: 1,
      spend: 1,
    }));

    const blended = blendMargin(lines);

    expect(blended.goodsRevenue).toBe(3_330_000);
    // (333 − 1 − 111 − 1) × 10,000, to the cent.
    expect(blended.contributionMargin).toBe(2_200_000);
    expect(Number.isInteger(blended.contributionMargin)).toBe(true);
    expect(blended.costCoveragePct).toBe(100);
  });
});
