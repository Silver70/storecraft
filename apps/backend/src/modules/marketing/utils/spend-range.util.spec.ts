import {
  countDays,
  enumerateDays,
  splitAcrossDays,
  MAX_SPEND_RANGE_DAYS,
} from './spend-range.util';

describe('countDays', () => {
  it('counts both ends of the range', () => {
    // A range of Monday to Sunday is a week, not six days — both ends are days
    // the merchant spent money on.
    expect(countDays('2026-09-01', '2026-09-07')).toBe(7);
  });

  it('counts a single day as one', () => {
    expect(countDays('2026-09-04', '2026-09-04')).toBe(1);
  });

  it('crosses month and year boundaries', () => {
    expect(countDays('2026-01-30', '2026-02-02')).toBe(4);
    expect(countDays('2025-12-30', '2026-01-02')).toBe(4);
  });

  it('counts the leap day in a leap year', () => {
    expect(countDays('2028-02-27', '2028-03-01')).toBe(4);
    expect(countDays('2026-02-27', '2026-03-01')).toBe(3);
  });

  it('is zero for an inverted range', () => {
    expect(countDays('2026-09-07', '2026-09-01')).toBe(0);
  });
});

describe('enumerateDays', () => {
  it('lists every day in the range, oldest first', () => {
    expect(enumerateDays('2026-09-01', '2026-09-05')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('lists a single-day range as one day', () => {
    expect(enumerateDays('2026-09-04', '2026-09-04')).toEqual(['2026-09-04']);
  });

  it('walks over a month boundary without skipping or repeating', () => {
    expect(enumerateDays('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('walks over a DST transition without dropping or doubling a day', () => {
    // Day arithmetic is done in UTC precisely so that this is boring. In a
    // timezone that springs forward on 8 March, a local-midnight walk would
    // land on the same date twice or skip one, and the rows would stop lining
    // up with the days the merchant chose.
    expect(enumerateDays('2026-03-07', '2026-03-10')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('is empty for an inverted range', () => {
    expect(enumerateDays('2026-09-07', '2026-09-01')).toEqual([]);
  });
});

describe('splitAcrossDays', () => {
  it('divides a total that goes evenly', () => {
    const days = enumerateDays('2026-09-01', '2026-09-04');

    expect(splitAcrossDays(40000, days)).toEqual([
      { day: '2026-09-01', amount: 10000 },
      { day: '2026-09-02', amount: 10000 },
      { day: '2026-09-03', amount: 10000 },
      { day: '2026-09-04', amount: 10000 },
    ]);
  });

  it('puts the remainder on the first day', () => {
    // $100.00 across 7 days is $14.28 a day and 4 cents left over. Dropping
    // them would make the week read as $99.96 against an invoice for $100.
    const days = enumerateDays('2026-09-01', '2026-09-07');
    const rows = splitAcrossDays(10000, days);

    expect(rows[0]).toEqual({ day: '2026-09-01', amount: 1432 });
    expect(rows.slice(1).map((r) => r.amount)).toEqual([
      1428, 1428, 1428, 1428, 1428, 1428,
    ]);
  });

  it('sums to exactly the total for every remainder a range can leave', () => {
    // The invariant this function exists for. Every remainder from 0 to 6 is
    // exercised, because the failure is silent: nothing throws when cents go
    // missing, the report is just quietly wrong forever.
    const days = enumerateDays('2026-09-01', '2026-09-07');

    for (let total = 9994; total <= 10006; total++) {
      const rows = splitAcrossDays(total, days);
      const sum = rows.reduce((acc, row) => acc + row.amount, 0);

      expect(sum).toBe(total);
      expect(rows).toHaveLength(7);
    }
  });

  it('holds the sum across a long range and an awkward total', () => {
    const days = enumerateDays('2026-01-01', '2026-12-31');
    const total = 1234567;
    const rows = splitAcrossDays(total, days);

    expect(rows).toHaveLength(365);
    expect(rows.reduce((acc, row) => acc + row.amount, 0)).toBe(total);
  });

  it('gives every day a whole number of minor units', () => {
    const days = enumerateDays('2026-09-01', '2026-09-03');

    for (const row of splitAcrossDays(1000, days)) {
      expect(Number.isInteger(row.amount)).toBe(true);
    }
  });

  it('puts the whole total on the first day when it is smaller than the range', () => {
    // Three cents across seven days. Six days genuinely cost nothing, and a
    // zero row is the honest record of that — the total still reconciles.
    const days = enumerateDays('2026-09-01', '2026-09-07');
    const rows = splitAcrossDays(3, days);

    expect(rows.map((r) => r.amount)).toEqual([3, 0, 0, 0, 0, 0, 0]);
  });

  it('records a zero total as zero on every day', () => {
    // A campaign that ran and cost nothing is a claim a merchant can make.
    const days = enumerateDays('2026-09-01', '2026-09-03');
    expect(splitAcrossDays(0, days).map((r) => r.amount)).toEqual([0, 0, 0]);
  });

  it('puts the whole total on the only day of a one-day range', () => {
    expect(splitAcrossDays(12500, ['2026-09-04'])).toEqual([
      { day: '2026-09-04', amount: 12500 },
    ]);
  });

  it('is empty for no days', () => {
    expect(splitAcrossDays(10000, [])).toEqual([]);
  });
});

describe('MAX_SPEND_RANGE_DAYS', () => {
  it('admits a full leap year in one entry', () => {
    // The cap is there to catch a mistyped year, not to refuse a real annual
    // closeout — a leap year has to fit.
    expect(countDays('2028-01-01', '2028-12-31')).toBeLessThanOrEqual(
      MAX_SPEND_RANGE_DAYS,
    );
  });
});
