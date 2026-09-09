/**
 * The measured half of the report, as a pure unit.
 *
 * Three things carry this file, and all three fail without throwing:
 *
 * **A visitor is a person, not a row.** The stream is a log, so the same
 * person arrives on the same tags over and over; counting rows instead of
 * identities would report an audience many times larger than it is and a
 * conversion rate correspondingly smaller.
 *
 * **Absent is not zero.** A Campaign the stream has nothing for reports no
 * measured figures at all. A zero would say nobody came, which is a claim we
 * are in no position to make about a source an ad blocker can suppress
 * entirely.
 *
 * **Resolution is ADR-0004's, unchanged.** Visitors go through the same two
 * matchers the money does, so an Ad can no more claim a sibling Campaign's
 * visitor than its sale.
 *
 * No database, no framework, no clock.
 */
import {
  measuredTrafficFor,
  tallyVisitors,
  type TaggedVisitor,
} from './traffic.util';
import {
  createCampaignMatcher,
  type MatchableRule,
} from './campaign-matching.util';
import { createAdMatcher, type MatchableAdRule } from './ad-matching.util';

const SUMMER = 'campaign-summer';
const SPRING = 'campaign-spring';

const VIDEO_A = 'ad-summer-video-a';
const STILL_B = 'ad-summer-still-b';
/** Spring's own `video-a` — the same tag, a different creative, a different push. */
const SPRING_VIDEO_A = 'ad-spring-video-a';

const CREATED_AT = new Date('2026-01-01T00:00:00Z');

const campaignRules: MatchableRule[] = [
  {
    campaignId: SUMMER,
    field: 'utm_campaign',
    operator: 'equals',
    value: 'summer-sale',
    campaignCreatedAt: CREATED_AT,
  },
  {
    campaignId: SPRING,
    field: 'utm_campaign',
    operator: 'equals',
    value: 'spring-sale',
    campaignCreatedAt: CREATED_AT,
  },
];

const adRules: MatchableAdRule[] = [
  {
    adId: VIDEO_A,
    campaignId: SUMMER,
    field: 'utm_content',
    operator: 'equals',
    value: 'video-a',
    adCreatedAt: CREATED_AT,
  },
  {
    adId: STILL_B,
    campaignId: SUMMER,
    field: 'utm_content',
    operator: 'equals',
    value: 'still-b',
    adCreatedAt: CREATED_AT,
  },
  {
    adId: SPRING_VIDEO_A,
    campaignId: SPRING,
    field: 'utm_content',
    operator: 'equals',
    value: 'video-a',
    adCreatedAt: CREATED_AT,
  },
];

const matcher = createCampaignMatcher(campaignRules);
const adMatcher = createAdMatcher(adRules);

const seen = (
  utmCampaign: string | null,
  utmContent: string | null,
  visitorKey: string,
): TaggedVisitor => ({ utmCampaign, utmContent, visitorKey });

const tally = (rows: TaggedVisitor[]) =>
  tallyVisitors(rows, matcher, adMatcher);

describe('tallyVisitors', () => {
  it('counts the people a campaign and each of its creatives were seen by', () => {
    const result = tally([
      seen('summer-sale', 'video-a', 'v1'),
      seen('summer-sale', 'video-a', 'v2'),
      seen('summer-sale', 'still-b', 'v3'),
    ]);

    expect(result.byCampaign.get(SUMMER)).toBe(3);
    expect(result.byAd.get(VIDEO_A)).toBe(2);
    expect(result.byAd.get(STILL_B)).toBe(1);
  });

  it('counts one person once however many times they arrive', () => {
    // The rows a real stream produces: one visitor, many hits. Rows are not
    // people, and a count of rows would report an audience of five.
    const result = tally([
      seen('summer-sale', 'video-a', 'v1'),
      seen('summer-sale', 'video-a', 'v1'),
      seen('summer-sale', 'video-a', 'v1'),
      seen('summer-sale', 'video-a', 'v1'),
      seen('summer-sale', 'video-a', 'v1'),
    ]);

    expect(result.byCampaign.get(SUMMER)).toBe(1);
    expect(result.byAd.get(VIDEO_A)).toBe(1);
  });

  it('normalizes both sides, so one campaign written four ways is one campaign', () => {
    // The reason the rows arrive unresolved: a query grouping on the raw tag
    // would make these four campaigns, and this visitor four visitors.
    const result = tally([
      seen('summer-sale', 'video-a', 'v1'),
      seen('Summer_Sale', 'Video_A', 'v1'),
      seen(' summer sale ', 'video a', 'v1'),
      seen('SUMMER-SALE', 'VIDEO-A', 'v1'),
    ]);

    expect(result.byCampaign.get(SUMMER)).toBe(1);
    expect(result.byAd.get(VIDEO_A)).toBe(1);
  });

  it('counts one visitor of two creatives once for the campaign and once for each', () => {
    // Ads do not sum to their campaign, and this is why: revenue subdivides
    // because an order belongs to one ad, an audience overlaps because a
    // person does not.
    const result = tally([
      seen('summer-sale', 'video-a', 'v1'),
      seen('summer-sale', 'still-b', 'v1'),
    ]);

    expect(result.byCampaign.get(SUMMER)).toBe(1);
    expect(result.byAd.get(VIDEO_A)).toBe(1);
    expect(result.byAd.get(STILL_B)).toBe(1);
  });

  // ─── ADR-0004, on the traffic side ──────────────────────────────────────────

  it('never credits a creative with a visitor of another campaign', () => {
    // Both campaigns own a `video-a`. Each visitor lands on its own.
    const result = tally([
      seen('summer-sale', 'video-a', 'v1'),
      seen('spring-sale', 'video-a', 'v2'),
    ]);

    expect(result.byAd.get(VIDEO_A)).toBe(1);
    expect(result.byAd.get(SPRING_VIDEO_A)).toBe(1);
    expect(result.byCampaign.get(SUMMER)).toBe(1);
    expect(result.byCampaign.get(SPRING)).toBe(1);
  });

  it('leaves a visitor no creative claims on the campaign alone', () => {
    // An untagged link, or a tag no ad of this campaign owns. The campaign saw
    // them; no creative did, and nobody is credited by default.
    const result = tally([
      seen('summer-sale', null, 'v1'),
      seen('summer-sale', 'video-c', 'v2'),
      seen('summer-sale', '---', 'v3'),
    ]);

    expect(result.byCampaign.get(SUMMER)).toBe(3);
    expect(result.byAd.get(VIDEO_A)).toBeUndefined();
    expect(result.byAd.get(STILL_B)).toBeUndefined();
  });

  it('drops a visitor no campaign claims', () => {
    // The event stream's twin of unattributed. There is no line on the report
    // for it, and it is never folded into one that exists.
    const result = tally([
      seen(null, 'video-a', 'v1'),
      seen('black-friday', 'video-a', 'v2'),
    ]);

    expect(result.byCampaign.size).toBe(0);
    expect(result.byAd.size).toBe(0);
  });

  it('reports nothing at all for a campaign the stream never saw', () => {
    // Not a zero. `undefined` is what `measuredTrafficFor` turns into an
    // absent figure, and the distinction is the whole point.
    const result = tally([seen('summer-sale', 'video-a', 'v1')]);

    expect(result.byCampaign.get(SPRING)).toBeUndefined();
    expect(result.byAd.get(SPRING_VIDEO_A)).toBeUndefined();
  });

  it('returns empty tallies for an empty stream', () => {
    const result = tally([]);

    expect(result.byCampaign.size).toBe(0);
    expect(result.byAd.size).toBe(0);
  });
});

describe('measuredTrafficFor', () => {
  it('is absent, not zero, when the stream saw nobody', () => {
    // "We did not see anyone" and "nobody came" are different claims, and only
    // one of them is ours to make about an ad-blockable source.
    expect(measuredTrafficFor(undefined, 3)).toBeNull();
    expect(measuredTrafficFor(0, 3)).toBeNull();
  });

  it('reports purchases over visitors, to one decimal', () => {
    expect(measuredTrafficFor(200, 5)).toEqual({
      visitors: 200,
      conversionRatePct: 2.5,
    });
  });

  it('keeps a rate a whole number would round away', () => {
    // Four in a thousand converted. Rounded to a whole percent this reads 0%,
    // which is the same thing the report says when nobody bought at all.
    expect(measuredTrafficFor(1000, 4)?.conversionRatePct).toBe(0.4);
  });

  it('reports a real zero when the stream saw people and none of them bought', () => {
    // The creative this feature exists to tell apart from one nobody clicked:
    // it was clicked, and it did not convert.
    expect(measuredTrafficFor(120, 0)).toEqual({
      visitors: 120,
      conversionRatePct: 0,
    });
  });

  it('does not cap the rate, so a mis-tagged store is visible rather than tidy', () => {
    // Purchases are counted in full and visitors only where the tracker saw
    // them, so a rate above 100% is possible and is a real signal — the
    // measurement is broken, not the shop.
    expect(measuredTrafficFor(2, 3)?.conversionRatePct).toBe(150);
  });
});
