import type {
  DeliverySignal,
  PlatformSignals,
  ReviewSignal,
} from '../interfaces/ad-platform-provider.interface';
import { collapseStatus } from './platform-status.util';

const NOW = new Date('2026-09-24T12:00:00Z');
const PAST = new Date('2026-09-20T00:00:00Z');
const FUTURE = new Date('2026-10-01T00:00:00Z');

const DELIVERIES: DeliverySignal[] = [
  'active',
  'paused',
  'pending_review',
  'rejected',
  'completed',
  'deleted',
  'error',
];
const REVIEWS: (ReviewSignal | null)[] = [
  null,
  'in_review',
  'approved',
  'rejected',
  'with_issues',
];
const SCHEDULES: {
  label: string;
  startsAt: Date | null;
  endsAt: Date | null;
}[] = [
  { label: 'no schedule', startsAt: null, endsAt: null },
  { label: 'running with no end', startsAt: PAST, endsAt: null },
  { label: 'ending later', startsAt: PAST, endsAt: FUTURE },
  { label: 'starting later', startsAt: FUTURE, endsAt: null },
  { label: 'past its end', startsAt: PAST, endsAt: PAST },
];

/** Every combination of the three axes the platform reports. */
const COMBINATIONS = DELIVERIES.flatMap((delivery) =>
  REVIEWS.flatMap((review) =>
    SCHEDULES.map((schedule) => ({
      delivery,
      review,
      schedule: schedule.label,
      signals: {
        delivery,
        review,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
      } satisfies PlatformSignals,
    })),
  ),
);

const pastEnd = (c: (typeof COMBINATIONS)[number]): boolean =>
  c.schedule === 'past its end';

describe('collapseStatus', () => {
  it('covers every combination of delivery, review and schedule', () => {
    expect(COMBINATIONS).toHaveLength(
      DELIVERIES.length * REVIEWS.length * SCHEDULES.length,
    );
    for (const c of COMBINATIONS) {
      expect([
        'active',
        'paused',
        'in_review',
        'needs_attention',
        'ended',
      ]).toContain(collapseStatus(c.signals, NOW));
    }
  });

  describe('Ended', () => {
    it.each(COMBINATIONS.filter((c) => c.delivery === 'deleted'))(
      'a campaign deleted on the platform reads Ended whatever else it says ($review, $schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('ended');
      },
    );

    it.each(COMBINATIONS.filter((c) => c.delivery === 'completed'))(
      'one that finished delivering reads Ended ($review, $schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('ended');
      },
    );

    it.each(COMBINATIONS.filter(pastEnd))(
      'one past its end date reads Ended even while the platform still says $delivery/$review',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('ended');
      },
    );

    it('treats an end exactly now as ended', () => {
      expect(
        collapseStatus(
          { delivery: 'active', review: null, startsAt: PAST, endsAt: NOW },
          NOW,
        ),
      ).toBe('ended');
    });
  });

  describe('Paused', () => {
    it.each(COMBINATIONS.filter((c) => c.delivery === 'paused' && !pastEnd(c)))(
      'a pause outranks the review verdict ($review, $schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('paused');
      },
    );
  });

  describe('Needs attention', () => {
    it.each(
      COMBINATIONS.filter(
        (c) =>
          (c.delivery === 'rejected' || c.delivery === 'error') && !pastEnd(c),
      ),
    )(
      'delivery $delivery needs attention whatever review says ($review, $schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('needs_attention');
      },
    );

    it.each(
      COMBINATIONS.filter(
        (c) =>
          (c.delivery === 'active' || c.delivery === 'pending_review') &&
          (c.review === 'rejected' || c.review === 'with_issues') &&
          !pastEnd(c),
      ),
    )(
      'a $review review on a $delivery object needs attention ($schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('needs_attention');
      },
    );
  });

  describe('In review', () => {
    it.each(
      COMBINATIONS.filter(
        (c) =>
          c.delivery === 'pending_review' &&
          (c.review === null ||
            c.review === 'in_review' ||
            c.review === 'approved') &&
          !pastEnd(c),
      ),
    )(
      'pending delivery reads In review ($review, $schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('in_review');
      },
    );

    it.each(
      COMBINATIONS.filter(
        (c) =>
          c.delivery === 'active' && c.review === 'in_review' && !pastEnd(c),
      ),
    )(
      'an active object whose review is still open reads In review ($schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('in_review');
      },
    );
  });

  describe('Active', () => {
    it.each(
      COMBINATIONS.filter(
        (c) =>
          c.delivery === 'active' &&
          (c.review === null || c.review === 'approved') &&
          !pastEnd(c),
      ),
    )(
      'delivering and approved reads Active ($review, $schedule)',
      ({ signals }) => {
        expect(collapseStatus(signals, NOW)).toBe('active');
      },
    );

    it('reads a campaign scheduled to start later as Active, not Paused', () => {
      expect(
        collapseStatus(
          {
            delivery: 'active',
            review: 'approved',
            startsAt: FUTURE,
            endsAt: null,
          },
          NOW,
        ),
      ).toBe('active');
    });
  });

  it('assigns every combination to exactly one of the groups above', () => {
    // The groups above partition the space; if a rule changes and a
    // combination silently moves group, one of them fails — this checks no
    // combination was left out of all of them.
    const covered = COMBINATIONS.filter(
      (c) =>
        c.delivery === 'deleted' ||
        c.delivery === 'completed' ||
        pastEnd(c) ||
        c.delivery === 'paused' ||
        c.delivery === 'rejected' ||
        c.delivery === 'error' ||
        c.review === 'rejected' ||
        c.review === 'with_issues' ||
        c.delivery === 'pending_review' ||
        c.review === 'in_review' ||
        (c.delivery === 'active' &&
          (c.review === null || c.review === 'approved')),
    );
    expect(covered).toHaveLength(COMBINATIONS.length);
  });
});
