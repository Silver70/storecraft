import {
  applyDeclaredAttribution,
  emptyAttribution,
  pickAttribution,
} from './attribution.util';
import type { AttributionSnapshot } from './attribution.types';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const YESTERDAY = new Date('2026-09-03T12:00:00.000Z');
const LAST_WEEK = new Date('2026-08-28T12:00:00.000Z');

/** A cart's stored group, built from a patch the way a write would leave it. */
function snapshotWith(
  patch: Partial<AttributionSnapshot>,
): AttributionSnapshot {
  return { ...emptyAttribution(), ...patch };
}

describe('applyDeclaredAttribution', () => {
  it('records a declared arrival as both the first and the last touch', () => {
    const patch = applyDeclaredAttribution(
      null,
      {
        lastTouch: {
          utmSource: 'instagram',
          utmMedium: 'paid_social',
          utmCampaign: 'summer_sale',
          referrer: 'https://l.instagram.com/',
          landingPath: '/products/fan',
        },
        visitorId: 'visitor-1',
        sessionId: 'session-1',
      },
      NOW,
    );

    expect(patch).toMatchObject({
      attributionSource: 'declared',
      visitorId: 'visitor-1',
      sessionId: 'session-1',
      firstTouchUtmSource: 'instagram',
      firstTouchUtmCampaign: 'summer_sale',
      firstTouchLandingPath: '/products/fan',
      firstTouchAt: NOW,
      lastTouchUtmSource: 'instagram',
      lastTouchUtmCampaign: 'summer_sale',
      lastTouchAt: NOW,
    });
  });

  it('advances the last touch and leaves the first touch untouched', () => {
    const current = snapshotWith({
      attributionSource: 'declared',
      firstTouchUtmSource: 'instagram',
      firstTouchUtmCampaign: 'summer_sale',
      firstTouchAt: LAST_WEEK,
      lastTouchUtmSource: 'instagram',
      lastTouchUtmCampaign: 'summer_sale',
      lastTouchAt: LAST_WEEK,
    });

    const patch = applyDeclaredAttribution(
      current,
      { lastTouch: { utmSource: 'google', utmCampaign: 'brand' } },
      NOW,
    );

    expect(patch.lastTouchUtmSource).toBe('google');
    expect(patch.lastTouchUtmCampaign).toBe('brand');
    expect(patch.lastTouchAt).toEqual(NOW);
    expect(patch).not.toHaveProperty('firstTouchUtmSource');
    expect(patch).not.toHaveProperty('firstTouchUtmCampaign');
    expect(patch).not.toHaveProperty('firstTouchAt');
  });

  it('keeps the last touch on the newer arrival when a stored first touch is re-sent', () => {
    const current = snapshotWith({
      attributionSource: 'declared',
      firstTouchUtmCampaign: 'summer_sale',
      firstTouchAt: LAST_WEEK,
      lastTouchUtmCampaign: 'retargeting',
      lastTouchAt: YESTERDAY,
    });

    const patch = applyDeclaredAttribution(
      current,
      {
        firstTouch: { utmCampaign: 'summer_sale', occurredAt: LAST_WEEK },
      },
      NOW,
    );

    expect(patch).not.toHaveProperty('lastTouchUtmCampaign');
    expect(patch).not.toHaveProperty('lastTouchAt');
    expect(patch).not.toHaveProperty('firstTouchAt');
  });

  it('applies both touches in order when a storefront declares them together', () => {
    const patch = applyDeclaredAttribution(
      null,
      {
        firstTouch: { utmCampaign: 'summer_sale', occurredAt: LAST_WEEK },
        lastTouch: { utmCampaign: 'retargeting', occurredAt: YESTERDAY },
      },
      NOW,
    );

    expect(patch.firstTouchUtmCampaign).toBe('summer_sale');
    expect(patch.firstTouchAt).toEqual(LAST_WEEK);
    expect(patch.lastTouchUtmCampaign).toBe('retargeting');
    expect(patch.lastTouchAt).toEqual(YESTERDAY);
  });

  it('records nothing for a direct arrival carrying no utm and no referrer', () => {
    const patch = applyDeclaredAttribution(
      null,
      { lastTouch: { landingPath: '/' }, sessionId: 'session-1' },
      NOW,
    );

    // The session id is still worth keeping — it is what the correlation
    // fallback joins on — but no touch was recorded, so nothing is attributed.
    expect(patch).toEqual({ sessionId: 'session-1' });
  });

  it('treats a referrer alone as an attributed touch', () => {
    const patch = applyDeclaredAttribution(
      null,
      { lastTouch: { referrer: 'https://news.ycombinator.com/' } },
      NOW,
    );

    expect(patch.attributionSource).toBe('declared');
    expect(patch.firstTouchReferrer).toBe('https://news.ycombinator.com/');
  });

  it('writes nothing when there is no declaration at all', () => {
    expect(applyDeclaredAttribution(null, undefined, NOW)).toEqual({});
    expect(applyDeclaredAttribution(null, null, NOW)).toEqual({});
    expect(applyDeclaredAttribution(null, {}, NOW)).toEqual({});
    expect(
      applyDeclaredAttribution(null, { firstTouch: {}, lastTouch: {} }, NOW),
    ).toEqual({});
  });

  it('trims values, drops blank ones, and truncates to the column width', () => {
    const patch = applyDeclaredAttribution(
      null,
      {
        lastTouch: {
          utmSource: '  instagram  ',
          utmMedium: '   ',
          referrer: `https://example.test/${'x'.repeat(2000)}`,
        },
      },
      NOW,
    );

    expect(patch.lastTouchUtmSource).toBe('instagram');
    expect(patch.lastTouchUtmMedium).toBeNull();
    expect(patch.lastTouchReferrer).toHaveLength(1024);
  });

  it('clamps a future or unparseable touch timestamp to now', () => {
    const future = applyDeclaredAttribution(
      null,
      { lastTouch: { utmSource: 'x', occurredAt: new Date('2030-01-01') } },
      NOW,
    );
    expect(future.lastTouchAt).toEqual(NOW);

    const broken = applyDeclaredAttribution(
      null,
      { lastTouch: { utmSource: 'x', occurredAt: new Date('nonsense') } },
      NOW,
    );
    expect(broken.lastTouchAt).toEqual(NOW);
  });
});

describe('pickAttribution', () => {
  it('lifts the attribution group out of a row and drops everything else', () => {
    const row = {
      id: 'cart-1',
      total: 4200,
      attributionSource: 'declared' as const,
      firstTouchUtmCampaign: 'summer_sale',
      firstTouchAt: LAST_WEEK,
      lastTouchUtmCampaign: 'retargeting',
      lastTouchAt: YESTERDAY,
    };

    expect(pickAttribution(row)).toEqual(
      snapshotWith({
        attributionSource: 'declared',
        firstTouchUtmCampaign: 'summer_sale',
        firstTouchAt: LAST_WEEK,
        lastTouchUtmCampaign: 'retargeting',
        lastTouchAt: YESTERDAY,
      }),
    );
  });

  it('yields an unattributed snapshot for a row with nothing on it', () => {
    expect(pickAttribution(null)).toEqual(emptyAttribution());
    expect(pickAttribution({})).toEqual(emptyAttribution());
  });
});
