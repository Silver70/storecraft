import {
  AD_ID_MACRO,
  CAMPAIGN_ID_MACRO,
  buildLinkTags,
  carriesOurLinkTags,
  mergeLinkTags,
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

describe('mergeLinkTags', () => {
  const asString = (tags: { key: string; value: string }[]) =>
    tags.map(({ key, value }) => `${key}=${value}`).join('&');

  it('writes our four tags onto an ad that has none', () => {
    expect(asString(mergeLinkTags(null))).toBe(buildLinkTags());
    expect(asString(mergeLinkTags(''))).toBe(buildLinkTags());
  });

  it('keeps the merchant’s own parameters, in their order, and adds ours after', () => {
    expect(asString(mergeLinkTags('ref=spring&promo=10off'))).toBe(
      `ref=spring&promo=10off&${buildLinkTags()}`,
    );
  });

  it('replaces a hand-typed join with the macros, where it stood', () => {
    expect(
      asString(
        mergeLinkTags('utm_campaign=summer-sale&ref=a&utm_content=video-1'),
      ),
    ).toBe(
      `utm_campaign=${CAMPAIGN_ID_MACRO}&ref=a&utm_content=${AD_ID_MACRO}&utm_source=meta&utm_medium=paid`,
    );
  });

  it('leaves a source and medium the merchant chose', () => {
    const merged = mergeLinkTags('utm_source=facebook&utm_medium=cpc');
    expect(merged.find((t) => t.key === 'utm_source')?.value).toBe('facebook');
    expect(merged.find((t) => t.key === 'utm_medium')?.value).toBe('cpc');
    expect(carriesOurLinkTags(asString(merged))).toBe(true);
  });

  it('hands back values decoded, macros included, for the platform to encode', () => {
    expect(
      mergeLinkTags('?note=two%20words&placement=%7B%7Bplacement%7D%7D'),
    ).toEqual(
      expect.arrayContaining([
        { key: 'note', value: 'two words' },
        { key: 'placement', value: '{{placement}}' },
      ]),
    );
  });

  it('keeps one of a repeated key', () => {
    const merged = mergeLinkTags('ref=a&ref=b');
    expect(merged.filter((t) => t.key === 'ref')).toEqual([
      { key: 'ref', value: 'a' },
    ]);
  });

  it('is always recognised as ours afterwards', () => {
    for (const existing of [
      null,
      'ref=a',
      'utm_campaign=x',
      'utm_content=%7B%7Bad.id%7D%7D',
    ]) {
      expect(carriesOurLinkTags(asString(mergeLinkTags(existing)))).toBe(true);
    }
  });
});
