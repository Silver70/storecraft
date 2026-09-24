import type { ConfigService } from '@nestjs/config';
import type { FetchAdTreeInput } from '../interfaces/ad-platform-provider.interface';
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
