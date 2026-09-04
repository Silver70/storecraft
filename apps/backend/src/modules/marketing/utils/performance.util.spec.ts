import { blendPerformance, roasFor } from './performance.util';

describe('roasFor', () => {
  it('divides revenue by spend', () => {
    // $40 back on $10 spent.
    expect(roasFor(4000, 1000)).toBe(4);
  });

  it('is null when nothing was spent, not zero and not infinity', () => {
    // The decision this whole file exists to protect. An organic campaign has
    // no return *on spend*; a zero would rank it as a failure and an infinity
    // as the best thing in the account.
    expect(roasFor(500_00, 0)).toBeNull();
    expect(roasFor(0, 0)).toBeNull();
    expect(roasFor(500_00, 0)).not.toBe(0);
    expect(roasFor(500_00, 0)).not.toBe(Infinity);
  });

  it('is zero when money went out and nothing came back', () => {
    // The row the report could not previously represent: a real zero, not an
    // absence.
    expect(roasFor(0, 250_00)).toBe(0);
  });

  it('rounds to two decimal places', () => {
    // 1000/3 = 3.333…; a ratio is read against a target, not reconciled
    // against an invoice.
    expect(roasFor(1000, 300)).toBe(3.33);
    expect(roasFor(2000, 300)).toBe(6.67);
  });

  it('reports a campaign that lost money as a ratio below one', () => {
    // $60 spent, $40 back. Nothing clamps it at 1 and nothing hides it.
    expect(roasFor(4000, 6000)).toBe(0.67);
  });

  it('is a ratio, not a money value', () => {
    // 4.25 means $4.25 back per dollar spent. If this ever came back as 425
    // somebody has "corrected" it into minor units.
    const roas = roasFor(4250, 1000);
    expect(roas).toBe(4.25);
    expect(Number.isInteger(roas)).toBe(false);
  });
});

describe('blendPerformance', () => {
  it('sums every line and divides the sums', () => {
    const blended = blendPerformance([
      { revenue: 10_000, spend: 2_500 },
      { revenue: 5_000, spend: 2_500 },
    ]);

    expect(blended).toEqual({ revenue: 15_000, spend: 5_000, roas: 3 });
  });

  it('divides the sums rather than averaging the ratios', () => {
    // A $5 campaign with one lucky sale (ROAS 20) beside a $5,000 campaign
    // returning half its cost (ROAS 0.5). The mean of the two ratios is 10.25,
    // which is not what a merchant means by "what did my spend return".
    const blended = blendPerformance([
      { revenue: 10_000, spend: 500 },
      { revenue: 250_000, spend: 500_000 },
    ]);

    expect(blended.roas).toBe(0.52);
  });

  it('is null overall when no campaign spent anything', () => {
    const blended = blendPerformance([
      { revenue: 10_000, spend: 0 },
      { revenue: 5_000, spend: 0 },
    ]);

    expect(blended).toEqual({ revenue: 15_000, spend: 0, roas: null });
  });

  it('counts a campaign that spent and earned nothing', () => {
    // It contributes cost and no revenue, which is the point of showing it.
    const blended = blendPerformance([
      { revenue: 10_000, spend: 2_000 },
      { revenue: 0, spend: 8_000 },
    ]);

    expect(blended).toEqual({ revenue: 10_000, spend: 10_000, roas: 1 });
  });

  it('is empty rather than throwing when there are no campaigns', () => {
    expect(blendPerformance([])).toEqual({ revenue: 0, spend: 0, roas: null });
  });

  it('sums integer revenue across many orders without drift', () => {
    // 10,000 orders of $3.33, one campaign per order. Summed as integers the
    // total is exact; a running float total in dollars would not be, and the
    // report would disagree with the sales figures by cents that nobody could
    // account for.
    const lines = Array.from({ length: 10_000 }, () => ({
      revenue: 333,
      spend: 1,
    }));

    const blended = blendPerformance(lines);

    expect(blended.revenue).toBe(3_330_000);
    expect(blended.spend).toBe(10_000);
    expect(Number.isInteger(blended.revenue)).toBe(true);
    expect(blended.roas).toBe(333);
  });
});
