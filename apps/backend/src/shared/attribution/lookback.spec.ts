import {
  DEFAULT_ATTRIBUTION_LOOKBACK_DAYS,
  MAX_ATTRIBUTION_LOOKBACK_DAYS,
  resolveLookbackDays,
} from './lookback';

describe('resolveLookbackDays', () => {
  it('reads the configured number of days', () => {
    expect(resolveLookbackDays('7')).toBe(7);
    expect(resolveLookbackDays(60)).toBe(60);
  });

  it('falls back to the default when unset or unreadable', () => {
    // A malformed environment variable should change the report's window, not
    // stop the application from starting.
    for (const raw of [undefined, null, '', '   ', 'thirty', {}, NaN]) {
      expect(resolveLookbackDays(raw)).toBe(DEFAULT_ATTRIBUTION_LOOKBACK_DAYS);
    }
  });

  it('refuses a window that would credit nothing', () => {
    expect(resolveLookbackDays(0)).toBe(DEFAULT_ATTRIBUTION_LOOKBACK_DAYS);
    expect(resolveLookbackDays(-30)).toBe(DEFAULT_ATTRIBUTION_LOOKBACK_DAYS);
  });

  it('caps a window long enough to credit ads no one is still running', () => {
    expect(resolveLookbackDays(100_000)).toBe(MAX_ATTRIBUTION_LOOKBACK_DAYS);
  });

  it('takes whole days', () => {
    expect(resolveLookbackDays('30.9')).toBe(30);
  });
});
