import type { CampaignStatus } from '../../../shared/database/schema';
import type { PlatformSignals } from '../interfaces/ad-platform-provider.interface';

/**
 * The five statuses a merchant reads, collapsed from the three things the
 * platform reports separately: whether it is delivering, what review said, and
 * when it is scheduled to run.
 *
 * This is the one place the collapse happens, for Campaigns and Ads alike. It is
 * pure, and `now` is a parameter, because the part that fails quietly is the
 * precedence between axes — a rejected ad the merchant already paused, a
 * campaign in review whose end date has passed — and every one of those has to
 * be exercised without waiting for a date to arrive.
 *
 * ## Precedence, first match wins
 *
 * 1. **Ended** — deleted on the platform, finished delivering, or past its end
 *    date. Nothing else about an object that can no longer spend is actionable,
 *    and a deleted campaign still reads Ended rather than disappearing: it
 *    spent money.
 * 2. **Paused** — the merchant's own decision, and it outranks the platform's
 *    complaints: a paused ad is not spending, so a rejection or a review behind
 *    the pause is not what the merchant needs to hear first. The platform masks
 *    review behind a pause itself, for the same reason.
 * 3. **Needs attention** — rejected, reported with issues, or in an error state.
 *    Money the merchant expects to be spending is not being spent.
 * 4. **In review** — waiting on the platform, nothing for the merchant to do.
 * 5. **Active** — including an object scheduled to start later. It is switched
 *    on and will deliver without anyone touching it; calling it Paused would
 *    tell a merchant they turned off something they did not.
 */
export function collapseStatus(
  signals: PlatformSignals,
  now: Date,
): CampaignStatus {
  const { delivery, review, endsAt } = signals;

  if (delivery === 'deleted' || delivery === 'completed') return 'ended';
  if (endsAt && endsAt.getTime() <= now.getTime()) return 'ended';

  if (delivery === 'paused') return 'paused';

  if (
    delivery === 'rejected' ||
    delivery === 'error' ||
    review === 'rejected' ||
    review === 'with_issues'
  ) {
    return 'needs_attention';
  }

  if (delivery === 'pending_review' || review === 'in_review') {
    return 'in_review';
  }

  return 'active';
}
