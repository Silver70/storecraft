import {
  DraftRuleError,
  MAX_ADS,
  adName,
  checkAdCount,
  checkAgeRange,
  normalizeCountries,
  resolveEndDate,
  resolveSchedule,
  zonedMidnight,
} from './campaign-draft.util';

function complaintsOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof DraftRuleError) return error.complaints;
    throw error;
  }
  throw new Error('expected a DraftRuleError');
}

describe('zonedMidnight', () => {
  it('is midnight UTC in UTC', () => {
    expect(zonedMidnight('2026-10-01', 'UTC').toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('is the Store’s midnight, not the server’s', () => {
    // New York is four hours behind UTC in October.
    expect(zonedMidnight('2026-10-01', 'America/New_York').toISOString()).toBe(
      '2026-10-01T04:00:00.000Z',
    );
    // Auckland is thirteen hours ahead in October (daylight time).
    expect(zonedMidnight('2026-10-01', 'Pacific/Auckland').toISOString()).toBe(
      '2026-09-30T11:00:00.000Z',
    );
  });

  it('uses the offset of the day itself across a daylight saving change', () => {
    // US clocks go back on 1 November 2026; that day starts in daylight time.
    expect(zonedMidnight('2026-11-01', 'America/New_York').toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
    expect(zonedMidnight('2026-11-02', 'America/New_York').toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    );
  });

  it('reads a timezone Node cannot resolve as UTC', () => {
    expect(zonedMidnight('2026-10-01', 'Not/AZone').toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });
});

describe('resolveSchedule', () => {
  // 20:00 on the 24th in New York, already the 25th in UTC.
  const now = new Date('2026-09-25T00:00:00Z');
  const timezone = 'America/New_York';

  it('starts now when the start day is today in the Store’s timezone', () => {
    expect(
      resolveSchedule({ startDay: '2026-09-24', endDay: null, timezone, now }),
    ).toEqual({ startsAt: null, endsAt: null });
  });

  it('starts at the Store’s midnight on a later day', () => {
    const { startsAt } = resolveSchedule({
      startDay: '2026-09-26',
      endDay: null,
      timezone,
      now,
    });
    expect(startsAt?.toISOString()).toBe('2026-09-26T04:00:00.000Z');
  });

  it('ends at the end of the end day, so the end day is spent in full', () => {
    const { endsAt } = resolveSchedule({
      startDay: '2026-09-24',
      endDay: '2026-09-30',
      timezone,
      now,
    });
    expect(endsAt?.toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });

  it('allows a campaign that starts and ends on the same day', () => {
    const { endsAt } = resolveSchedule({
      startDay: '2026-09-24',
      endDay: '2026-09-24',
      timezone,
      now,
    });
    expect(endsAt?.toISOString()).toBe('2026-09-25T04:00:00.000Z');
  });

  it('refuses a start day that has passed in the Store’s timezone', () => {
    expect(
      complaintsOf(() =>
        resolveSchedule({
          startDay: '2026-09-23',
          endDay: null,
          timezone,
          now,
        }),
      ),
    ).toEqual([expect.objectContaining({ field: 'schedule', adIndex: null })]);
  });

  it('refuses an end before the start, and dates that are not dates', () => {
    expect(
      complaintsOf(() =>
        resolveSchedule({
          startDay: '2026-09-28',
          endDay: '2026-09-27',
          timezone,
          now,
        }),
      )[0].message,
    ).toMatch(/before the start/);
    expect(
      complaintsOf(() =>
        resolveSchedule({
          startDay: '2026-02-30',
          endDay: null,
          timezone,
          now,
        }),
      )[0].field,
    ).toBe('schedule');
  });
});

describe('resolveEndDate', () => {
  // 20:00 on the 24th in New York, already the 25th in UTC.
  const now = new Date('2026-09-25T00:00:00Z');
  const timezone = 'America/New_York';

  it('stops at the midnight after the end day, in the Store’s timezone', () => {
    expect(
      resolveEndDate({
        endDay: '2026-10-31',
        startsAt: null,
        timezone,
        now,
      }).toISOString(),
    ).toBe('2026-11-01T04:00:00.000Z');
  });

  it('accepts today, which is still the 24th in New York', () => {
    expect(
      resolveEndDate({
        endDay: '2026-09-24',
        startsAt: null,
        timezone,
        now,
      }).toISOString(),
    ).toBe('2026-09-25T04:00:00.000Z');
  });

  it('crosses a daylight-saving change without losing an hour of the day', () => {
    // New York falls back on 1 November 2026.
    expect(
      resolveEndDate({
        endDay: '2026-11-01',
        startsAt: null,
        timezone,
        now,
      }).toISOString(),
    ).toBe('2026-11-02T05:00:00.000Z');
  });

  it('refuses a day already over in the Store’s timezone', () => {
    const [complaint] = complaintsOf(() =>
      resolveEndDate({ endDay: '2026-09-23', startsAt: null, timezone, now }),
    );
    expect(complaint).toMatchObject({ field: 'schedule', adIndex: null });
    expect(complaint.message).toMatch(/already passed/);
  });

  it('refuses an end before a campaign that has not started yet', () => {
    const startsAt = new Date('2026-10-10T04:00:00Z');
    expect(
      complaintsOf(() =>
        resolveEndDate({ endDay: '2026-10-05', startsAt, timezone, now }),
      )[0].message,
    ).toMatch(/before the campaign starts/);
  });

  it('refuses a day that does not exist', () => {
    expect(
      complaintsOf(() =>
        resolveEndDate({ endDay: '2026-02-30', startsAt: null, timezone, now }),
      )[0].message,
    ).toMatch(/not a real date/);
  });
});

describe('normalizeCountries', () => {
  it('upper-cases, trims and keeps each country once, in order', () => {
    expect(normalizeCountries([' us', 'GB', 'us', 'de'])).toEqual([
      'US',
      'GB',
      'DE',
    ]);
  });

  it('refuses no countries and codes that are not two letters', () => {
    expect(complaintsOf(() => normalizeCountries([]))[0].field).toBe(
      'audience',
    );
    expect(complaintsOf(() => normalizeCountries(['USA']))[0].message).toMatch(
      /USA/,
    );
  });
});

describe('checkAgeRange', () => {
  it('accepts 18 to 65, either end included', () => {
    expect(() => checkAgeRange(18, 65)).not.toThrow();
    expect(() => checkAgeRange(30, 30)).not.toThrow();
  });

  it('refuses ages outside the range, fractions, and a range the wrong way round', () => {
    expect(complaintsOf(() => checkAgeRange(13, 30))[0].field).toBe('audience');
    expect(complaintsOf(() => checkAgeRange(18, 70))[0].field).toBe('audience');
    expect(complaintsOf(() => checkAgeRange(18.5, 30))[0].field).toBe(
      'audience',
    );
    expect(complaintsOf(() => checkAgeRange(40, 30))[0].message).toMatch(
      /above the oldest/,
    );
  });
});

describe('checkAdCount', () => {
  it('accepts one to six', () => {
    expect(() => checkAdCount(1)).not.toThrow();
    expect(() => checkAdCount(MAX_ADS)).not.toThrow();
  });

  it('refuses none and more than six', () => {
    expect(complaintsOf(() => checkAdCount(0))[0].message).toMatch(/at least/);
    expect(complaintsOf(() => checkAdCount(7))[0].message).toMatch(/at most 6/);
  });
});

describe('adName', () => {
  it('names each ad after its campaign and its place in it', () => {
    expect(adName('Autumn sale', 0)).toBe('Autumn sale · Ad 1');
    expect(adName('Autumn sale', 5)).toBe('Autumn sale · Ad 6');
  });

  it('stays within the platform’s name limit', () => {
    const name = adName('x'.repeat(255), 2);
    expect(name).toHaveLength(255);
    expect(name.endsWith(' · Ad 3')).toBe(true);
  });
});
