import {
  CAMPAIGN_TAG_FALLBACK,
  campaignTagCandidate,
  deriveCampaignTag,
} from './campaign-tag.util';
import { CAMPAIGN_LIMITS } from '../../../shared/database/schema';

describe('deriveCampaignTag', () => {
  it('slugifies a name into a tag that is safe in a URL', () => {
    expect(deriveCampaignTag('Summer Sale 2026')).toBe('summer-sale-2026');
  });

  it('maps underscores to the canonical separator rather than dropping them', () => {
    // A merchant who names a campaign this way and hand-tags a link
    // `utm_campaign=summer_sale` has to land on the same campaign the generated
    // link does. Dropping the underscore would give `summersale` and silently
    // split their revenue in two.
    expect(deriveCampaignTag('Summer_Sale')).toBe('summer-sale');
  });

  it('collapses any run of separators and punctuation to one hyphen', () => {
    expect(deriveCampaignTag('  Black   Friday --- 50% off!!  ')).toBe(
      'black-friday-50-off',
    );
  });

  it('folds accents so one campaign does not become two', () => {
    expect(deriveCampaignTag('Été Promo')).toBe(deriveCampaignTag('Ete Promo'));
  });

  it('never leaves a leading or trailing separator', () => {
    expect(deriveCampaignTag('—Spring—')).toBe('spring');
  });

  it('falls back to a usable tag when a name slugifies to nothing', () => {
    expect(deriveCampaignTag('🎉🎉🎉')).toBe(CAMPAIGN_TAG_FALLBACK);
    expect(deriveCampaignTag('   ')).toBe(CAMPAIGN_TAG_FALLBACK);
  });

  it('truncates a long name to the column width instead of failing the write', () => {
    const tag = deriveCampaignTag('a'.repeat(CAMPAIGN_LIMITS.tag + 50));
    expect(tag).toHaveLength(CAMPAIGN_LIMITS.tag);
  });
});

describe('campaignTagCandidate', () => {
  it('returns the base unchanged for the first attempt', () => {
    expect(campaignTagCandidate('summer-sale', 1)).toBe('summer-sale');
  });

  it('suffixes later attempts so a duplicate name stays distinguishable', () => {
    expect(campaignTagCandidate('summer-sale', 2)).toBe('summer-sale-2');
    expect(campaignTagCandidate('summer-sale', 3)).toBe('summer-sale-3');
  });

  it('shortens the base, never the suffix, to stay inside the column', () => {
    const candidate = campaignTagCandidate('a'.repeat(CAMPAIGN_LIMITS.tag), 12);
    expect(candidate.length).toBeLessThanOrEqual(CAMPAIGN_LIMITS.tag);
    expect(candidate.endsWith('-12')).toBe(true);
  });
});
