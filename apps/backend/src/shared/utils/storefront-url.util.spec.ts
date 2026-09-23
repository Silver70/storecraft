/**
 * The two Store settings that say where a storefront lives, and the links built
 * from them, as a pure unit.
 *
 * This is the module every ad destination passes through, and it fails quietly
 * in both directions: a link built from a half-typed address 404s at click
 * time, and a link pointing off the Store's own storefront loads fine while
 * carrying no measurement at all. So the assertions here are about the edges —
 * what is refused, and that the same intent typed four different ways resolves
 * to one URL. No database, no framework.
 */
import {
  DEFAULT_PRODUCT_PATH_PATTERN,
  StorefrontUrlError,
  allProductsPath,
  normalizeProductPathPattern,
  normalizeStorefrontUrl,
  productPath,
  resolveCustomPath,
  resolveStorefrontUrl,
  storefrontReadiness,
  type StorefrontSettings,
} from './storefront-url.util';

const STARTER: StorefrontSettings = {
  storefrontUrl: 'https://shop.example.com',
  productPathPattern: DEFAULT_PRODUCT_PATH_PATTERN,
};

/** A fork that moved its product route and serves from a subdirectory. */
const FORKED: StorefrontSettings = {
  storefrontUrl: 'https://example.com/store',
  productPathPattern: '/p/{slug}',
};

const UNSET: StorefrontSettings = {
  storefrontUrl: null,
  productPathPattern: null,
};

describe('normalizeStorefrontUrl', () => {
  it('accepts an absolute http and https address', () => {
    expect(normalizeStorefrontUrl('https://shop.example.com')).toBe(
      'https://shop.example.com',
    );
    expect(normalizeStorefrontUrl('http://localhost:5173')).toBe(
      'http://localhost:5173',
    );
  });

  it('keeps a base path but drops its trailing slash', () => {
    expect(normalizeStorefrontUrl('https://example.com/store/')).toBe(
      'https://example.com/store',
    );
    expect(normalizeStorefrontUrl('https://example.com/')).toBe(
      'https://example.com',
    );
  });

  it('refuses an address that is not absolute', () => {
    expect(() => normalizeStorefrontUrl('shop.example.com')).toThrow(
      StorefrontUrlError,
    );
    expect(() => normalizeStorefrontUrl('/products')).toThrow(
      StorefrontUrlError,
    );
  });

  it('refuses a scheme that is not the web', () => {
    expect(() => normalizeStorefrontUrl('ftp://shop.example.com')).toThrow(
      /http:\/\/ or https:\/\//,
    );
  });

  it('refuses a query string, because ad links append their own', () => {
    expect(() =>
      normalizeStorefrontUrl('https://shop.example.com?ref=old'),
    ).toThrow(/query string/);
  });

  it('refuses a fragment, because it never reaches the server', () => {
    expect(() =>
      normalizeStorefrontUrl('https://shop.example.com/#top'),
    ).toThrow(/fragment/);
  });

  it('refuses an empty value', () => {
    expect(() => normalizeStorefrontUrl('   ')).toThrow(StorefrontUrlError);
  });
});

describe('normalizeProductPathPattern', () => {
  it('requires the slug placeholder', () => {
    expect(() => normalizeProductPathPattern('/products')).toThrow(/\{slug\}/);
  });

  it('accepts a pattern that carries it, in any shape', () => {
    expect(normalizeProductPathPattern('/products/{slug}')).toBe(
      '/products/{slug}',
    );
    expect(normalizeProductPathPattern('products/{slug}')).toBe(
      '/products/{slug}',
    );
    expect(normalizeProductPathPattern('/products/{slug}/')).toBe(
      '/products/{slug}',
    );
    expect(normalizeProductPathPattern('  /shop/item-{slug}  ')).toBe(
      '/shop/item-{slug}',
    );
  });

  it('refuses a full URL, because this is a path on the storefront', () => {
    expect(() =>
      normalizeProductPathPattern('https://shop.example.com/products/{slug}'),
    ).toThrow(/not a full URL/);
  });

  it('refuses a query string or a fragment', () => {
    expect(() => normalizeProductPathPattern('/products/{slug}?v=1')).toThrow(
      /query string/,
    );
    expect(() => normalizeProductPathPattern('/products/{slug}#buy')).toThrow(
      /query string/,
    );
  });
});

describe('resolveStorefrontUrl', () => {
  it('builds a product URL from the pattern', () => {
    expect(
      resolveStorefrontUrl(STARTER, { kind: 'product', slug: 'linen-shirt' }),
    ).toBe('https://shop.example.com/products/linen-shirt');
  });

  it('honours a fork that moved its route and sits in a subdirectory', () => {
    expect(
      resolveStorefrontUrl(FORKED, { kind: 'product', slug: 'linen-shirt' }),
    ).toBe('https://example.com/store/p/linen-shirt');
  });

  it('falls back to the Starter Storefront pattern when none is set', () => {
    expect(
      resolveStorefrontUrl(
        { storefrontUrl: 'https://shop.example.com', productPathPattern: null },
        { kind: 'product', slug: 'linen-shirt' },
      ),
    ).toBe('https://shop.example.com/products/linen-shirt');
  });

  it('builds the all-products page from the product pattern', () => {
    expect(resolveStorefrontUrl(STARTER, { kind: 'all_products' })).toBe(
      'https://shop.example.com/products',
    );
    expect(resolveStorefrontUrl(FORKED, { kind: 'all_products' })).toBe(
      'https://example.com/store/p',
    );
  });

  it('builds the home page', () => {
    expect(resolveStorefrontUrl(STARTER, { kind: 'home' })).toBe(
      'https://shop.example.com/',
    );
    expect(resolveStorefrontUrl(FORKED, { kind: 'home' })).toBe(
      'https://example.com/store/',
    );
  });

  it('reads the home page as the listing when products sit at the root', () => {
    const rootPattern: StorefrontSettings = {
      storefrontUrl: 'https://shop.example.com',
      productPathPattern: '/{slug}',
    };
    expect(allProductsPath(rootPattern)).toBe('/');
    expect(resolveStorefrontUrl(rootPattern, { kind: 'all_products' })).toBe(
      'https://shop.example.com/',
    );
  });

  it('refuses to build anything while the storefront URL is unset', () => {
    expect(() => resolveStorefrontUrl(UNSET, { kind: 'home' })).toThrow(
      /no storefront URL set/,
    );
    expect(() =>
      resolveStorefrontUrl(UNSET, { kind: 'product', slug: 'linen-shirt' }),
    ).toThrow(StorefrontUrlError);
  });

  it('refuses a product with no slug rather than linking to the listing', () => {
    expect(() =>
      resolveStorefrontUrl(STARTER, { kind: 'product', slug: '  ' }),
    ).toThrow(StorefrontUrlError);
  });

  it('escapes a slug so it cannot open a second path segment', () => {
    expect(productPath(STARTER, 'a/b')).toBe('/products/a%2Fb');
  });
});

describe('resolved URLs are stable under trailing slashes', () => {
  // The same storefront and the same route, typed four ways.
  const variants: StorefrontSettings[] = [
    {
      storefrontUrl: 'https://shop.example.com',
      productPathPattern: '/products/{slug}',
    },
    {
      storefrontUrl: 'https://shop.example.com/',
      productPathPattern: '/products/{slug}',
    },
    {
      storefrontUrl: 'https://shop.example.com',
      productPathPattern: '/products/{slug}/',
    },
    {
      storefrontUrl: 'https://shop.example.com/',
      productPathPattern: 'products/{slug}/',
    },
  ];

  it('resolves every destination identically', () => {
    for (const settings of variants) {
      expect(
        resolveStorefrontUrl(settings, {
          kind: 'product',
          slug: 'linen-shirt',
        }),
      ).toBe('https://shop.example.com/products/linen-shirt');
      expect(resolveStorefrontUrl(settings, { kind: 'all_products' })).toBe(
        'https://shop.example.com/products',
      );
      expect(resolveStorefrontUrl(settings, { kind: 'home' })).toBe(
        'https://shop.example.com/',
      );
      expect(
        resolveStorefrontUrl(settings, { kind: 'custom', path: 'sale' }),
      ).toBe('https://shop.example.com/sale');
    }
  });
});

describe('resolveCustomPath', () => {
  it('takes a relative path onto the storefront', () => {
    expect(resolveCustomPath(STARTER, '/summer-sale')).toBe(
      'https://shop.example.com/summer-sale',
    );
    expect(resolveCustomPath(STARTER, 'summer-sale')).toBe(
      'https://shop.example.com/summer-sale',
    );
    expect(resolveCustomPath(STARTER, '/summer-sale?tier=vip')).toBe(
      'https://shop.example.com/summer-sale?tier=vip',
    );
  });

  it('puts a relative path under the storefront base path', () => {
    expect(resolveCustomPath(FORKED, '/summer-sale')).toBe(
      'https://example.com/store/summer-sale',
    );
  });

  it('accepts an absolute URL that is already on the storefront', () => {
    expect(
      resolveCustomPath(STARTER, 'https://shop.example.com/summer-sale'),
    ).toBe('https://shop.example.com/summer-sale');
  });

  it('refuses another origin, and says why', () => {
    expect(() =>
      resolveCustomPath(STARTER, 'https://facebook.com/my-page'),
    ).toThrow(/your own storefront/);
    expect(() =>
      resolveCustomPath(STARTER, 'https://facebook.com/my-page'),
    ).toThrow(/measure/);
  });

  it('refuses a lookalike host', () => {
    expect(() =>
      resolveCustomPath(STARTER, 'https://shop.example.com.evil.test/sale'),
    ).toThrow(/your own storefront/);
  });

  it('refuses a different scheme on the same host', () => {
    expect(() =>
      resolveCustomPath(STARTER, 'http://shop.example.com/sale'),
    ).toThrow(/your own storefront/);
  });

  it('refuses a path outside the storefront base path', () => {
    expect(() =>
      resolveCustomPath(FORKED, 'https://example.com/blog/post'),
    ).toThrow(/outside it/);
    // A sibling directory sharing the base as a prefix is still outside it.
    expect(() =>
      resolveCustomPath(FORKED, 'https://example.com/storefront-demo'),
    ).toThrow(/outside it/);
  });

  it('refuses an empty destination', () => {
    expect(() => resolveCustomPath(STARTER, '  ')).toThrow(StorefrontUrlError);
  });
});

describe('storefrontReadiness', () => {
  it('reports what is missing while the storefront URL is unset', () => {
    expect(storefrontReadiness(UNSET)).toEqual({
      canBuildLinks: false,
      missing: ['storefrontUrl'],
    });
  });

  it('is ready on the storefront URL alone, since the pattern has a default', () => {
    expect(
      storefrontReadiness({
        storefrontUrl: 'https://shop.example.com',
        productPathPattern: null,
      }),
    ).toEqual({ canBuildLinks: true, missing: [] });
  });
});
