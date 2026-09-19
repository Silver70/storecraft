/**
 * What a sync decides to hold, resolve and release.
 *
 * Tested as a unit because it fails quietly. Getting this wrong does not throw:
 * it refills a merchant's review list with ads they already dismissed, or stops
 * holding an ad the platform is charging them for, and neither leaves a trace.
 */
import {
  planUnlinkedAds,
  type PlatformAdSighting,
} from './unlinked-ad-plan.util';
import type { UnlinkedAdState } from '../../../shared/database/schema';

function sighting(
  externalAdId: string,
  overrides: Partial<PlatformAdSighting> = {},
): PlatformAdSighting {
  return {
    externalAdId,
    name: `Ad ${externalAdId}`,
    creativeUrl: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

const nothingClaimed = new Map<string, string>();
const nothingHeld = new Map<string, UnlinkedAdState>();

describe('planning what a sync holds', () => {
  it('holds an ad no Ad in the store claims', () => {
    const plan = planUnlinkedAds({
      sightings: [sighting('ad_1')],
      claimedByAds: nothingClaimed,
      held: nothingHeld,
    });

    expect(plan.hold.map((a) => a.externalAdId)).toEqual(['ad_1']);
    expect(plan.resolve).toEqual([]);
    expect(plan.release).toEqual([]);
  });

  it('holds nothing for an ad an Ad already claims', () => {
    const plan = planUnlinkedAds({
      sightings: [sighting('ad_1')],
      claimedByAds: new Map([['ad_1', 'our-ad-id']]),
      held: nothingHeld,
    });

    expect(plan.hold).toEqual([]);
  });

  /**
   * The point of the whole table. A sync meets every ad on every run, so this
   * is the case that decides whether a decision survives.
   */
  it('re-holds a dismissed ad so its description refreshes, and nothing else', () => {
    const plan = planUnlinkedAds({
      sightings: [sighting('ad_1', { name: 'Renamed at the platform' })],
      claimedByAds: nothingClaimed,
      held: new Map([['ad_1', 'dismissed']]),
    });

    // It is in `hold`, which updates name, creative, flight and last-seen. The
    // state is not in the plan at all — a dismissal is not something a sync
    // may undo, and the only way back is the merchant restoring it.
    expect(plan.hold).toHaveLength(1);
    expect(plan.hold[0].name).toBe('Renamed at the platform');
    expect(plan.resolve).toEqual([]);
    expect(plan.release).toEqual([]);
  });

  it('resolves a pending row an Ad has come to claim by hand', () => {
    const plan = planUnlinkedAds({
      sightings: [sighting('ad_1')],
      claimedByAds: new Map([['ad_1', 'our-ad-id']]),
      held: new Map([['ad_1', 'pending']]),
    });

    expect(plan.resolve).toEqual([{ externalAdId: 'ad_1', adId: 'our-ad-id' }]);
    expect(plan.hold).toEqual([]);
  });

  it('leaves an already claimed row alone', () => {
    const plan = planUnlinkedAds({
      sightings: [sighting('ad_1')],
      claimedByAds: new Map([['ad_1', 'our-ad-id']]),
      held: new Map([['ad_1', 'claimed']]),
    });

    expect(plan).toEqual({ hold: [], resolve: [], release: [] });
  });

  it('releases a claimed row whose Ad no longer carries the platform id', () => {
    // The merchant cleared `external_id` on the Ad, or the Ad is gone. The
    // platform is still spending, and nothing here claims it any more — which
    // is what pending means.
    const plan = planUnlinkedAds({
      sightings: [sighting('ad_1')],
      claimedByAds: nothingClaimed,
      held: new Map([['ad_1', 'claimed']]),
    });

    expect(plan.release).toEqual(['ad_1']);
    expect(plan.hold).toHaveLength(1);
  });

  it('never proposes creating an Ad, whatever it is given', () => {
    const plan = planUnlinkedAds({
      sightings: [sighting('a'), sighting('b'), sighting('c')],
      claimedByAds: new Map([['b', 'our-ad-id']]),
      held: new Map([['c', 'dismissed']]),
    });

    // The entire output is decisions about held rows. There is no field on it
    // that could carry an Ad, and that is the shape doing the enforcing.
    expect(Object.keys(plan).sort()).toEqual(['hold', 'release', 'resolve']);
  });

  describe('what the platform sends that we do not trust', () => {
    it('writes one row for an ad reported twice, keeping the last description', () => {
      const plan = planUnlinkedAds({
        sightings: [
          sighting('ad_1', { name: 'First' }),
          sighting('ad_1', { name: 'Second' }),
        ],
        claimedByAds: nothingClaimed,
        held: nothingHeld,
      });

      expect(plan.hold).toHaveLength(1);
      expect(plan.hold[0].name).toBe('Second');
    });

    it('drops an ad with no platform id, because nothing could ever match it', () => {
      const plan = planUnlinkedAds({
        sightings: [sighting(''), sighting('ad_1')],
        claimedByAds: nothingClaimed,
        held: nothingHeld,
      });

      expect(plan.hold.map((a) => a.externalAdId)).toEqual(['ad_1']);
    });

    it('holds nothing for an empty tree', () => {
      expect(
        planUnlinkedAds({
          sightings: [],
          claimedByAds: nothingClaimed,
          held: nothingHeld,
        }),
      ).toEqual({ hold: [], resolve: [], release: [] });
    });
  });

  it('carries the description a merchant recognises the ad by', () => {
    const startsAt = new Date('2026-08-01T00:00:00Z');
    const plan = planUnlinkedAds({
      sightings: [
        sighting('ad_1', {
          name: 'Summer reel',
          creativeUrl: 'https://platform.test/creative.jpg',
          startsAt,
        }),
      ],
      claimedByAds: nothingClaimed,
      held: nothingHeld,
    });

    expect(plan.hold[0]).toMatchObject({
      externalAdId: 'ad_1',
      name: 'Summer reel',
      creativeUrl: 'https://platform.test/creative.jpg',
      startsAt,
      endsAt: null,
    });
  });
});
