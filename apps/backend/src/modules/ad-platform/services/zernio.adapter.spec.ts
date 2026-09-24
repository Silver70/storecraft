import type { ConfigService } from '@nestjs/config';
import {
  CampaignRejectedError,
  CreateInFlightError,
  type CampaignDraft,
  type CampaignDraftInput,
  type CreateCampaignInput,
  type FetchAdTreeInput,
} from '../interfaces/ad-platform-provider.interface';
import { LINK_TAGS } from '../utils/link-tags.util';
import { ZernioAdPlatformAdapter } from './zernio.adapter';

/**
 * The adapter's reading of the tree, against the vendor's documented shape.
 *
 * Only the translation is under test here — what the adapter makes of a
 * payload. The network is a stubbed `fetch`, and each case is a payload a
 * real account can produce. The end-to-end suite covers everything above this
 * line with the fake provider; nothing else in the codebase ever sees these
 * field names, so nothing else would notice them being read wrongly.
 */

const config = {
  get: (key: string, fallback?: string) =>
    key === 'ZERNIO_API_URL' ? 'https://vendor.test/api' : fallback,
} as unknown as ConfigService;

const input: FetchAdTreeInput = {
  credential: { providerRef: 'prof_1', providerKeyRef: 'key_1', secret: 'sk' },
  platform: 'meta',
  providerAccountRef: 'acc_1',
  externalAccountId: 'act_1',
  from: '2026-09-01',
  to: '2026-09-24',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ZernioAdPlatformAdapter.fetchAdTree', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const adapter = () => new ZernioAdPlatformAdapter(config);

  it('reads campaigns, their ads across ad sets, and each ad’s days in minor units', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        campaigns: [
          {
            platformCampaignId: '1200',
            campaignName: 'Spring sale',
            currency: 'USD',
            status: 'active',
            reviewStatus: 'approved',
            platformCampaignStatus: 'ACTIVE',
            adSets: [
              {
                ads: [
                  {
                    _id: '65f0vendordoc',
                    platformAdId: '1201',
                    name: 'Reel',
                    status: 'active',
                    reviewStatus: 'approved',
                    creativeType: 'video',
                    creative: { thumbnailUrl: 'https://cdn.meta/thumb.jpg' },
                    schedule: { startDate: '2026-09-01T00:00:00Z' },
                    daily: [
                      {
                        date: '2026-09-23',
                        spend: 2.675,
                        impressions: 1000,
                        clicks: 90,
                        inlineLinkClicks: 12,
                      },
                    ],
                  },
                ],
              },
              {
                ads: [
                  {
                    platformAdId: '1202',
                    name: 'Still',
                    status: 'paused',
                    creativeType: 'image',
                    creative: { imageUrl: 'https://cdn.meta/full.jpg' },
                    schedule: {
                      startDate: '2026-08-15T00:00:00Z',
                      endDate: '2026-10-01T00:00:00Z',
                    },
                    daily: [],
                  },
                ],
              },
            ],
          },
        ],
        pagination: { page: 1, pages: 1 },
      }),
    );

    const tree = await adapter().fetchAdTree(input);

    expect(tree.currency).toBe('USD');
    expect(tree.complete).toBe(true);
    expect(tree.campaigns).toHaveLength(1);
    const [campaign] = tree.campaigns;
    expect(campaign).toMatchObject({
      externalCampaignId: '1200',
      name: 'Spring sale',
      signals: {
        delivery: 'active',
        review: 'approved',
        // The earliest start among its ads, and open-ended because one ad is.
        startsAt: new Date('2026-08-15T00:00:00Z'),
        endsAt: null,
      },
    });

    const [reel, still] = campaign.ads;
    // Meta's own ad id, never the vendor's document id.
    expect(reel.externalAdId).toBe('1201');
    expect(reel.format).toBe('video');
    expect(reel.creativeUrl).toBe('https://cdn.meta/thumb.jpg');
    // 2.675 is 267.49999… as a double; the rounding rule keeps the cent.
    expect(reel.days).toEqual([
      { day: '2026-09-23', spend: 268, impressions: 1000, clicks: 12 },
    ]);
    expect(still).toMatchObject({
      externalAdId: '1202',
      format: 'image',
      creativeUrl: 'https://cdn.meta/full.jpg',
      signals: { delivery: 'paused', review: null },
    });
  });

  it('stores link clicks, never Meta’s clicks (all)', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        campaigns: [
          {
            platformCampaignId: '1',
            adSets: [
              {
                ads: [
                  {
                    platformAdId: 'a',
                    daily: [
                      { date: '2026-09-20', clicks: 400, inlineLinkClicks: 25 },
                      {
                        date: '2026-09-21',
                        clicks: 400,
                        actions: { link_click: 31, post_reaction: 200 },
                      },
                      { date: '2026-09-22', clicks: 400 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const tree = await adapter().fetchAdTree(input);

    expect(tree.campaigns[0].ads[0].days.map((d) => d.clicks)).toEqual([
      25, 31, 0,
    ]);
  });

  it('reads a deleted campaign as deleted, whatever its ads last said', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        campaigns: [
          {
            platformCampaignId: '1',
            status: 'active',
            platformCampaignStatus: 'DELETED',
            adSets: [{ ads: [{ platformAdId: 'a', status: 'cancelled' }] }],
          },
          {
            platformCampaignId: '2',
            status: 'active',
            platformCampaignStatus: 'PAUSED',
            adSets: [],
          },
        ],
      }),
    );

    const tree = await adapter().fetchAdTree(input);

    expect(tree.campaigns.map((c) => c.signals.delivery)).toEqual([
      'deleted',
      'paused',
    ]);
    expect(tree.campaigns[0].ads[0].signals.delivery).toBe('deleted');
  });

  it('reads an unrecognised delivery status as needing a look, not as fine', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        campaigns: [
          {
            platformCampaignId: '1',
            status: 'something_new',
            adSets: [{ ads: [{ platformAdId: 'a', status: 'mystery' }] }],
          },
        ],
      }),
    );

    const tree = await adapter().fetchAdTree(input);

    expect(tree.campaigns[0].signals.delivery).toBe('error');
    expect(tree.campaigns[0].ads[0].signals.delivery).toBe('error');
  });

  it('reads every page of campaigns', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          campaigns: [{ platformCampaignId: '1', adSets: [] }],
          pagination: { page: 1, pages: 2 },
        }),
      )
      .mockResolvedValueOnce(
        json({
          campaigns: [{ platformCampaignId: '2', adSets: [] }],
          pagination: { page: 2, pages: 2 },
        }),
      );

    const tree = await adapter().fetchAdTree(input);

    expect(tree.campaigns.map((c) => c.externalCampaignId)).toEqual(['1', '2']);
    const urls = (fetchMock.mock.calls as [URL][]).map(([url]) => url);
    const pages = urls.map((url) => new URL(url).searchParams.get('page'));
    expect(pages).toEqual(['1', '2']);
    const first = new URL(urls[0]);
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      accountId: 'acc_1',
      adAccountId: 'act_1',
      fromDate: '2026-09-01',
      toDate: '2026-09-24',
      source: 'all',
      timeIncrement: '1',
      dailyLevel: 'ad',
    });
  });

  it('reports the tree incomplete while the platform is still gathering history', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          campaigns: [{ platformCampaignId: '1', adSets: [] }],
          backfillPending: true,
        },
        202,
      ),
    );

    const tree = await adapter().fetchAdTree(input);

    expect(tree.complete).toBe(false);
    expect(tree.campaigns).toHaveLength(1);
  });

  it('leaves out nodes and ads with no platform id to join a click to', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        campaigns: [
          { campaignName: 'Ungrouped', adSets: [{ ads: [{ _id: 'x' }] }] },
          {
            platformCampaignId: '1',
            adSets: [{ ads: [{ _id: 'vendor-only' }, { platformAdId: 'a' }] }],
          },
        ],
      }),
    );

    const tree = await adapter().fetchAdTree(input);

    expect(tree.campaigns).toHaveLength(1);
    expect(tree.campaigns[0].ads.map((a) => a.externalAdId)).toEqual(['a']);
  });

  it('refuses a figure it cannot read rather than writing zero', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        campaigns: [
          {
            platformCampaignId: '1',
            adSets: [
              {
                ads: [
                  {
                    platformAdId: 'a',
                    daily: [{ date: '2026-09-20', spend: 'NaN' as unknown }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    await expect(adapter().fetchAdTree(input)).rejects.toThrow(RangeError);
  });
});

describe('ZernioAdPlatformAdapter.readLinkTags', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns the stored url tags, and null for an ad with none to read', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(json({ urlTags: 'utm_campaign={{campaign.id}}' }))
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({}, 405));

    const adapter = new ZernioAdPlatformAdapter(config);
    const read = (externalAdId: string) =>
      adapter.readLinkTags({ ...input, externalAdId });

    await expect(read('1')).resolves.toBe('utm_campaign={{campaign.id}}');
    await expect(read('2')).resolves.toBeNull();
    await expect(read('3')).resolves.toBeNull();
  });
});

describe('ZernioAdPlatformAdapter.writeLinkTags', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const tags = [
    { key: 'ref', value: 'two words' },
    { key: 'utm_campaign', value: '{{campaign.id}}' },
    { key: 'utm_content', value: '{{ad.id}}' },
  ];
  const write = (externalAdId = '1201') =>
    new ZernioAdPlatformAdapter(config).writeLinkTags({
      ...input,
      externalAdId,
      tags,
    });

  it('sends the tags alone, never a creative to rebuild from', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        platform: 'facebook',
        urlTags:
          'ref=two%20words&utm_campaign={{campaign.id}}&utm_content={{ad.id}}',
      }),
    );

    await expect(write()).resolves.toEqual({ outcome: 'written' });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      'https://vendor.test/api/v1/ads/1201/tracking-tags',
    );
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ urlTags: tags });
  });

  it.each([
    [422, 'cannot_rebuild'],
    [404, 'not_found'],
    [405, 'unsupported'],
  ])('reports a %i as a refusal about this ad', async (status, reason) => {
    fetchMock.mockResolvedValueOnce(json({ error: 'no' }, status));
    await expect(write()).resolves.toEqual({ outcome: 'refused', reason });
  });

  it('reports a success whose tags lack the join as not applied', async () => {
    fetchMock.mockResolvedValueOnce(json({ urlTags: 'ref=two%20words' }));
    await expect(write()).resolves.toEqual({
      outcome: 'refused',
      reason: 'not_applied',
    });
  });

  it.each([429, 403, 500, 502])(
    'throws on a %i, which says nothing about the ad',
    async (status) => {
      fetchMock.mockResolvedValueOnce(json({}, status));
      await expect(write()).rejects.toThrow();
    },
  );

  it('throws when the vendor cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(write()).rejects.toThrow();
  });
});

describe('ZernioAdPlatformAdapter.fetchCreative', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends no credential to the image host', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      new Response(Buffer.from('jpeg-bytes'), {
        headers: { 'content-type': 'image/jpeg; charset=binary' },
      }),
    );
    global.fetch = fetchMock;

    const file = await new ZernioAdPlatformAdapter(config).fetchCreative(
      'https://cdn.meta/x.jpg',
    );

    expect(file.contentType).toBe('image/jpeg');
    expect(file.body.toString()).toBe('jpeg-bytes');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.meta/x.jpg');
  });

  it('refuses something that is not an image', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      );

    await expect(
      new ZernioAdPlatformAdapter(config).fetchCreative('https://cdn.meta/x'),
    ).rejects.toThrow();
  });
});

describe('ZernioAdPlatformAdapter creating a campaign', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const draft: CampaignDraft = {
    name: 'Autumn sale',
    dailyBudget: 2550,
    currency: 'USD',
    startsAt: new Date('2026-10-01T04:00:00Z'),
    endsAt: null,
    countries: ['US', 'CA'],
    ageMin: 25,
    ageMax: 54,
    pixelId: 'px_1',
    linkTags: LINK_TAGS,
    launch: 'active',
    ads: [
      {
        name: 'Autumn sale · Ad 1',
        media: { kind: 'image', url: 'https://cdn.test/a.jpg' },
        primaryText: 'Warm coats, cold prices.',
        headline: 'Coats from $49',
        callToAction: 'shop_now',
        destinationUrl: 'https://shop.test/products/coat',
      },
      {
        name: 'Autumn sale · Ad 2',
        media: { kind: 'video', url: 'https://cdn.test/b.mp4' },
        primaryText: 'See them move.',
        headline: 'Coats in motion',
        callToAction: 'learn_more',
        destinationUrl: 'https://shop.test/products',
      },
    ],
  };
  const createInput: CreateCampaignInput = {
    credential: input.credential,
    platform: 'meta',
    providerAccountRef: 'acc_1',
    externalAccountId: 'act_1',
    draft,
    idempotencyKey: 'key-1',
  };
  const adapter = () => new ZernioAdPlatformAdapter(config);
  const sentBody = (call = 0) =>
    JSON.parse(
      (fetchMock.mock.calls[call] as [URL, RequestInit])[1].body as string,
    ) as Record<string, unknown>;

  it('sends every ad in one call, each carrying the link tags, with the key', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          platformCampaignId: '1202',
          ads: [
            {
              platformAdId: '1203',
              name: 'Autumn sale · Ad 1',
              status: 'pending_review',
              reviewStatus: 'in_review',
              creativeType: 'image',
            },
            {
              platformAdId: '1204',
              name: 'Autumn sale · Ad 2',
              status: 'pending_review',
              reviewStatus: 'in_review',
              creativeType: 'video',
            },
          ],
        },
        201,
      ),
    );

    const created = await adapter().createCampaign(createInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://vendor.test/api/v1/ads/create');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'key-1',
    );
    const body = sentBody();
    expect(body).toMatchObject({
      accountId: 'acc_1',
      adAccountId: 'act_1',
      goal: 'conversions',
      promotedObject: { pixelId: 'px_1', customEventType: 'PURCHASE' },
      budgetLevel: 'campaign',
      budgetType: 'daily',
      // Minor units in, whole units of the currency out.
      budgetAmount: 25.5,
      status: 'ACTIVE',
      countries: ['US', 'CA'],
      ageMin: 25,
      ageMax: 54,
      startDate: '2026-10-01T04:00:00.000Z',
      tracking: {
        pixelId: 'px_1',
        urlTags: [
          { key: 'utm_source', value: 'meta' },
          { key: 'utm_medium', value: 'paid' },
          { key: 'utm_campaign', value: '{{campaign.id}}' },
          { key: 'utm_content', value: '{{ad.id}}' },
        ],
      },
      creatives: [
        {
          name: 'Autumn sale · Ad 1',
          imageUrl: 'https://cdn.test/a.jpg',
          body: 'Warm coats, cold prices.',
          headline: 'Coats from $49',
          callToAction: 'SHOP_NOW',
          linkUrl: 'https://shop.test/products/coat',
        },
        {
          name: 'Autumn sale · Ad 2',
          video: { url: 'https://cdn.test/b.mp4' },
          callToAction: 'LEARN_MORE',
        },
      ],
    });
    // Nothing a merchant was told is fixed: placements and bidding are left out.
    expect(body).not.toHaveProperty('placements');
    expect(body).not.toHaveProperty('bidStrategy');
    expect(body).not.toHaveProperty('endDate');

    expect(created).toMatchObject({
      externalCampaignId: '1202',
      signals: { delivery: 'pending_review', review: 'in_review' },
      ads: [
        { externalAdId: '1203', format: 'image' },
        { externalAdId: '1204', format: 'video' },
      ],
    });
  });

  it('creates paused when asked, and reads the campaign as paused', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { platformCampaignId: '1202', ads: [{ platformAdId: '1203' }] },
        201,
      ),
    );

    const created = await adapter().createCampaign({
      ...createInput,
      draft: { ...draft, launch: 'paused' },
    });

    expect(sentBody().status).toBe('PAUSED');
    expect(created.signals.delivery).toBe('paused');
    expect(created.ads[0].signals.delivery).toBe('paused');
  });

  it('turns Meta’s refusal into complaints, placed by ad and field', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: 'Invalid parameter',
          type: 'platform_error',
          param: 'creatives[1].video',
          platformError: {
            error_user_title: 'Video too short',
            error_user_msg: 'Your video must be at least 1 second long.',
          },
        },
        400,
      ),
    );

    const error = await adapter()
      .createCampaign(createInput)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CampaignRejectedError);
    expect((error as CampaignRejectedError).complaints).toEqual([
      {
        adIndex: 1,
        field: 'media',
        message: 'Your video must be at least 1 second long.',
      },
    ]);
  });

  it('says a create with the same key is still in flight', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'in progress' }, 409));
    await expect(adapter().createCampaign(createInput)).rejects.toBeInstanceOf(
      CreateInFlightError,
    );
  });

  it('treats an unreachable vendor as a failure, not a refusal', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'bad gateway' }, 502));
    const error = await adapter()
      .createCampaign(createInput)
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(CampaignRejectedError);
    expect((error as Error).message).toMatch(/could not be reached/);
  });

  it('dry-runs each image ad on its own, and leaves video ads unchecked', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        validateOnly: true,
        results: [{ node: 'campaign', status: 'validated' }],
      }),
    );

    const check = await adapter().validateCampaign(createInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sentBody();
    expect(body).toMatchObject({
      validateOnly: true,
      adName: 'Autumn sale · Ad 1',
      imageUrl: 'https://cdn.test/a.jpg',
      budgetAmount: 25.5,
      tracking: { pixelId: 'px_1' },
    });
    expect(body).not.toHaveProperty('creatives');
    expect(check).toEqual({ complaints: [], unchecked: [1] });
  });

  it('reports a complaint every ad produced once, for the campaign', async () => {
    const twoImages: CampaignDraftInput = {
      ...createInput,
      draft: {
        ...draft,
        ads: [draft.ads[0], { ...draft.ads[0], name: 'Autumn sale · Ad 2' }],
      },
    };
    const budget = {
      error: 'Budget too low',
      type: 'platform_error',
      platformError: {
        error_user_msg: 'Your budget must be at least $1.00 a day.',
      },
    };
    const image = {
      error: 'Bad image',
      type: 'platform_error',
      param: 'imageUrl',
      platformError: { error_user_msg: 'The image is too small.' },
    };
    fetchMock
      .mockResolvedValueOnce(json(budget, 400))
      .mockResolvedValueOnce(json(budget, 400))
      .mockResolvedValueOnce(json(image, 400));

    // Only two calls are made; the third answer is never read.
    const check = await adapter().validateCampaign(twoImages);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(check.complaints).toEqual([
      {
        adIndex: null,
        field: null,
        message: 'Your budget must be at least $1.00 a day.',
      },
    ]);
  });

  it('places a creative complaint on the ad that caused it', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: 'Bad image',
          type: 'platform_error',
          param: 'imageUrl',
          platformError: { error_user_msg: 'The image is too small.' },
        },
        400,
      ),
    );

    const check = await adapter().validateCampaign(createInput);

    expect(check.complaints).toEqual([
      { adIndex: 0, field: 'media', message: 'The image is too small.' },
    ]);
  });
});
