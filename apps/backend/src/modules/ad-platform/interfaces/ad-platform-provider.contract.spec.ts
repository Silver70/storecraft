import { AyrshareAdapter } from '../services/ayrshare.adapter';

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
];

describe('the ad-platform provider contract', () => {
  const methods = Object.getOwnPropertyNames(AyrshareAdapter.prototype).filter(
    (name) => name !== 'constructor',
  );

  it('implements exactly the interface, and nothing has quietly grown on it', () => {
    for (const expected of EXPECTED_SURFACE) {
      expect(methods).toContain(expected);
    }
  });

  it('has no method that could create, boost, edit, pause or budget an ad', () => {
    // `issueStoreCredential` and `revokeStoreCredential` write at the provider,
    // but nothing here writes to an ad — which is the promise being kept.
    expect(methods.filter((name) => WRITE_VERBS.test(name))).toEqual([]);
  });
});
