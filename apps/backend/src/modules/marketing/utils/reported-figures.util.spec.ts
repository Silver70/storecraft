/**
 * The platform's figures as they appear beside ours, without a database or a
 * provider.
 *
 * Three properties here are worth more than the rest of the file, and each is
 * asserted in terms nobody can quietly reverse: money is never summed across
 * two currencies, a foreign-currency figure is marked as one that combines with
 * nothing, and a window nobody stated is reported as unstated rather than
 * guessed.
 */
import {
  reportedFiguresFor,
  type ReportedFigureGroup,
} from './reported-figures.util';

const SYNCED = new Date('2026-09-18T06:00:00.000Z');

/** One group of days, written with only the fields a case is about. */
function group(
  figures: Partial<ReportedFigureGroup> = {},
): ReportedFigureGroup {
  return {
    platform: 'meta',
    currency: 'USD',
    attributionClickDays: 7,
    attributionViewDays: 1,
    spend: 0,
    reportedRevenue: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    days: 1,
    firstDay: '2026-09-01',
    lastDay: '2026-09-01',
    syncedAt: SYNCED,
    ...figures,
  };
}

describe('reportedFiguresFor', () => {
  it('reports the platform, its currency and its window on the figure itself', () => {
    const [figure] = reportedFiguresFor(
      [group({ spend: 100_00, reportedRevenue: 250_00 })],
      'USD',
    );

    // The source travels with the number. A Reported Figure that has to be
    // looked up to be labelled is one a report will eventually render bare,
    // and bare it is indistinguishable from one of ours (ADR-0005).
    expect(figure.platform).toBe('meta');
    expect(figure.currency).toBe('USD');
    expect(figure.attribution).toEqual({ clickDays: 7, viewDays: 1 });
    expect(figure.spend).toBe(100_00);
    expect(figure.revenue).toBe(250_00);
  });

  it('divides the platform’s revenue by the platform’s own spend', () => {
    // Both sides of this ratio are theirs and both are in their currency. Our
    // revenue over their spend is the number this design refuses to produce,
    // and there is no argument to this function that could supply it.
    const [figure] = reportedFiguresFor(
      [group({ spend: 100_00, reportedRevenue: 425_00 })],
      'USD',
    );

    expect(figure.roas).toBe(4.25);
  });

  it('reports no ROAS where the platform reported no spend', () => {
    const [figure] = reportedFiguresFor(
      [group({ spend: 0, reportedRevenue: 80_00 })],
      'USD',
    );

    // The same convention our own figures use: no return *on spend* where
    // nothing was spent, rather than a zero that reads as a failure.
    expect(figure.roas).toBeNull();
    expect(figure.roas).not.toBe(0);
  });

  it('marks a figure in the store’s own currency as one that compares', () => {
    const [figure] = reportedFiguresFor([group({ currency: 'usd' })], 'USD');

    // Case and padding only. There is no equivalence table here and nothing
    // resembling a rate.
    expect(figure.matchesStoreCurrency).toBe(true);
    expect(figure.storeCurrency).toBe('USD');
  });

  it('marks a foreign-currency figure as one that combines with nothing', () => {
    const [figure] = reportedFiguresFor(
      [group({ currency: 'EUR', spend: 100_00, reportedRevenue: 250_00 })],
      'USD',
    );

    // The figures are real and are shown as what they are — in EUR, untouched.
    // What the flag forbids is arithmetic against anything of ours: there is no
    // exchange rate in this feature, and inventing one inside a margin is the
    // failure ADR-0005 exists to prevent.
    expect(figure.matchesStoreCurrency).toBe(false);
    expect(figure.currency).toBe('EUR');
    expect(figure.storeCurrency).toBe('USD');
    expect(figure.spend).toBe(100_00);
    // Theirs over theirs stays available, because it crosses nothing: both
    // figures in it are EUR.
    expect(figure.roas).toBe(2.5);
  });

  it('never sums two currencies into one total', () => {
    // An ad account that changed currency mid-period. There is exactly one
    // wrong answer here — a single total of 300_00 — and it is the one a
    // shape holding a single figure would have forced.
    const figures = reportedFiguresFor(
      [
        group({ currency: 'USD', spend: 200_00 }),
        group({ currency: 'EUR', spend: 100_00 }),
      ],
      'USD',
    );

    expect(figures).toHaveLength(2);
    expect(figures.map((f) => [f.currency, f.spend])).toEqual([
      ['USD', 200_00],
      ['EUR', 100_00],
    ]);
    expect(figures.some((f) => f.spend === 300_00)).toBe(false);
  });

  it('sums the days that do share a currency', () => {
    const [figure] = reportedFiguresFor(
      [
        group({
          spend: 100_00,
          reportedRevenue: 200_00,
          impressions: 1_000,
          clicks: 40,
          conversions: 4,
          days: 3,
          firstDay: '2026-09-01',
          lastDay: '2026-09-03',
          syncedAt: new Date('2026-09-18T01:00:00.000Z'),
        }),
        group({
          spend: 50_00,
          reportedRevenue: 75_00,
          impressions: 500,
          clicks: 10,
          conversions: 1,
          days: 2,
          firstDay: '2026-09-04',
          lastDay: '2026-09-05',
          syncedAt: new Date('2026-09-18T09:00:00.000Z'),
        }),
      ],
      'USD',
    );

    expect(figure.spend).toBe(150_00);
    expect(figure.revenue).toBe(275_00);
    expect(figure.impressions).toBe(1_500);
    expect(figure.clicks).toBe(50);
    expect(figure.conversions).toBe(5);
    expect(figure.days).toBe(5);
    expect(figure.firstDay).toBe('2026-09-01');
    expect(figure.lastDay).toBe('2026-09-05');
    // The freshest confirmation, not the first: this is how stale the figure
    // is, and the oldest of the two would overstate that.
    expect(figure.syncedAt).toBe('2026-09-18T09:00:00.000Z');
  });

  it('reports no window at all where the platform stated none', () => {
    const [figure] = reportedFiguresFor(
      [group({ attributionClickDays: null, attributionViewDays: null })],
      'USD',
    );

    // Not a default and not a zero. A guessed 7 printed next to our own 30-day
    // Lookback Window would read as a number the platform stood behind.
    expect(figure.attribution).toBeNull();
  });

  it('keeps a click-only window as the complete statement it is', () => {
    const [figure] = reportedFiguresFor(
      [group({ attributionClickDays: 7, attributionViewDays: null })],
      'USD',
    );

    expect(figure.attribution).toEqual({ clickDays: 7, viewDays: null });
  });

  it('reports no window where the period spans two of them', () => {
    // The merchant changed their attribution setting mid-period, so these
    // figures were counted two ways. Naming either window would put a precise
    // caveat under a number it is only half true of.
    const [figure] = reportedFiguresFor(
      [
        group({
          attributionClickDays: 7,
          attributionViewDays: 1,
          spend: 10_00,
        }),
        group({
          attributionClickDays: 1,
          attributionViewDays: null,
          spend: 5_00,
        }),
      ],
      'USD',
    );

    expect(figure.attribution).toBeNull();
    // The money still sums: it is one currency, and what changed was how the
    // conversions beside it were counted.
    expect(figure.spend).toBe(15_00);
  });

  it('returns nothing for an ad no platform has reported on', () => {
    // The ordinary state, and the permanent one for every ad on a platform no
    // sync covers. The card is built to read without this.
    expect(reportedFiguresFor([], 'USD')).toEqual([]);
  });

  it('leads with the currency the account actually spends in', () => {
    const figures = reportedFiguresFor(
      [
        group({ currency: 'EUR', spend: 5_00 }),
        group({ currency: 'USD', spend: 400_00 }),
      ],
      'USD',
    );

    expect(figures.map((f) => f.currency)).toEqual(['USD', 'EUR']);
  });

  it('keeps two platforms’ claims apart', () => {
    // Not reachable today, since an Ad claims one platform ad. Asserted anyway:
    // the day it is, folding two platforms' claims into one figure would be a
    // sentence attributed to nobody.
    const figures = reportedFiguresFor(
      [
        group({ platform: 'meta', spend: 100_00 }),
        group({ platform: 'google', spend: 60_00 }),
      ],
      'USD',
    );

    expect(figures.map((f) => [f.platform, f.spend])).toEqual([
      ['meta', 100_00],
      ['google', 60_00],
    ]);
  });
});
