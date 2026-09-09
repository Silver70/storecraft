/**
 * The second pass, as a pure unit.
 *
 * One property carries this file, and it is the property ADR-0004 was written
 * for: **an Ad can never claim a tuple whose `utm_campaign` resolves to a
 * different Campaign.** It fails without throwing — revenue simply appears
 * under the wrong creative in the wrong push, and stays there — so it is
 * exercised exhaustively here rather than inferred from the far end of a
 * checkout.
 *
 * The rest is the Campaign matcher's contract restated one level down, because
 * a merchant reading two grains of the same report must not have to learn two
 * sets of rules: both sides normalized, a value that normalizes to nothing
 * matching nothing, and a documented order deciding between rules that could
 * both claim a tuple.
 *
 * No database, no framework, no clock.
 */
import { createAdMatcher, type MatchableAdRule } from './ad-matching.util';
import type { AttributionTuple } from './campaign-matching.util';

const SUMMER = 'campaign-summer';
const SPRING = 'campaign-spring';

const VIDEO_A = 'ad-summer-video-a';
const STILL_B = 'ad-summer-still-b';
/** Spring's own `video-a` — the same tag, a different creative, a different push. */
const SPRING_VIDEO_A = 'ad-spring-video-a';

const CREATED_AT = new Date('2026-01-01T00:00:00Z');

function rule(overrides: Partial<MatchableAdRule> = {}): MatchableAdRule {
  return {
    adId: VIDEO_A,
    campaignId: SUMMER,
    field: 'utm_content',
    operator: 'equals',
    value: 'video-a',
    adCreatedAt: CREATED_AT,
    ...overrides,
  };
}

/** The canonical rule set: two creatives under Summer, one under Spring. */
const RULES: MatchableAdRule[] = [
  rule(),
  rule({ adId: STILL_B, value: 'still-b' }),
  rule({ adId: SPRING_VIDEO_A, campaignId: SPRING, value: 'video-a' }),
];

const matcher = createAdMatcher(RULES);

const tuple = (utmContent: string | null | undefined): AttributionTuple => ({
  utmCampaign: 'summer-sale',
  utmSource: 'instagram',
  utmMedium: 'paid_social',
  referrer: 'https://l.instagram.com/',
  utmContent,
});

describe('createAdMatcher', () => {
  it('resolves a tuple onto the ad whose tag it carries', () => {
    expect(matcher(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
    expect(matcher(SUMMER, tuple('still-b'))).toBe(STILL_B);
  });

  // ─── The property ADR-0004 exists for ───────────────────────────────────────

  describe('an ad never claims another campaign’s tuple', () => {
    it('answers only from the campaign it was asked about', () => {
      // The tuple says `video-a` and both campaigns own one. The answer is
      // decided by the campaign that already won, never by the tag alone.
      expect(matcher(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
      expect(matcher(SPRING, tuple('video-a'))).toBe(SPRING_VIDEO_A);
    });

    it('resolves two campaigns owning the same tag independently', () => {
      // Neither answer moves when the other campaign's rules change, because
      // the two never share a candidate list.
      const withoutSpring = createAdMatcher([
        rule(),
        rule({ adId: STILL_B, value: 'still-b' }),
      ]);

      expect(withoutSpring(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
      // Spring has no ads at all here — unassigned, never Summer's video-a.
      expect(withoutSpring(SPRING, tuple('video-a'))).toBe(null);
    });

    it('never returns an ad belonging to a campaign it was not asked about', () => {
      // Exhaustive over the whole rule set and every tag in it: whatever is
      // asked, the answer is either null or an ad of the campaign asked for.
      const campaigns = [SUMMER, SPRING, 'campaign-unknown'];
      const tags = [
        'video-a',
        'still-b',
        'Video_A',
        'STILL B',
        'video-a-extra',
        '',
        null,
        undefined,
      ];
      const ownerOf: Record<string, string> = {
        [VIDEO_A]: SUMMER,
        [STILL_B]: SUMMER,
        [SPRING_VIDEO_A]: SPRING,
      };

      for (const campaignId of campaigns) {
        for (const tag of tags) {
          const adId = matcher(campaignId, tuple(tag));
          if (adId !== null) expect(ownerOf[adId]).toBe(campaignId);
        }
      }
    });

    it('is unmoved by the tuple’s own utm_campaign', () => {
      // The campaign is decided by the first pass and passed in. Nothing here
      // reads `utm_campaign`, so a tuple naming Spring resolves onto Summer's
      // creative when Summer is the campaign that won — and vice versa.
      const namingSpring = { ...tuple('video-a'), utmCampaign: 'spring-sale' };

      expect(matcher(SUMMER, namingSpring)).toBe(VIDEO_A);
      expect(matcher(SPRING, tuple('video-a'))).toBe(SPRING_VIDEO_A);
    });

    it('drops rules on fields ad resolution does not read', () => {
      // A rule on a campaign field could otherwise let an ad be chosen by
      // evidence that belongs to the contest it already sat out.
      const bySource = createAdMatcher([
        rule({ field: 'utm_source', value: 'instagram' }),
        rule({ field: 'utm_campaign', value: 'summer-sale' }),
        rule({ field: 'referrer_host', value: 'instagram.com' }),
        rule({ field: 'utm_medium', value: 'paid_social' }),
      ]);

      expect(bySource(SUMMER, tuple(null))).toBe(null);
      expect(bySource(SUMMER, tuple('video-a'))).toBe(null);
    });
  });

  // ─── Normalization ──────────────────────────────────────────────────────────

  describe('normalization', () => {
    it('reads Video_A and video-a as one ad', () => {
      expect(matcher(SUMMER, tuple('Video_A'))).toBe(VIDEO_A);
      expect(matcher(SUMMER, tuple('VIDEO A'))).toBe(VIDEO_A);
      expect(matcher(SUMMER, tuple('  video-a  '))).toBe(VIDEO_A);
    });

    it('normalizes the rule side too', () => {
      const shouty = createAdMatcher([rule({ value: 'Video_A' })]);
      expect(shouty(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
    });

    it('drops a rule whose value normalizes to nothing', () => {
      // It could never match, and keeping it would only give it a chance to
      // shadow a rule that can.
      const noisy = createAdMatcher([
        rule({ adId: STILL_B, operator: 'starts_with', value: '   ' }),
        rule(),
      ]);

      expect(noisy(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
    });
  });

  // ─── Unassigned ─────────────────────────────────────────────────────────────

  describe('unassigned', () => {
    it('treats a utm_content that normalizes to nothing as unassigned', () => {
      // Absence of evidence is not a match, on the same principle the campaign
      // matcher already applies.
      expect(matcher(SUMMER, tuple(null))).toBe(null);
      expect(matcher(SUMMER, tuple(undefined))).toBe(null);
      expect(matcher(SUMMER, tuple(''))).toBe(null);
      expect(matcher(SUMMER, tuple('   '))).toBe(null);
      expect(matcher(SUMMER, tuple('---'))).toBe(null);
    });

    it('does not let a prefix rule claim an empty utm_content', () => {
      // `''.startsWith('')` is true in JavaScript. Nothing reaches the
      // comparison, because a null candidate is refused before it.
      const prefix = createAdMatcher([
        rule({ operator: 'starts_with', value: 'video' }),
      ]);

      expect(prefix(SUMMER, tuple(''))).toBe(null);
      expect(prefix(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
    });

    it('is unassigned when the tag matches no ad of that campaign', () => {
      expect(matcher(SUMMER, tuple('carousel-c'))).toBe(null);
    });

    it('is unassigned for a campaign with no ads at all', () => {
      expect(matcher('campaign-unknown', tuple('video-a'))).toBe(null);
      expect(createAdMatcher([])(SUMMER, tuple('video-a'))).toBe(null);
    });
  });

  // ─── Determinism ────────────────────────────────────────────────────────────

  describe('determinism', () => {
    it('prefers an exact rule over a prefix that also covers the tuple', () => {
      const both = createAdMatcher([
        rule({ adId: STILL_B, operator: 'starts_with', value: 'video' }),
        rule({ adId: VIDEO_A, operator: 'equals', value: 'video-a' }),
      ]);

      expect(both(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
      // The prefix still claims what the exact rule does not.
      expect(both(SUMMER, tuple('video-b'))).toBe(STILL_B);
    });

    it('breaks a tie on the older ad', () => {
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-03-01T00:00:00Z');
      const both = createAdMatcher([
        rule({
          adId: STILL_B,
          operator: 'starts_with',
          value: 'video',
          adCreatedAt: newer,
        }),
        rule({
          adId: VIDEO_A,
          operator: 'starts_with',
          value: 'video',
          adCreatedAt: older,
        }),
      ]);

      expect(both(SUMMER, tuple('video-a'))).toBe(VIDEO_A);
    });

    it('resolves the same way however the rules arrive', () => {
      // Two ads created in the same millisecond still have to resolve
      // identically on every read, or a report would change under a merchant
      // who only re-loaded the page.
      const same = CREATED_AT;
      const a = rule({
        adId: 'ad-a',
        operator: 'starts_with',
        value: 'video',
        adCreatedAt: same,
      });
      const b = rule({
        adId: 'ad-b',
        operator: 'starts_with',
        value: 'video',
        adCreatedAt: same,
      });

      expect(createAdMatcher([a, b])(SUMMER, tuple('video-a'))).toBe(
        createAdMatcher([b, a])(SUMMER, tuple('video-a')),
      );
    });
  });

  it('is pure — the same matcher answers the same way twice', () => {
    const first = matcher(SUMMER, tuple('video-a'));
    const second = matcher(SUMMER, tuple('video-a'));
    expect(first).toBe(second);
  });
});
