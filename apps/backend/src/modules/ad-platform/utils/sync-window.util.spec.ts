import {
  BACKOFF_BASE_MINUTES,
  MAX_BACKOFF_MINUTES,
  MAX_SYNC_RANGE_DAYS,
  RESTATEMENT_DAYS,
  backoffUntil,
  daysBefore,
  syncWindow,
} from './sync-window.util';

const TODAY = '2026-09-19';

describe('sync window', () => {
  describe('daysBefore', () => {
    it('crosses a month and a leap day without an offset', () => {
      expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
      expect(daysBefore('2024-03-01', 1)).toBe('2024-02-29');
      expect(daysBefore('2026-01-01', 1)).toBe('2025-12-31');
      expect(daysBefore(TODAY, 0)).toBe(TODAY);
    });
  });

  describe('a connection that has never synced', () => {
    it('asks for history rather than starting from today', () => {
      const window = syncWindow({
        today: TODAY,
        lastSyncedDay: null,
        maxBackfillDays: 90,
      });

      expect(window).toEqual({
        from: '2026-06-21',
        to: TODAY,
        backfill: true,
      });
    });

    it('asks for no more than the platform retains', () => {
      // Asking beyond the platform's own window returns nothing extra and
      // spends quota — which is shared — doing it.
      expect(
        syncWindow({ today: TODAY, lastSyncedDay: null, maxBackfillDays: 28 })
          .from,
      ).toBe('2026-08-22');
    });

    it('still asks for today when the platform retains nothing', () => {
      expect(
        syncWindow({ today: TODAY, lastSyncedDay: null, maxBackfillDays: 0 }),
      ).toEqual({ from: TODAY, to: TODAY, backfill: true });
    });
  });

  describe('a connection that has synced before', () => {
    it('re-pulls a trailing window, because a platform restates', () => {
      const window = syncWindow({
        today: TODAY,
        lastSyncedDay: '2026-09-18',
        maxBackfillDays: 90,
      });

      expect(window).toEqual({
        from: daysBefore('2026-09-18', RESTATEMENT_DAYS),
        to: TODAY,
        backfill: false,
      });
    });

    it('reaches back to the last success after a gap, not only a week', () => {
      // A connection nothing synced for a fortnight has a fortnight of missing
      // days, and the next run is what fills them.
      expect(
        syncWindow({
          today: TODAY,
          lastSyncedDay: '2026-09-01',
          maxBackfillDays: 90,
        }).from,
      ).toBe('2026-08-25');
    });

    it('never asks for more days than one request may cover', () => {
      // A restored backup or a connection untouched for a year must not become
      // a single request for four thousand ad-days.
      expect(
        syncWindow({
          today: TODAY,
          lastSyncedDay: '2019-01-01',
          maxBackfillDays: 90,
        }).from,
      ).toBe(daysBefore(TODAY, MAX_SYNC_RANGE_DAYS));
    });

    it('anchors on today when the last sync is dated in the future', () => {
      expect(
        syncWindow({
          today: TODAY,
          lastSyncedDay: '2027-01-01',
          maxBackfillDays: 90,
        }),
      ).toEqual({
        from: daysBefore(TODAY, RESTATEMENT_DAYS),
        to: TODAY,
        backfill: false,
      });
    });
  });

  describe('backing off', () => {
    const now = new Date('2026-09-19T10:00:00.000Z');
    const minutesAfter = (until: Date) =>
      (until.getTime() - now.getTime()) / 60000;

    it('doubles the wait with each consecutive refusal', () => {
      expect(minutesAfter(backoffUntil(now, 1))).toBe(BACKOFF_BASE_MINUTES);
      expect(minutesAfter(backoffUntil(now, 2))).toBe(BACKOFF_BASE_MINUTES * 2);
      expect(minutesAfter(backoffUntil(now, 3))).toBe(BACKOFF_BASE_MINUTES * 4);
    });

    it('caps the wait, so a platform that recovers overnight is picked up in the morning', () => {
      expect(minutesAfter(backoffUntil(now, 20))).toBe(MAX_BACKOFF_MINUTES);
    });

    it('treats a missing failure count as the first failure', () => {
      expect(minutesAfter(backoffUntil(now, 0))).toBe(BACKOFF_BASE_MINUTES);
    });
  });
});
