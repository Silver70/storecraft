import {
  ATTRIBUTION_WINDOW_DAYS,
  CLAIM_LEASE_MINUTES,
  PURCHASED_ORDER_STATUSES,
  asEmailMatchKey,
  asPhoneMatchKey,
  attributionWindowStart,
  claimableBefore,
  mayReportPurchase,
  withinAttributionWindow,
} from './purchase-dispatch.util';

/**
 * The rules that decide whether a customer's data leaves this system.
 *
 * Asserted here rather than through the dispatcher because each one fails
 * quietly: a consent gate that reads an unanswered banner as a yes reports
 * somebody who never agreed, and a match key that was not lowercased is hashed
 * into a different person. Neither throws, and neither is visible in anything a
 * merchant looks at.
 */
describe('purchase dispatch rules', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');
  const minutes = (n: number) => n * 60 * 1000;
  const days = (n: number) => n * 24 * 60 * minutes(1);

  describe('mayReportPurchase', () => {
    it('reports every sale on a store that does not ask', () => {
      // The default, and the behaviour a merchant who needs no banner gets: an
      // unasked visitor is not a refusing one.
      expect(mayReportPurchase({ consentRequired: false, consent: null })).toBe(
        true,
      );
      expect(
        mayReportPurchase({ consentRequired: false, consent: 'denied' }),
      ).toBe(true);
    });

    it('reports only what was agreed to on a store that asks', () => {
      expect(
        mayReportPurchase({ consentRequired: true, consent: 'granted' }),
      ).toBe(true);
      expect(
        mayReportPurchase({ consentRequired: true, consent: 'denied' }),
      ).toBe(false);
    });

    it('treats an unanswered banner as a no, not as an absence of an answer', () => {
      // An Order placed before the switch was turned on, or by a visitor who
      // scrolled past the banner. Neither agreed, and a hashed email is personal
      // data exactly as a page view is.
      expect(mayReportPurchase({ consentRequired: true, consent: null })).toBe(
        false,
      );
    });
  });

  describe('the attribution window', () => {
    it('is the seven days the platform can still attribute within', () => {
      expect(ATTRIBUTION_WINDOW_DAYS).toBe(7);
    });

    it('holds a purchase made moments ago and one made just inside the window', () => {
      expect(withinAttributionWindow(now, now)).toBe(true);
      expect(
        withinAttributionWindow(new Date(now.getTime() - days(7) + 1000), now),
      ).toBe(true);
    });

    it('lets go of one the platform can no longer attribute', () => {
      // Past this line a dispatch is a customer's contact details sent to an ad
      // platform in exchange for nothing.
      expect(
        withinAttributionWindow(new Date(now.getTime() - days(7)), now),
      ).toBe(false);
      expect(
        withinAttributionWindow(new Date(now.getTime() - days(30)), now),
      ).toBe(false);
    });

    it('starts where the query looking for owed purchases starts', () => {
      expect(attributionWindowStart(now).toISOString()).toBe(
        '2026-09-16T12:00:00.000Z',
      );
    });
  });

  describe('the claim lease', () => {
    it('is shorter than the hourly pass, so a failure is retried on the next one', () => {
      expect(CLAIM_LEASE_MINUTES).toBeLessThan(60);
    });

    it('holds a dispatch claimed moments ago and releases one claimed before it', () => {
      const boundary = claimableBefore(now);

      expect(boundary.getTime()).toBe(now.getTime() - minutes(10));
      // A row attempted at the boundary or earlier may be taken over; one
      // attempted after it is somebody else's send, possibly still in flight.
      expect(new Date(now.getTime() - minutes(11)) <= boundary).toBe(true);
      expect(new Date(now.getTime() - minutes(1)) <= boundary).toBe(false);
    });
  });

  describe('the statuses a purchase happened in', () => {
    it('includes a refunded Order, which the platform is never told to retract', () => {
      // The money moved and the browser's Pixel already reported it. Withholding
      // the server's copy would leave the platform holding half a purchase.
      expect(PURCHASED_ORDER_STATUSES).toContain('refunded');
    });

    it('excludes the two statuses in which nothing was bought', () => {
      expect(PURCHASED_ORDER_STATUSES).not.toContain('pending');
      expect(PURCHASED_ORDER_STATUSES).not.toContain('cancelled');
    });
  });

  describe('asEmailMatchKey', () => {
    it('lowercases and trims, because a hash is unforgiving about both', () => {
      expect(asEmailMatchKey('  Ada@Example.COM ')).toBe('ada@example.com');
    });

    it('answers null where there is nothing to match on', () => {
      expect(asEmailMatchKey(null)).toBeNull();
      expect(asEmailMatchKey('   ')).toBeNull();
      // Not validation: the difference between a match key and something typed
      // into the wrong field.
      expect(asEmailMatchKey('ada')).toBeNull();
    });
  });

  describe('asPhoneMatchKey', () => {
    it('keeps the number the merchant captured, minus the spacing', () => {
      expect(asPhoneMatchKey(' +1 415 555 1234 ')).toBe('+14155551234');
      expect(asPhoneMatchKey('(415) 555-1234')).toBe('(415)555-1234');
    });

    it('answers null where there is too little of a number to match on', () => {
      expect(asPhoneMatchKey(null)).toBeNull();
      expect(asPhoneMatchKey('n/a')).toBeNull();
      expect(asPhoneMatchKey('12345')).toBeNull();
    });
  });
});
