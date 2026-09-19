/**
 * What a sync decides to write beside an Ad's own status.
 *
 * Tested as a unit because it fails quietly. Nothing here throws when it goes
 * wrong: it puts one ad's rejection on another ad's card, or blanks a label
 * onto a badge with nothing in it, and a merchant reads a confident sentence
 * about an ad that is not theirs.
 */
import {
  planPlatformMirror,
  type PlatformAdState,
} from './platform-mirror.util';

const MAX_PLACEMENT = 120;

function reported(
  externalAdId: string,
  overrides: Partial<PlatformAdState> = {},
): PlatformAdState {
  return {
    externalAdId,
    platformState: 'delivering',
    placement: null,
    ...overrides,
  };
}

const claims = (...pairs: Array<[string, string]>) =>
  new Map(pairs.map(([externalAdId, adId]) => [externalAdId, { adId }]));

const nothingClaimed = claims();

describe('planning what the platform’s view lands on', () => {
  it('writes the platform’s state against the Ad that claims its ad', () => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1', { platformState: 'rejected' })],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows).toEqual([
      { adId: 'our-ad', platformState: 'rejected', placement: null },
    ]);
  });

  /**
   * The row this whole feature refuses to write. An ad nothing claims has no Ad
   * to put a state on, and inventing one is the thing the stage exists not to
   * do — its state belongs to an Unlinked Ad the merchant has not answered for.
   */
  it('writes nothing for an ad nothing in the store claims', () => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1', { platformState: 'rejected' })],
      claimedByAds: nothingClaimed,
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows).toEqual([]);
  });

  it('carries a placement label through as the platform named it', () => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1', { placement: 'Instagram Stories' })],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows[0].placement).toBe('Instagram Stories');
  });

  /**
   * An empty label is not a label. Left as an empty string it would render an
   * empty badge, which reads as a value the merchant failed to fill in rather
   * than as one the platform never sent.
   */
  it.each([
    ['an empty string', ''],
    ['only whitespace', '   '],
  ])('reads %s as no placement at all', (_label, placement) => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1', { placement })],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows[0].placement).toBeNull();
  });

  it('collapses the padding platforms print around a label', () => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1', { placement: '  Facebook\n  Feed  ' })],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows[0].placement).toBe('Facebook Feed');
  });

  /**
   * Cut rather than dropped: a label too long to store is still a label the
   * merchant recognises the first half of, and refusing it would leave the
   * badge empty on exactly the ads running in the most placements.
   */
  it('cuts a label too long for the column instead of losing it', () => {
    const rows = planPlatformMirror({
      reported: [
        reported('ad_1', { placement: 'P'.repeat(MAX_PLACEMENT + 40) }),
      ],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows[0].placement).toHaveLength(MAX_PLACEMENT);
  });

  /**
   * Preservation is for ads the platform did not mention — expressed by their
   * absence from this output, not by a rule in here. An ad it *did* mention and
   * said nothing about is a platform that has stopped saying anything, and the
   * null is the answer.
   */
  it('writes the platform’s silence as silence for an ad it still reports', () => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1', { platformState: null, placement: null })],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows).toEqual([
      { adId: 'our-ad', platformState: null, placement: null },
    ]);
  });

  it('leaves an ad the platform did not report out of the plan entirely', () => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1')],
      claimedByAds: claims(['ad_1', 'our-ad'], ['ad_2', 'other-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows.map((row) => row.adId)).toEqual(['our-ad']);
  });

  it('writes once for an ad the platform listed twice, with its last word', () => {
    const rows = planPlatformMirror({
      reported: [
        reported('ad_1', { platformState: 'in_review' }),
        reported('ad_1', { platformState: 'approved' }),
      ],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows).toEqual([
      { adId: 'our-ad', platformState: 'approved', placement: null },
    ]);
  });

  it('ignores an ad the platform reported with no id', () => {
    const rows = planPlatformMirror({
      reported: [reported('')],
      claimedByAds: claims(['', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(rows).toEqual([]);
  });

  /**
   * Said in the type and asserted anyway, because this is the guarantee the
   * whole design rests on: there is no key on a planned row that a status could
   * be read out of.
   */
  it('plans no status for anything, ever', () => {
    const rows = planPlatformMirror({
      reported: [reported('ad_1', { platformState: 'paused' })],
      claimedByAds: claims(['ad_1', 'our-ad']),
      maxPlacementLength: MAX_PLACEMENT,
    });

    expect(Object.keys(rows[0]).sort()).toEqual([
      'adId',
      'placement',
      'platformState',
    ]);
  });
});
