import type {
  AttributedRevenueReport,
  Campaign,
  CampaignPlatform,
  CampaignRevenueLine,
  CampaignStatus,
} from "~/types/api";

/**
 * One campaign as this page shows it: the managed object, and what it did in
 * the period.
 *
 * The two come from two reads and are joined here rather than in a component,
 * so the card grid and the dense table are looking at exactly the same list.
 * Two views of one page that disagreed about which campaigns exist would be a
 * worse bug than either being wrong, because nothing on screen would say which
 * to believe.
 */
export type CampaignGroup = {
  campaign: Campaign;
  /**
   * The period's figures, or null when the report has nothing for this
   * campaign.
   *
   * Null is only reachable for an archived campaign that neither earned nor
   * cost anything in the window — the report includes every active campaign and
   * every campaign with activity, precisely so a push that produced nothing
   * still appears. A null renders as "no activity in this period" and never as
   * a row of zeroes: zeroes are a claim about a period, and the report
   * deliberately did not make one.
   */
  line: CampaignRevenueLine | null;
};

export type SortKey = "revenue" | "spend" | "roas" | "margin" | "name";

export type PerformanceFilters = {
  /** A single campaign, or every one of them. */
  campaignId: string | "all";
  platform: CampaignPlatform | "all";
  /**
   * Campaign status. It selects campaigns, not ads: an archived ad that spent
   * money in the period stays visible under its campaign, because hiding it
   * would hide the most actionable fact in the account.
   */
  status: CampaignStatus | "all";
  sort: SortKey;
};

export const DEFAULT_FILTERS: PerformanceFilters = {
  campaignId: "all",
  platform: "all",
  // The list page's default before the merge, kept: archived campaigns explain
  // old orders and are not what a merchant opens this page to read.
  status: "active",
  sort: "revenue",
};

/** Nulls sort last on every measure, in every direction. Absence is not a low score. */
function byNumberDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Everything but `name`, which is not a measure and sorts on its own. */
type MeasureKey = Exclude<SortKey, "name">;

function sortValue(group: CampaignGroup, key: MeasureKey): number | null {
  const line = group.line;
  switch (key) {
    case "revenue":
      return line?.revenue ?? null;
    case "spend":
      return line?.spend ?? null;
    case "roas":
      return line?.roas ?? null;
    case "margin":
      return line?.contributionMargin ?? null;
  }
}

/**
 * Every campaign the merchant manages, carrying what the period says about it.
 *
 * Driven by the campaign list rather than by the report, so a campaign with
 * nothing in the window is still on the page a merchant came to manage it from.
 * The report supplies the figures — and the ads, which arrive on its lines
 * already carrying their creative and flight dates, so assembling a card needs
 * no third read that could disagree about which ads exist.
 */
export function groupCampaigns(
  campaigns: readonly Campaign[],
  report: AttributedRevenueReport,
): CampaignGroup[] {
  const lines = new Map(
    report.campaigns.map((line) => [line.campaignId, line]),
  );
  return campaigns.map((campaign) => ({
    campaign,
    line: lines.get(campaign.id) ?? null,
  }));
}

export function filterGroups(
  groups: readonly CampaignGroup[],
  filters: PerformanceFilters,
): CampaignGroup[] {
  return groups.filter(({ campaign }) => {
    // Naming one campaign is the most specific thing a merchant can ask for, so
    // it answers on its own. The status and platform filters are how you narrow
    // a list you are browsing; applying them on top of an explicit choice would
    // answer "show me this campaign" with an empty page whenever the campaign
    // picked happened to be archived, and nothing on screen would say why.
    if (filters.campaignId !== "all") return campaign.id === filters.campaignId;

    if (filters.platform !== "all" && campaign.platform !== filters.platform) {
      return false;
    }
    if (filters.status !== "all" && campaign.status !== filters.status) {
      return false;
    }
    return true;
  });
}

/**
 * The order the page reads in.
 *
 * Spend breaks every tie before order count does, so among the campaigns that
 * earned nothing the ones burning money sort above the ones that are merely
 * idle — the same rule the backend sorts its own lines by, for the same reason.
 * A campaign with no figures at all sorts last on every measure.
 */
export function sortGroups(
  groups: readonly CampaignGroup[],
  sort: SortKey,
): CampaignGroup[] {
  const sorted = [...groups];
  sorted.sort((a, b) => {
    if (sort === "name") {
      return a.campaign.name.localeCompare(b.campaign.name);
    }
    const primary = byNumberDesc(sortValue(a, sort), sortValue(b, sort));
    if (primary !== 0) return primary;
    return (
      byNumberDesc(a.line?.spend ?? null, b.line?.spend ?? null) ||
      byNumberDesc(a.line?.orders ?? null, b.line?.orders ?? null) ||
      a.campaign.name.localeCompare(b.campaign.name)
    );
  });
  return sorted;
}

/** The platforms actually in use, so the filter offers no empty choices. */
export function platformsInUse(
  campaigns: readonly Campaign[],
): CampaignPlatform[] {
  return [...new Set(campaigns.map((c) => c.platform))].sort();
}
