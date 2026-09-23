import type {
  AttributedRevenueReport,
  Campaign,
  CampaignRevenueLine,
} from "~/types/api";

/**
 * One campaign as this page shows it: the managed object, and what it did in
 * the period.
 *
 * The two come from two reads and are joined here rather than in a component,
 * so everything on the page is looking at exactly the same list.
 */
export type CampaignGroup = {
  campaign: Campaign;
  /**
   * The period's figures, or null when the report has nothing for this
   * campaign.
   *
   * Null is only reachable for an archived campaign that earned nothing in the
   * window — the report includes every active campaign and every campaign with
   * revenue, precisely so a push that produced nothing still appears. A null
   * renders as "no activity in this period" and never as a row of zeroes:
   * zeroes are a claim about a period, and the report deliberately did not make
   * one.
   */
  line: CampaignRevenueLine | null;
};

/**
 * Every campaign the merchant manages, carrying what the period says about it,
 * in the order the page reads in.
 *
 * Driven by the campaign list rather than by the report, so a campaign with
 * nothing in the window is still on the page a merchant came to manage it from.
 * The report supplies the figures — and the ads, which arrive on its lines
 * already carrying their creative and flight dates, so assembling a card needs
 * no third read that could disagree about which ads exist.
 *
 * Sorted by revenue, which is the one question this page now answers. A
 * campaign with no figures at all sorts last: absence is not a low score.
 */
export function groupCampaigns(
  campaigns: readonly Campaign[],
  report: AttributedRevenueReport,
): CampaignGroup[] {
  const lines = new Map(
    report.campaigns.map((line) => [line.campaignId, line]),
  );
  return campaigns
    .map((campaign) => ({
      campaign,
      line: lines.get(campaign.id) ?? null,
    }))
    .sort((a, b) => {
      if (a.line === null || b.line === null) {
        if (a.line === b.line)
          return a.campaign.name.localeCompare(b.campaign.name);
        return a.line === null ? 1 : -1;
      }
      return (
        b.line.revenue - a.line.revenue ||
        b.line.orders - a.line.orders ||
        a.campaign.name.localeCompare(b.campaign.name)
      );
    });
}
