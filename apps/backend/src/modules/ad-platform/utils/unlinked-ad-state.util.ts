/**
 * The state machine an Unlinked Ad moves through, as a pure unit.
 *
 * Claim, dismiss, restore and unlink are four buttons on one row, and every one
 * of them is a transition declared here. Nothing else in this codebase may
 * write `unlinked_ads.state`: the repository exposes a single `transition`
 * method, the service calls it, and an invalid move throws rather than quietly
 * doing nothing — the convention `OrderService.transition` already sets. A
 * second path that "just sets dismissed" is how a claimed ad ends up dismissed
 * with an Ad still pointing at it.
 *
 * ## The transitions, exhaustively
 *
 * ```
 *              ┌──────────── restore ────────────┐
 *              ↓                                 │
 *  (born) → pending ──── dismiss ───────────→ dismissed
 *              ↑                                 │
 *              │                              claim
 *            unlink                              │
 *              │                                 ↓
 *              └────────── claim ─────────→  claimed
 * ```
 *
 * - `pending → claimed` (**claim**) — resolved onto an Ad, which now carries
 *   its platform id.
 * - `pending → dismissed` (**dismiss**) — the merchant does not want it
 *   tracked.
 * - `dismissed → pending` (**restore**) — they changed their mind. A misclick
 *   on dismiss is not permanent.
 * - `dismissed → claimed` (**claim**) — they changed their mind and already
 *   know which Campaign it belongs to. Making them restore first would be a
 *   click that asks nothing and decides nothing.
 * - `claimed → pending` (**unlink**) — the claim was wrong. The Ad it was
 *   claimed onto is kept, because it may already have earned revenue through
 *   its tag; only the platform id is taken off it.
 *
 * `claimed → dismissed` is deliberately **not** a transition. Dismissing a
 * claimed ad would have to detach an Ad and record a refusal in one move, and
 * the merchant would not be shown which of the two they had just done. Unlink,
 * then dismiss: two decisions, two clicks, each reversible on its own.
 *
 * ## What happens to its Reported Figures
 *
 * Nothing, in every case. Figures are keyed on the platform's ad id in
 * `ad_reported_figures` and are never moved, rewritten or deleted by any
 * transition here. What changes is whether an Ad *claims* that id:
 *
 * - **claim** sets `ads.external_id`, which attaches every day already pulled
 *   for that ad — the backfill included — to the Ad. Claiming never starts an
 *   ad's spend from zero.
 * - **unlink** clears it, detaching the history without losing a row of it. A
 *   reclaim onto the same or a different Ad reattaches all of it.
 * - **dismiss** and **restore** touch no Ad and change nothing about the
 *   figures. A dismissed ad's spend stays pulled and stays readable: the
 *   merchant declined to attribute the money, not to know about it.
 */
import type { UnlinkedAdState } from '../../../shared/database/schema';

/** What a merchant did to the row. One action, one transition. */
export type UnlinkedAdAction = 'claim' | 'dismiss' | 'restore' | 'unlink';

/**
 * Every legal move, in one table.
 *
 * Read as: from this state, this action lands here. An action absent from a
 * state's row is not legal from it, and there is no fall-through.
 */
export const UNLINKED_AD_TRANSITIONS: Readonly<
  Record<
    UnlinkedAdState,
    Readonly<Partial<Record<UnlinkedAdAction, UnlinkedAdState>>>
  >
> = {
  pending: { claim: 'claimed', dismiss: 'dismissed' },
  dismissed: { restore: 'pending', claim: 'claimed' },
  claimed: { unlink: 'pending' },
} as const;

/** The state an action lands in, or null when the action is not legal there. */
export function nextState(
  from: UnlinkedAdState,
  action: UnlinkedAdAction,
): UnlinkedAdState | null {
  return UNLINKED_AD_TRANSITIONS[from][action] ?? null;
}

/**
 * Why a move was refused, in words the merchant reads.
 *
 * Says what the row is and what it would take to get where they were going,
 * rather than naming two states and leaving them to work out the difference: a
 * merchant who pressed Dismiss on an ad a colleague claimed a moment ago is not
 * looking at a state diagram.
 */
export function refusalFor(
  from: UnlinkedAdState,
  action: UnlinkedAdAction,
): string {
  if (from === 'claimed' && action === 'dismiss') {
    return 'This ad has already been claimed onto an ad in this store. Unlink it first if you want to dismiss it.';
  }
  if (from === 'claimed' && action === 'claim') {
    return 'This ad has already been claimed. Unlink it first if you want to claim it onto something else.';
  }
  if (from === 'dismissed' && action === 'dismiss') {
    return 'This ad is already dismissed.';
  }
  if (from === 'pending' && action === 'restore') {
    return 'This ad is already waiting to be dealt with.';
  }
  if (from === 'pending' && action === 'unlink') {
    return 'This ad has not been claimed, so there is nothing to unlink.';
  }
  if (from === 'dismissed' && action === 'unlink') {
    return 'This ad was dismissed rather than claimed, so there is nothing to unlink.';
  }
  return `An unlinked ad that is ${from} cannot be ${PAST_TENSE[action]}.`;
}

const PAST_TENSE: Record<UnlinkedAdAction, string> = {
  claim: 'claimed',
  dismiss: 'dismissed',
  restore: 'restored',
  unlink: 'unlinked',
};
