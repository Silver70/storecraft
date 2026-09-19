/**
 * The ad platform's figures as they appear beside ours — as a pure function.
 *
 * Pure for the reason the rest of this folder is: everything here fails
 * quietly. Summing across two currencies, computing a ratio over a mismatch, or
 * printing a window nobody stated produces no error and no crash — it produces
 * a confident number on a card that a merchant will act on. So the rules live
 * in one function over hand-written inputs, and are tested as arithmetic.
 *
 * ## The three rules, and none of them are stylistic
 *
 * **Nothing here is ever added to one of our figures.** There is no parameter
 * on any function in this file carrying our revenue, our spend or our goods
 * basis, and no field on the output that could be mistaken for one. What comes
 * out is labelled with the platform that said it and the currency it is in, and
 * it travels in its own object on the line (ADR-0005). Merging them would make
 * a revenue total incomparable with itself: the same period would report
 * differently depending on which ads happened to sync that day.
 *
 * **Money is summed within a currency and never across two.** A group carries
 * its own currency and groups are collapsed only where those match. An account
 * that billed in EUR for half the period and USD for the other half produces
 * two entries, not one total built on a rate nobody chose.
 *
 * **The only ratio computed is theirs over theirs.** `roas` is the platform's
 * own reported revenue divided by the platform's own spend, both its figures,
 * both in one currency. Our revenue over their spend is not computed here or
 * anywhere, and the currency guard in this file is why it cannot be: a caller
 * holding one of these knows whether the currency is the Store's before it
 * knows anything else about it.
 */
import type { AdPlatform } from '../../../shared/database/schema';
import { roasFor } from './performance.util';

/**
 * The platform's attribution window, as it stated it.
 *
 * Null on the line rather than defaulted, because how far back a platform
 * credits a conversion is the single reason its revenue and ours disagree, and
 * a guessed window displayed beside our own Lookback Window reads as one the
 * platform agreed to.
 */
export interface ReportedAttributionWindow {
  /** Days after a click the platform still credits a conversion. */
  clickDays: number;
  /** Days after a view, or null where the platform credits views not at all. */
  viewDays: number | null;
}

/** One group of a platform's days for one Ad, as the repository returns it. */
export interface ReportedFigureGroup {
  readonly platform: AdPlatform;
  readonly currency: string;
  readonly attributionClickDays: number | null;
  readonly attributionViewDays: number | null;
  readonly spend: number;
  readonly reportedRevenue: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly days: number;
  readonly firstDay: string;
  readonly lastDay: string;
  readonly syncedAt: Date;
}

/**
 * What one ad platform says one Ad did over the period.
 *
 * Every field on it is the platform's. There is deliberately nothing here
 * derived from an Order, a cost price or a Spend row of ours, and nothing that
 * a Contribution Margin could be computed from: a platform's conversion value
 * has no cost basis behind it, which is why it is not a margin input and not a
 * substitute for revenue.
 */
export interface ReportedAdFigures {
  /**
   * Who said it. On the figure itself rather than inferable from context — a
   * Reported Figure must never be mistakable for one of ours (ADR-0005), and a
   * source label a renderer has to go and look up is one it will eventually
   * render without.
   */
  platform: AdPlatform;
  /** The ad account's currency, in which every money field here is stated. */
  currency: string;
  /** The Store's, carried along so the mismatch can be explained where it shows. */
  storeCurrency: string;
  /**
   * Whether those two are the same.
   *
   * False is not an error and not a gap: the figures below are real and are
   * shown as what they are. What it forbids is arithmetic — no figure here may
   * be combined with one of ours, no ratio taken across the two, and no margin
   * computed from either side. There is no exchange rate anywhere in this
   * feature and inventing one inside a margin is the failure class the whole
   * feature exists to avoid (ADR-0005).
   */
  matchesStoreCurrency: boolean;
  /** What the platform says it charged the ad account. Minor units. */
  spend: number;
  /**
   * What the platform claims the ad earned, on its own window. Minor units.
   *
   * **Never our revenue and never a replacement for it.** Where we have a
   * revenue figure for this Ad it stands unchanged beside this one, and where
   * we have none this does not fill in.
   */
  revenue: number;
  impressions: number;
  clicks: number;
  /** Conversions on `attribution` below, which is not our Lookback Window. */
  conversions: number;
  /**
   * The platform's revenue over the platform's spend, to two decimals.
   *
   * **Both figures are theirs and both are in `currency`**, so this crosses
   * nothing: it is the platform's own claim about its own return, stated the
   * way we state ours so the two can be read side by side. It is not our
   * revenue over their spend, which is the number this whole design refuses to
   * produce.
   *
   * Null when they reported no spend, on the same convention as ours: no return
   * *on spend* where nothing was spent, rather than a zero that reads as
   * failure.
   */
  roas: number | null;
  /** The window the figures above were measured on. Null where none was stated. */
  attribution: ReportedAttributionWindow | null;
  /** How many days of the period the platform reported for this ad. */
  days: number;
  /** The first and last of those days, `YYYY-MM-DD`. */
  firstDay: string;
  lastDay: string;
  /** When a sync last confirmed the freshest of them. ISO. */
  syncedAt: string;
}

/**
 * The platform's figures for one Ad, collapsed to one entry per platform and
 * currency.
 *
 * Returns an array rather than a single object, and that is not hedging. Almost
 * every Ad has zero entries or one. A second entry means the platform billed
 * this ad in two currencies inside one period — an account that switched — and
 * the honest report of that is two figures in two currencies, not one sum. A
 * shape that could only hold one would have forced a choice between dropping
 * half the money and inventing a rate, and both are worse than a card with two
 * blocks on it.
 *
 * Empty is the ordinary answer and stays ordinary: every Ad on a platform no
 * sync covers has no Reported Figures and never will, and the card is built to
 * read without them.
 *
 * Sorted by spend, so where there are two the one the merchant is actually
 * spending in leads.
 */
export function reportedFiguresFor(
  groups: readonly ReportedFigureGroup[],
  storeCurrency: string,
): ReportedAdFigures[] {
  const collapsed = new Map<string, ReportedFigureGroup[]>();
  for (const group of groups) {
    const key = `${group.platform}:${group.currency}`;
    const existing = collapsed.get(key);
    if (existing) existing.push(group);
    else collapsed.set(key, [group]);
  }

  return [...collapsed.values()]
    .map((sameCurrency) => summarize(sameCurrency, storeCurrency))
    .sort(
      (a, b) =>
        b.spend - a.spend ||
        b.revenue - a.revenue ||
        a.currency.localeCompare(b.currency),
    );
}

/**
 * One currency's groups as one figure.
 *
 * The sums are safe here and only here: every group in this list already agrees
 * on the currency, because that is what the caller grouped on.
 */
function summarize(
  groups: readonly ReportedFigureGroup[],
  storeCurrency: string,
): ReportedAdFigures {
  const first = groups[0];

  let spend = 0;
  let revenue = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let days = 0;
  let firstDay = first.firstDay;
  let lastDay = first.lastDay;
  let syncedAt = first.syncedAt;

  for (const group of groups) {
    spend += group.spend;
    revenue += group.reportedRevenue;
    impressions += group.impressions;
    clicks += group.clicks;
    conversions += group.conversions;
    days += group.days;
    if (group.firstDay && group.firstDay < firstDay) firstDay = group.firstDay;
    if (group.lastDay > lastDay) lastDay = group.lastDay;
    if (group.syncedAt > syncedAt) syncedAt = group.syncedAt;
  }

  return {
    platform: first.platform,
    currency: first.currency,
    storeCurrency,
    matchesStoreCurrency: sameCurrency(first.currency, storeCurrency),
    spend,
    revenue,
    impressions,
    clicks,
    conversions,
    // Theirs over theirs, in one currency, on the same null convention ours
    // uses. Nothing of ours is on either side of this division.
    roas: roasFor(revenue, spend),
    attribution: windowAcross(groups),
    days,
    firstDay,
    lastDay,
    syncedAt: syncedAt.toISOString(),
  };
}

/**
 * The window these days were measured on, or null if they were not all measured
 * on one.
 *
 * A merchant who changed their attribution setting mid-period has figures
 * counted two ways, and there is no single window that describes them. Naming
 * either one would put a precise caveat under a number it is only half true of,
 * so the answer is that the platform did not state one window for this period —
 * which is what the card then says.
 */
function windowAcross(
  groups: readonly ReportedFigureGroup[],
): ReportedAttributionWindow | null {
  const { attributionClickDays: clickDays, attributionViewDays: viewDays } =
    groups[0];
  if (clickDays === null) return null;

  for (const group of groups) {
    if (
      group.attributionClickDays !== clickDays ||
      group.attributionViewDays !== viewDays
    ) {
      return null;
    }
  }

  return { clickDays, viewDays };
}

/**
 * Whether two currency codes name one currency.
 *
 * Case and padding only — there is no equivalence table here and no conversion
 * anywhere near it. The same comparison `SyncedSpendService` makes before it
 * declines to write a foreign figure into the merchant's book, made again here
 * before anything is allowed to be read as comparable.
 */
function sameCurrency(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}
