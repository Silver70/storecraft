import { UnconfiguredAdPlatformAdapter } from '../services/unconfigured-ad-platform.adapter';

/**
 * The mirror-only rule, asserted rather than remembered.
 *
 * Connecting this integration is supposed to be incapable of costing a merchant
 * money: nothing in it may create, boost, edit, pause or budget an ad. That is
 * enforced by the absence of a method, which is exactly the kind of guarantee
 * that erodes quietly — a future reader adds "just a pause toggle" to the
 * adapter, and the interface follows a week later.
 *
 * So the check is on the adapter's own surface, including the private helpers,
 * and it fails the moment a write verb appears anywhere on it.
 *
 * It runs against whichever adapter is bound to the seam. Right now that is the
 * one that refuses everything, which is a thin thing to assert against — but the
 * assertion is about the shape, and the shape is what the next adapter has to
 * arrive matching.
 */
const WRITE_VERBS =
  /(create|boost|edit|update|pause|unpause|resume|activate|budget|bid|spend|publish|schedule|launch|delete|archive)/i;

/** The interface, spelled out, so an addition to it is a deliberate edit here. */
const EXPECTED_SURFACE = [
  'issueStoreCredential',
  'beginConnection',
  'completeConnection',
  'disconnect',
  'revokeStoreCredential',
  'fetchAdTree',
  'health',
];

describe('the ad-platform provider contract', () => {
  const methods = Object.getOwnPropertyNames(
    UnconfiguredAdPlatformAdapter.prototype,
  ).filter((name) => name !== 'constructor');

  it('implements exactly the interface, and nothing has quietly grown on it', () => {
    for (const expected of EXPECTED_SURFACE) {
      expect(methods).toContain(expected);
    }
  });

  it('has no method that could create, boost, edit, pause or budget an ad', () => {
    // `issueStoreCredential` and `revokeStoreCredential` write at the provider,
    // and `fetchAdTree` reads one, but nothing here writes to an ad — which is
    // the promise being kept.
    expect(methods.filter((name) => WRITE_VERBS.test(name))).toEqual([]);
  });
});
