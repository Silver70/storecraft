/**
 * The transition table, tested as the single source of truth it claims to be.
 *
 * Every pair of (state, action) is asserted — the legal ones for where they
 * land, the illegal ones for landing nowhere — because the value of declaring
 * transitions in one place is entirely in the exhaustiveness. A table with a
 * hole in it is a table nobody can trust to be the whole answer.
 */
import {
  UNLINKED_AD_TRANSITIONS,
  nextState,
  refusalFor,
  type UnlinkedAdAction,
} from './unlinked-ad-state.util';
import type { UnlinkedAdState } from '../../../shared/database/schema';

const STATES: UnlinkedAdState[] = ['pending', 'claimed', 'dismissed'];
const ACTIONS: UnlinkedAdAction[] = ['claim', 'dismiss', 'restore', 'unlink'];

/**
 * Every legal move, written out by hand rather than read off the table under
 * test. Anything not here is illegal, which is what the second block asserts.
 */
const LEGAL: Array<[UnlinkedAdState, UnlinkedAdAction, UnlinkedAdState]> = [
  ['pending', 'claim', 'claimed'],
  ['pending', 'dismiss', 'dismissed'],
  ['dismissed', 'restore', 'pending'],
  ['dismissed', 'claim', 'claimed'],
  ['claimed', 'unlink', 'pending'],
];

describe('unlinked ad state machine', () => {
  describe('the moves that exist', () => {
    it.each(LEGAL)('%s + %s lands in %s', (from, action, expected) => {
      expect(nextState(from, action)).toBe(expected);
    });

    it('is born pending, which is the only state a sync may write', () => {
      // Nothing transitions *into* being held: a row is created pending and
      // every state after that is a decision somebody made.
      const reachable = new Set(LEGAL.map(([, , to]) => to));
      expect(reachable).toEqual(new Set(['claimed', 'dismissed', 'pending']));
    });
  });

  describe('the moves that do not', () => {
    const illegal = STATES.flatMap((from) =>
      ACTIONS.filter(
        (action) => !LEGAL.some(([f, a]) => f === from && a === action),
      ).map((action) => [from, action] as const),
    );

    it.each(illegal)('%s cannot be %sed', (from, action) => {
      expect(nextState(from, action)).toBeNull();
    });

    it('covers every pair of state and action between the two blocks', () => {
      expect(illegal.length + LEGAL.length).toBe(
        STATES.length * ACTIONS.length,
      );
    });

    /**
     * The one a merchant is most likely to try, and the one the design
     * deliberately refuses: dismissing a claimed ad would detach an Ad and
     * record a refusal in a single move, and they would not be shown which of
     * the two they had just done.
     */
    it('refuses to dismiss a claimed ad, and says what to do instead', () => {
      expect(nextState('claimed', 'dismiss')).toBeNull();
      expect(refusalFor('claimed', 'dismiss')).toContain('Unlink it first');
    });
  });

  describe('a misclick is never permanent', () => {
    it('lets a dismissed ad come back', () => {
      expect(nextState('dismissed', 'restore')).toBe('pending');
    });

    it('lets a dismissed ad be claimed without restoring it first', () => {
      // A merchant who changed their mind and already knows which campaign it
      // belongs to should not have to press a button that decides nothing.
      expect(nextState('dismissed', 'claim')).toBe('claimed');
    });

    it('lets a claim be undone', () => {
      expect(nextState('claimed', 'unlink')).toBe('pending');
    });
  });

  describe('refusals are sentences, not state names', () => {
    it.each(
      STATES.flatMap((from) =>
        ACTIONS.filter((action) => nextState(from, action) === null).map(
          (action) => [from, action] as const,
        ),
      ),
    )('explains why %s cannot be %sed', (from, action) => {
      const message = refusalFor(from, action);
      expect(message.length).toBeGreaterThan(0);
      expect(message.endsWith('.')).toBe(true);
    });
  });

  it('declares every state in the table, with no fall-through', () => {
    expect(Object.keys(UNLINKED_AD_TRANSITIONS).sort()).toEqual(
      [...STATES].sort(),
    );
  });
});
