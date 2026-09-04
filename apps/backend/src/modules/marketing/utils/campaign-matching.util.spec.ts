/**
 * The matching decision, exercised as a pure unit.
 *
 * This is the seam the spec singles out: matching fails silently, so every case
 * that decides which Campaign gets credited for a sale is asserted here rather
 * than inferred from the far end of a checkout. No database, no framework.
 */
import {
  createCampaignMatcher,
  normalizeMatchValue,
  referrerHost,
  type MatchableRule,
} from './campaign-matching.util';

const SUMMER = 'campaign-summer';
const SPRING = 'campaign-spring';

/** Rule builder. Campaigns are created a day apart unless a test says otherwise. */
function rule(
  campaignId: string,
  field: MatchableRule['field'],
  operator: MatchableRule['operator'],
  value: string,
  campaignCreatedAt = new Date('2026-01-01T00:00:00Z'),
): MatchableRule {
  return { campaignId, field, operator, value, campaignCreatedAt };
}

/** Resolves a tuple against a rule set, returning the campaign id or null. */
function match(
  tuple: Parameters<ReturnType<typeof createCampaignMatcher>>[0],
  rules: MatchableRule[],
): string | null {
  return createCampaignMatcher(rules)(tuple)?.campaignId ?? null;
}

describe('normalizeMatchValue', () => {
  it('treats hyphen, underscore and whitespace as the same separator', () => {
    expect(normalizeMatchValue('summer_sale')).toBe('summer-sale');
    expect(normalizeMatchValue('summer sale')).toBe('summer-sale');
    expect(normalizeMatchValue('summer-sale')).toBe('summer-sale');
  });

  it('ignores case and surrounding padding', () => {
    expect(normalizeMatchValue('  Summer-Sale  ')).toBe('summer-sale');
  });

  it('collapses a run of separators to one', () => {
    expect(normalizeMatchValue('summer __ -- sale')).toBe('summer-sale');
  });

  it('folds accents so one campaign does not become two', () => {
    expect(normalizeMatchValue('Été-Promo')).toBe(
      normalizeMatchValue('ete_promo'),
    );
  });

  it('keeps letters outside Latin rather than erasing them', () => {
    // Stripping them would collapse every non-Latin campaign onto nothing, and
    // nothing matches nothing — every one of them would read as Unattributed.
    expect(normalizeMatchValue('サマーセール')).toBe('サマーセール');
    expect(normalizeMatchValue('Лето 2026')).toBe('лето-2026');
  });

  it('is null when nothing matchable is left', () => {
    expect(normalizeMatchValue('')).toBeNull();
    expect(normalizeMatchValue('   ')).toBeNull();
    expect(normalizeMatchValue('---')).toBeNull();
    expect(normalizeMatchValue('!!!')).toBeNull();
    expect(normalizeMatchValue(null)).toBeNull();
    expect(normalizeMatchValue(undefined)).toBeNull();
  });
});

describe('referrerHost', () => {
  it('reduces any URL on a host to that host', () => {
    expect(referrerHost('https://www.instagram.com/p/abc123/?x=1')).toBe(
      'instagram.com',
    );
    expect(referrerHost('http://instagram.com')).toBe('instagram.com');
  });

  it('accepts a bare host, which is what a merchant types', () => {
    expect(referrerHost('Instagram.com')).toBe('instagram.com');
  });

  it('is null for anything it cannot read as a host', () => {
    expect(referrerHost('not a url')).toBeNull();
    expect(referrerHost('')).toBeNull();
    expect(referrerHost(null)).toBeNull();
  });
});

describe('createCampaignMatcher', () => {
  describe('normalized matching', () => {
    const rules = [rule(SUMMER, 'utm_campaign', 'equals', 'summer-sale')];

    it.each([
      ['summer-sale'],
      ['summer_sale'],
      ['Summer-Sale'],
      ['SUMMER_SALE'],
      ['summer sale'],
      ['  summer-sale  '],
      ['Summer   Sale'],
    ])('resolves %p to the one campaign it means', (utmCampaign) => {
      expect(match({ utmCampaign }, rules)).toBe(SUMMER);
    });

    it('normalizes the rule value too, not only the incoming one', () => {
      // The merchant types what their link says; both sides get reduced.
      expect(
        match({ utmCampaign: 'summer-sale' }, [
          rule(SUMMER, 'utm_campaign', 'equals', '  Summer_Sale '),
        ]),
      ).toBe(SUMMER);
    });

    it('does not match a merely similar value', () => {
      expect(match({ utmCampaign: 'summer-sale-2025' }, rules)).toBeNull();
      expect(match({ utmCampaign: 'summersale' }, rules)).toBeNull();
    });

    it('matches a prefix only under starts_with', () => {
      const prefix = [rule(SUMMER, 'utm_campaign', 'starts_with', 'summer')];
      expect(match({ utmCampaign: 'Summer_Sale_Week_2' }, prefix)).toBe(SUMMER);
      expect(match({ utmCampaign: 'winter-sale' }, prefix)).toBeNull();
    });

    it('matches on source, medium and referrer host as well as campaign', () => {
      expect(
        match({ utmSource: 'Instagram' }, [
          rule(SUMMER, 'utm_source', 'equals', 'instagram'),
        ]),
      ).toBe(SUMMER);

      expect(
        match({ utmMedium: 'Paid_Social' }, [
          rule(SUMMER, 'utm_medium', 'equals', 'paid-social'),
        ]),
      ).toBe(SUMMER);

      expect(
        match({ referrer: 'https://www.instagram.com/p/abc/' }, [
          rule(SUMMER, 'referrer_host', 'equals', 'instagram.com'),
        ]),
      ).toBe(SUMMER);
    });
  });

  describe('precedence', () => {
    it('prefers a campaign rule over a source or medium rule', () => {
      const tuple = {
        utmCampaign: 'summer-sale',
        utmSource: 'instagram',
        utmMedium: 'paid-social',
      };
      const rules = [
        rule(SPRING, 'utm_source', 'equals', 'instagram'),
        rule(SPRING, 'utm_medium', 'equals', 'paid-social'),
        rule(SUMMER, 'utm_campaign', 'equals', 'summer-sale'),
      ];

      expect(match(tuple, rules)).toBe(SUMMER);
    });

    it('prefers a source or medium rule over a referrer host rule', () => {
      const tuple = {
        utmSource: 'instagram',
        referrer: 'https://instagram.com/p/abc/',
      };
      const rules = [
        rule(SPRING, 'referrer_host', 'equals', 'instagram.com'),
        rule(SUMMER, 'utm_source', 'equals', 'instagram'),
      ];

      expect(match(tuple, rules)).toBe(SUMMER);
    });

    it('prefers equals over starts_with on the same field', () => {
      const rules = [
        rule(SPRING, 'utm_campaign', 'starts_with', 'summer'),
        rule(SUMMER, 'utm_campaign', 'equals', 'summer-sale'),
      ];

      expect(match({ utmCampaign: 'summer-sale' }, rules)).toBe(SUMMER);
    });

    it('breaks a remaining tie by campaign creation time, oldest first', () => {
      const older = rule(
        SUMMER,
        'utm_source',
        'equals',
        'instagram',
        new Date('2026-01-01T00:00:00Z'),
      );
      const newer = rule(
        SPRING,
        'utm_medium',
        'equals',
        'paid-social',
        new Date('2026-06-01T00:00:00Z'),
      );
      const tuple = { utmSource: 'instagram', utmMedium: 'paid-social' };

      expect(match(tuple, [older, newer])).toBe(SUMMER);
      expect(match(tuple, [newer, older])).toBe(SUMMER);
    });

    it('resolves the same tuple the same way whatever order the rules arrive in', () => {
      // A report must not depend on how the database happened to return rows:
      // the same order placed last month has to keep reporting where it did.
      const sameInstant = new Date('2026-01-01T00:00:00Z');
      const rules = [
        rule(SPRING, 'utm_source', 'equals', 'instagram', sameInstant),
        rule(SUMMER, 'utm_medium', 'equals', 'paid-social', sameInstant),
        rule(SPRING, 'utm_campaign', 'starts_with', 'summer', sameInstant),
        rule(SUMMER, 'utm_campaign', 'starts_with', 'summer-s', sameInstant),
      ];
      const tuple = {
        utmCampaign: 'summer-sale',
        utmSource: 'instagram',
        utmMedium: 'paid-social',
      };

      const expected = match(tuple, rules);
      expect(expected).not.toBeNull();
      for (const shuffled of permutations(rules)) {
        expect(match(tuple, shuffled)).toBe(expected);
      }
    });
  });

  describe('unattributed', () => {
    const rules = [rule(SUMMER, 'utm_campaign', 'equals', 'summer-sale')];

    it('resolves a tuple that matches no rule to Unattributed', () => {
      expect(match({ utmCampaign: 'winter-sale' }, rules)).toBeNull();
    });

    it('resolves an empty rule set to Unattributed rather than erroring', () => {
      expect(match({ utmCampaign: 'summer-sale' }, [])).toBeNull();
    });

    it('resolves a tuple carrying no evidence to Unattributed', () => {
      expect(match({}, rules)).toBeNull();
      expect(
        match(
          { utmCampaign: null, utmSource: null, utmMedium: '', referrer: null },
          rules,
        ),
      ).toBeNull();
    });

    it('never lets an empty value match an empty rule value', () => {
      // Both sides normalize to nothing, and nothing must not equal nothing —
      // otherwise every untagged visit in the store would land on one campaign.
      expect(
        match({ utmCampaign: '   ' }, [
          rule(SUMMER, 'utm_campaign', 'equals', '---'),
        ]),
      ).toBeNull();
    });

    it('ignores an unmatchable rule instead of letting it shadow a real one', () => {
      expect(
        match({ utmCampaign: 'summer-sale' }, [
          rule(SPRING, 'utm_campaign', 'starts_with', '  '),
          rule(SUMMER, 'utm_campaign', 'equals', 'summer-sale'),
        ]),
      ).toBe(SUMMER);
    });

    it('does not match a referrer it cannot read a host from', () => {
      expect(
        match({ referrer: 'not a url' }, [
          rule(SUMMER, 'referrer_host', 'equals', 'instagram.com'),
        ]),
      ).toBeNull();
    });
  });

  it('reports which rule claimed the tuple, not only which campaign', () => {
    const claiming = rule(SUMMER, 'utm_campaign', 'equals', 'summer-sale');
    const matcher = createCampaignMatcher([
      rule(SPRING, 'utm_source', 'equals', 'instagram'),
      claiming,
    ]);

    expect(
      matcher({ utmCampaign: 'Summer_Sale', utmSource: 'instagram' }),
    ).toEqual({ campaignId: SUMMER, rule: claiming });
  });
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}
