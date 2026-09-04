import {
  dayInTimezone,
  isCalendarDay,
  spendDayRange,
  storeToday,
} from './spend-day.util';

describe('isCalendarDay', () => {
  it('accepts a well-formed date', () => {
    expect(isCalendarDay('2026-09-04')).toBe(true);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(isCalendarDay('2026-9-4')).toBe(false);
    expect(isCalendarDay('04/09/2026')).toBe(false);
    expect(isCalendarDay('2026-09-04T00:00:00Z')).toBe(false);
    expect(isCalendarDay('')).toBe(false);
  });

  it('rejects a well-formed date that does not exist', () => {
    // The pattern alone would accept these. A Spend row against 30 February is
    // a figure that could never be reconciled against a platform report.
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('2025-02-29')).toBe(false);
  });

  it('accepts a leap day in a leap year', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
  });
});

describe('dayInTimezone', () => {
  it('reads the day where the store is, not where the server is', () => {
    // 22:30 UTC on the 4th is already the 5th in Auckland and still the 4th in
    // New York. The merchant's ad platform reports their day, so that is the
    // day the Spend belongs to.
    const instant = new Date('2026-09-04T22:30:00.000Z');

    expect(dayInTimezone(instant, 'UTC')).toBe('2026-09-04');
    expect(dayInTimezone(instant, 'Pacific/Auckland')).toBe('2026-09-05');
    expect(dayInTimezone(instant, 'America/New_York')).toBe('2026-09-04');
  });

  it('pads months and days so the result is always sortable', () => {
    expect(dayInTimezone(new Date('2026-01-02T12:00:00.000Z'), 'UTC')).toBe(
      '2026-01-02',
    );
  });

  it('falls back to UTC for a timezone Node cannot resolve', () => {
    // `stores.timezone` is free text, so a mistyped value is reachable. A store
    // with one should still be able to record what it spent.
    const instant = new Date('2026-09-04T22:30:00.000Z');
    expect(dayInTimezone(instant, 'Mars/Olympus_Mons')).toBe('2026-09-04');
  });
});

describe('storeToday', () => {
  it('is the day the given instant falls on in the store timezone', () => {
    const now = new Date('2026-09-04T22:30:00.000Z');
    expect(storeToday('Pacific/Auckland', now)).toBe('2026-09-05');
    expect(storeToday('America/Los_Angeles', now)).toBe('2026-09-04');
  });
});

describe('spendDayRange', () => {
  it('converts a period range into inclusive calendar days', () => {
    const start = new Date('2026-08-06T09:15:00.000Z');
    const end = new Date('2026-09-04T09:15:00.000Z');

    expect(spendDayRange(start, end, 'UTC')).toEqual({
      from: '2026-08-06',
      to: '2026-09-04',
    });
  });

  it('includes the day the period ends on — that is the day money is being spent in', () => {
    // The period is `[start, end)` in instants, but a day is not an instant.
    // Excluding the end day would hide today's cost from every report.
    const start = new Date('2026-09-04T00:00:00.000Z');
    const end = new Date('2026-09-04T09:15:00.000Z');

    expect(spendDayRange(start, end, 'UTC')).toEqual({
      from: '2026-09-04',
      to: '2026-09-04',
    });
  });

  it('shifts both ends into the store timezone together', () => {
    const start = new Date('2026-08-06T22:30:00.000Z');
    const end = new Date('2026-09-04T22:30:00.000Z');

    expect(spendDayRange(start, end, 'Pacific/Auckland')).toEqual({
      from: '2026-08-07',
      to: '2026-09-05',
    });
  });
});
