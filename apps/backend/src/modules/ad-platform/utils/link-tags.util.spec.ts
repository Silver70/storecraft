import {
  AD_ID_MACRO,
  CAMPAIGN_ID_MACRO,
  buildLinkTags,
  carriesOurLinkTags,
} from './link-tags.util';

describe('buildLinkTags', () => {
  it('writes the four tags with the platform macros unescaped', () => {
    expect(buildLinkTags()).toBe(
      'utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}',
    );
  });

  it('never percent-encodes the braces the platform has to expand', () => {
    expect(buildLinkTags()).not.toMatch(/%7B|%7D/i);
  });

  it('is recognised by the check the sync uses', () => {
    expect(carriesOurLinkTags(buildLinkTags())).toBe(true);
  });
});

describe('carriesOurLinkTags', () => {
  it.each([null, undefined, '', '   '])('is false for %p', (tags) => {
    expect(carriesOurLinkTags(tags)).toBe(false);
  });

  it('needs both join parameters', () => {
    expect(carriesOurLinkTags(`utm_campaign=${CAMPAIGN_ID_MACRO}`)).toBe(false);
    expect(carriesOurLinkTags(`utm_content=${AD_ID_MACRO}`)).toBe(false);
  });

  it('does not accept a hand-typed campaign name in place of the macro', () => {
    expect(
      carriesOurLinkTags('utm_campaign=summer-sale&utm_content={{ad.id}}'),
    ).toBe(false);
  });

  it('does not accept the macros swapped', () => {
    expect(
      carriesOurLinkTags('utm_campaign={{ad.id}}&utm_content={{campaign.id}}'),
    ).toBe(false);
  });

  it('accepts a merchant’s own source and extra parameters beside the join', () => {
    expect(
      carriesOurLinkTags(
        'utm_source=facebook&ref=spring&utm_campaign={{campaign.id}}&utm_content={{ad.id}}',
      ),
    ).toBe(true);
  });

  it('accepts percent-encoded braces and a leading question mark', () => {
    expect(
      carriesOurLinkTags(
        '?utm_campaign=%7B%7Bcampaign.id%7D%7D&utm_content=%7B%7Bad.id%7D%7D',
      ),
    ).toBe(true);
  });
});
