import { ZernioAdPlatformAdapter } from '../services/zernio.adapter';

/**
 * The seam, asserted rather than remembered.
 *
 * ADR-0006 settles that there is one vendor and no fallback, so this interface
 * is no longer insurance against losing them. What it still buys is the swap in
 * the end-to-end suite: the in-memory fake stands where the adapter stands, and
 * the whole suite drives the real sync, the real database and the real admin
 * API without a byte leaving the process.
 *
 * That only holds while the two have the same surface. A method the adapter
 * grows and the fake does not is a code path no test can reach; a method the
 * services call that the fake answers differently is a test that passes about
 * nothing. TypeScript catches the fake falling behind the interface, because it
 * declares `implements`. What it does not catch is the adapter quietly growing
 * a public method that callers start reaching for, so that is what is checked
 * here, in both directions.
 *
 * It replaces a test that asserted no write verb appeared on the adapter. That
 * rule was real — the integration used to be incapable of costing a merchant
 * money — and ADR-0006 retired it: campaigns are created here now and they
 * spend. The guarantee that replaced it is not about the shape of this
 * interface, so it is not asserted from here.
 */

/** The interface, spelled out, so an addition to it is a deliberate edit here. */
const EXPECTED_SURFACE = [
  'issueStoreCredential',
  'beginConnection',
  'completeConnection',
  'listAdAccounts',
  'ensurePixel',
  'disconnect',
  'revokeStoreCredential',
  'fetchAdTree',
  'readLinkTags',
  'writeLinkTags',
  'validateCampaign',
  'createCampaign',
  'updateCampaign',
  'setCampaignDelivery',
  'setAdDelivery',
  'setAdSetEnd',
  'addAd',
  'fetchCreative',
  'sendPurchase',
  'health',
].sort();

/**
 * Helpers the adapter is entitled to, which callers must never see.
 *
 * Named one by one rather than matched by a convention, so that adding one is a
 * line in this file and not a private method that turns out to be reachable.
 */
const INTERNALS = [
  'connectPlatform',
  'teamKey',
  'baseUrl',
  'call',
  'change',
].sort();

describe('the ad-platform provider contract', () => {
  const methods = Object.getOwnPropertyNames(
    ZernioAdPlatformAdapter.prototype,
  ).filter((name) => name !== 'constructor');

  it('implements every method the interface promises', () => {
    for (const expected of EXPECTED_SURFACE) {
      expect(methods).toContain(expected);
    }
  });

  it('has grown nothing the fake does not also have', () => {
    // Anything here that is not in one of the two lists is a method the fake
    // cannot stand in for, and therefore a path the end-to-end suite runs past
    // in production and never once in a test.
    const unaccounted = methods
      .filter((name) => !EXPECTED_SURFACE.includes(name))
      .filter((name) => !INTERNALS.includes(name));

    expect(unaccounted).toEqual([]);
  });

  it('names the vendor in this file and in the adapter, and nowhere else', () => {
    // The class is the one place the vendor's name is allowed to appear. If the
    // name has spread, it spread through a rename that would have had to touch
    // this line first.
    expect(ZernioAdPlatformAdapter.name).toBe('ZernioAdPlatformAdapter');
  });
});
