import { buildTaggedLink, resolveDestination } from './tagged-link.util';
import { createCampaignMatcher } from './campaign-matching.util';

const BASE = 'https://shop.example.test';

/** The inputs a merchant supplies, minus whatever a case is about. */
const input = (overrides: Partial<Parameters<typeof buildTaggedLink>[0]>) => ({
  baseUrl: BASE,
  destination: '/',
  campaignTag: 'summer-sale',
  source: 'instagram',
  medium: 'paid_social',
  ...overrides,
});

/** The link, or a failure the assertion will show rather than hide. */
function link(overrides: Partial<Parameters<typeof buildTaggedLink>[0]> = {}) {
  const result = buildTaggedLink(input(overrides));
  if (!result.ok) throw new Error(`expected a link, got: ${result.problem}`);
  return result.link;
}

const paramsOf = (url: string) => new URL(url).searchParams;

describe('buildTaggedLink', () => {
  it('composes a complete link from the campaign tag, source and medium', () => {
    const params = paramsOf(link().url);

    expect(params.get('utm_campaign')).toBe('summer-sale');
    expect(params.get('utm_source')).toBe('instagram');
    expect(params.get('utm_medium')).toBe('paid-social');
  });

  it('carries the campaign tag exactly as the campaign holds it', () => {
    // The canonical rule stores the tag this way too. Emitting anything else
    // here — even a tidier spelling — is how a generated link and the rule that
    // claims it drift apart.
    const params = paramsOf(link({ campaignTag: 'summer-sale-2026' }).url);

    expect(params.get('utm_campaign')).toBe('summer-sale-2026');
  });

  it('emits source and medium in the form matching reduces them to', () => {
    const params = paramsOf(
      link({ source: '  Paid Social  ', medium: 'Cost_Per_Click' }).url,
    );

    expect(params.get('utm_source')).toBe('paid-social');
    expect(params.get('utm_medium')).toBe('cost-per-click');
  });

  it('includes utm_content only when the merchant supplied one', () => {
    expect(paramsOf(link().url).has('utm_content')).toBe(false);
    expect(paramsOf(link({ content: '' }).url).has('utm_content')).toBe(false);
    expect(paramsOf(link({ content: 'Video A' }).url).get('utm_content')).toBe(
      'video-a',
    );
  });

  // ─── The destination ────────────────────────────────────────────────────────

  it('points at the home page of the store by default', () => {
    expect(link().url.startsWith(`${BASE}/?`)).toBe(true);
  });

  it('points at any page of the store, not only the home page', () => {
    const generated = link({ destination: '/products/summer-tee' });

    expect(new URL(generated.url).pathname).toBe('/products/summer-tee');
    expect(generated.destination).toBe(`${BASE}/products/summer-tee`);
  });

  it('accepts a destination path written without a leading slash', () => {
    expect(
      new URL(link({ destination: 'collections/sale' }).url).pathname,
    ).toBe('/collections/sale');
  });

  it('accepts a full URL, for a store on its own domain', () => {
    const generated = link({
      destination: 'https://store.other.test/products/tee',
    });

    expect(new URL(generated.url).host).toBe('store.other.test');
    expect(new URL(generated.url).pathname).toBe('/products/tee');
  });

  it("keeps the destination's own query parameters and fragment", () => {
    const generated = link({
      destination: '/products/tee?variant=large#reviews',
    });
    const url = new URL(generated.url);

    expect(url.searchParams.get('variant')).toBe('large');
    expect(url.hash).toBe('#reviews');
    expect(url.searchParams.get('utm_campaign')).toBe('summer-sale');
  });

  it('replaces utm parameters the destination already carried', () => {
    // Destinations get pasted back out of an ad platform still tagged for the
    // campaign that ran last. Appending would leave two utm_campaign values in
    // one URL and attribute to whichever the storefront read first.
    const generated = link({
      destination: '/?utm_campaign=last-year&utm_source=email&utm_content=old',
      content: 'video-a',
    });
    const params = paramsOf(generated.url);

    expect(params.getAll('utm_campaign')).toEqual(['summer-sale']);
    expect(params.getAll('utm_source')).toEqual(['instagram']);
    expect(params.getAll('utm_content')).toEqual(['video-a']);
  });

  it('drops a utm_content the destination carried when none was chosen', () => {
    const generated = link({ destination: '/?utm_content=old-creative' });

    expect(paramsOf(generated.url).has('utm_content')).toBe(false);
  });

  it('reports the destination it resolved, before any tagging', () => {
    expect(link({ destination: '/products/tee' }).destination).toBe(
      `${BASE}/products/tee`,
    );
  });

  // ─── Refusals ───────────────────────────────────────────────────────────────

  it('refuses a source or medium that could never identify anything', () => {
    expect(buildTaggedLink(input({ source: '   ' }))).toEqual({
      ok: false,
      problem: 'source',
    });
    expect(buildTaggedLink(input({ medium: '---' }))).toEqual({
      ok: false,
      problem: 'medium',
    });
  });

  it('refuses a utm_content that was typed but says nothing', () => {
    expect(buildTaggedLink(input({ content: '!!!' }))).toEqual({
      ok: false,
      problem: 'content',
    });
  });

  it('refuses a destination carrying a scheme that is not a web page', () => {
    for (const destination of [
      'javascript:alert(1)',
      'mailto:someone@example.test',
      'ftp://files.example.test/x',
    ]) {
      expect(buildTaggedLink(input({ destination }))).toEqual({
        ok: false,
        problem: 'destination',
      });
    }
  });

  it('treats a host-shaped destination as the path it literally is', () => {
    // `//evil.test/x` is a protocol-relative URL to another host. Resolving it
    // as one would let a typo retarget a campaign's traffic at a domain the
    // merchant does not own.
    const url = new URL(link({ destination: '//evil.test/landing' }).url);

    expect(url.host).toBe('shop.example.test');
    expect(url.pathname).toBe('/evil.test/landing');
  });

  it('refuses a campaign tag that could never match a visit', () => {
    expect(buildTaggedLink(input({ campaignTag: '   ' }))).toEqual({
      ok: false,
      problem: 'campaignTag',
    });
  });
});

describe('resolveDestination', () => {
  it('resolves a path against the storefront it belongs to', () => {
    expect(resolveDestination('/sale', BASE)?.toString()).toBe(`${BASE}/sale`);
  });

  it('returns null for a base URL that is not a URL at all', () => {
    expect(resolveDestination('/sale', 'not a url')).toBeNull();
  });
});

/**
 * The property the whole generator exists for: a link built from a campaign is
 * claimed by that campaign's own canonical rule, with nothing authored by hand.
 * Asserted here against the real matcher rather than only at the far end of a
 * checkout, because this is the pair that must never drift.
 */
describe('a generated link and the campaign that generated it', () => {
  const canonicalRule = (tag: string, campaignId = 'campaign-1') => ({
    campaignId,
    field: 'utm_campaign' as const,
    operator: 'equals' as const,
    value: tag,
    campaignCreatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const tupleFrom = (url: string) => {
    const params = new URL(url).searchParams;
    return {
      utmCampaign: params.get('utm_campaign'),
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
    };
  };

  it('matches with no rule authored by hand', () => {
    const match = createCampaignMatcher([canonicalRule('summer-sale')])(
      tupleFrom(link().url),
    );

    expect(match?.campaignId).toBe('campaign-1');
  });

  it('matches every link generated for it, whatever the source and medium', () => {
    const matcher = createCampaignMatcher([canonicalRule('summer-sale')]);

    const links = [
      link({ source: 'instagram', medium: 'paid_social' }),
      link({ source: 'facebook', medium: 'cpc' }),
      link({ source: 'newsletter', medium: 'email', destination: '/sale' }),
    ];

    expect(links.map((l) => matcher(tupleFrom(l.url))?.campaignId)).toEqual([
      'campaign-1',
      'campaign-1',
      'campaign-1',
    ]);
  });
});
