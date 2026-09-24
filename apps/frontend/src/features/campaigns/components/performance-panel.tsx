import type * as React from "react";
import { Link } from "@tanstack/react-router";

import { Card } from "~/components/ui/card";
import { formatMoney } from "~/lib/money";
import type { CampaignPerformanceLine } from "~/types/api";
import {
  formatCount,
  formatPercent,
  formatPlatform,
  formatRoas,
} from "../utils";

/**
 * A figure that cannot be stated honestly. Drawn as a dash and never as `0`:
 * a zero is a claim about what happened, and these are the places we cannot
 * make one.
 */
export function Absent({ reason }: { reason?: string }) {
  return (
    <span className="text-muted-foreground" title={reason} aria-label={reason ?? "Not available"}>
      —
    </span>
  );
}

function Figure({
  label,
  children,
  note,
}: {
  label: string;
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{children}</dd>
      {note ? (
        <dd className="mt-0.5 truncate text-[11px] text-muted-foreground">{note}</dd>
      ) : null}
    </div>
  );
}

/**
 * Where to go to fix a withheld ROI: straight to the one product missing a
 * cost price, or to the catalog when there are several. A product that has
 * since been deleted cannot be priced, so it is named rather than linked.
 */
function CostPriceLink({
  products,
}: {
  products: CampaignPerformanceLine["uncostedProducts"];
}) {
  const priceable = products.filter((p) => p.productId !== null);
  const names = products.map((p) => p.name).join(", ");

  if (priceable.length === 0) {
    return <span title={names}>Sold items have no cost price</span>;
  }
  const className = "text-foreground underline underline-offset-2 hover:no-underline";
  if (priceable.length === 1) {
    return (
      <Link
        to="/admin/products/$productId"
        params={{ productId: priceable[0].productId! }}
        className={className}
        title={names}
      >
        Add a cost price to {priceable[0].name}
      </Link>
    );
  }
  return (
    <Link to="/admin/products" className={className} title={names}>
      Add cost prices to {priceable.length} products
    </Link>
  );
}

/**
 * Everything a merchant needs to judge the campaign, on one panel: what it
 * earned, what it cost, and whether that was worth it.
 *
 * Revenue, orders, ROAS and ROI are ours, from Orders. Spend, impressions and
 * clicks are the platform's measurements and say so. Conversion rate is both —
 * our orders over their clicks — and is labelled as such.
 *
 * ROI is withheld, with a route to the fix, unless every item sold has a cost
 * price: a figure that silently counts half the goods as free is worse than no
 * figure. A Not Tracked campaign shows its spend, which is real, and nothing
 * built on its revenue, which is unknown.
 *
 * The lookback window is stated here, in the footer, and nowhere else on the
 * page.
 */
export function PerformancePanel({
  line,
  lookbackDays,
}: {
  line: CampaignPerformanceLine;
  lookbackDays: number;
}) {
  const platform = formatPlatform(line.platform);
  const tracked = line.hasLinkTags;
  const notTracked = "Not tracked";

  let roiNote: React.ReactNode = null;
  if (line.contributionMargin !== null) {
    roiNote = `Margin ${formatMoney(line.contributionMargin)}`;
  } else if (tracked && line.uncostedProducts.length > 0) {
    roiNote = <CostPriceLink products={line.uncostedProducts} />;
  }

  return (
    <Card className="gap-0 py-0">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-3">
        <Figure label="Attributed revenue" note={tracked ? null : notTracked}>
          {tracked ? formatMoney(line.revenue) : <Absent reason={notTracked} />}
        </Figure>
        <Figure label="Spend" note={`Reported by ${platform}`}>
          {formatMoney(line.spend)}
        </Figure>
        <Figure label="Impressions" note={`Reported by ${platform}`}>
          {formatCount(line.impressions)}
        </Figure>
        <Figure label="Orders" note={tracked ? null : notTracked}>
          {tracked ? formatCount(line.orders) : <Absent reason={notTracked} />}
        </Figure>
        <Figure label="Conversion rate" note={`Our orders ÷ ${platform} clicks`}>
          {line.conversionRate !== null ? formatPercent(line.conversionRate) : <Absent />}
        </Figure>
        <Figure label="ROI" note={roiNote}>
          {line.roi !== null ? formatPercent(line.roi) : <Absent />}
        </Figure>
      </dl>

      {!tracked ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Revenue is not tracked: not every ad in this campaign carries our link tags, so
          orders cannot name it. Spend is still {platform}&apos;s own figure.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 border-t bg-muted/30 px-5 py-3.5">
        <dl className="flex gap-8">
          <div>
            <dt className="text-xs text-muted-foreground">Clicks</dt>
            <dd className="text-sm font-semibold tabular-nums">{formatCount(line.clicks)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ROAS</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {line.roas !== null ? formatRoas(line.roas) : <Absent />}
            </dd>
          </div>
        </dl>
        <p className="ml-auto text-[11px] text-muted-foreground">
          Revenue credits the latest ad click within {lookbackDays} days of an order.
          Clicks and spend are {platform}&apos;s.
        </p>
      </div>
    </Card>
  );
}
