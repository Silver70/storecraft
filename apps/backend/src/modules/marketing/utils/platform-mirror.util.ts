/**
 * Deciding what the platform's own view of an ad should land on — as a pure
 * function.
 *
 * Pure for the reason the unlinked-ad plan and the money conversion are: it
 * fails without throwing. Mirroring a state onto the wrong Ad, or onto an Ad
 * nothing claims, raises no error and shows a merchant a confident sentence
 * about an ad that is not theirs. So the mapping is written here, against
 * inputs written by hand, and tested as arithmetic rather than as a database.
 *
 * **Nothing here produces a status.** The output carries the platform's state
 * and its placement label and nothing else — there is no field on it that could
 * be written to `ads.status`, which is the shape of the guarantee rather than a
 * rule someone downstream has to remember.
 */
import type { AdPlatformState } from '../../../shared/database/schema';

/** How the platform described one ad on this run, beyond its figures. */
export interface PlatformAdState {
  readonly externalAdId: string;
  readonly platformState: AdPlatformState | null;
  readonly placement: string | null;
}

/** One Ad, and what to write beside — never over — its own status. */
export interface PlatformMirrorRow {
  readonly adId: string;
  readonly platformState: AdPlatformState | null;
  readonly placement: string | null;
}

export interface PlanPlatformMirrorInput {
  /** Every ad the platform reported on this run. */
  readonly reported: readonly PlatformAdState[];
  /** Platform ad id → Ad id, for every Ad in this Store that claims one. */
  readonly claimedByAds: ReadonlyMap<string, { adId: string }>;
  /** Longest label that fits the column. Anything longer is cut, not dropped. */
  readonly maxPlacementLength: number;
}

/**
 * The rows to write, for the reported ads an Ad here actually claims.
 *
 * Three decisions are made here and they are the whole of it:
 *
 * An ad nothing claims produces nothing. Its state belongs to an Unlinked Ad
 * the merchant has not answered for yet, and there is no Ad to put it on — a
 * sync inventing one is the thing this entire stage refuses to do.
 *
 * The platform's latest answer wins for an ad it reported, **including when
 * that answer is nothing.** A platform that has stopped saying an ad is
 * rejected is not a platform that still says so. Preservation is for the ads
 * the platform did not mention at all, and that is expressed by their absence
 * from this output rather than by a rule inside it.
 *
 * A placement is trimmed, emptied to null and cut to fit. An empty label is not
 * a label — it would render as an empty badge, which reads as a value the
 * merchant failed to set rather than as one the platform never sent.
 */
export function planPlatformMirror(
  input: PlanPlatformMirrorInput,
): PlatformMirrorRow[] {
  // A platform reporting one ad twice in a payload is its business, not a
  // reason to write twice. The last description wins, as it does everywhere
  // else a tree is read.
  const seen = new Map<string, PlatformAdState>();
  for (const reported of input.reported) {
    if (!reported.externalAdId) continue;
    seen.set(reported.externalAdId, reported);
  }

  const rows: PlatformMirrorRow[] = [];
  for (const [externalAdId, reported] of seen) {
    const claimed = input.claimedByAds.get(externalAdId);
    if (!claimed) continue;

    rows.push({
      adId: claimed.adId,
      platformState: reported.platformState,
      placement: normalizePlacement(
        reported.placement,
        input.maxPlacementLength,
      ),
    });
  }

  return rows;
}

function normalizePlacement(
  placement: string | null,
  maxLength: number,
): string | null {
  if (!placement) return null;
  // Collapsed rather than preserved: platforms pad and newline these labels,
  // and the merchant reads this on one line of a card.
  const cleaned = placement.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}
