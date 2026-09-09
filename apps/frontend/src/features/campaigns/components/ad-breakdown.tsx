import type * as React from "react";

import { formatMoney } from "~/lib/money";
import { cn } from "~/lib/utils";
import type {
  AdRevenueLine,
  CampaignRevenueLine,
  PerformanceFigures,
} from "~/types/api";
import { formatRoas } from "../utils";

/**
 * A margin, or the reason there is not one.
 *
 * Withheld rather than estimated when goods were sold and none of them have a
 * cost price — a figure built on no cost data is not conservative, it is
 * fiction, and the blank is what sends a merchant to fill their costs in.
 */
function formatMargin(
  line: PerformanceFigures,
  currency: string | undefined,
): string {
  return line.contributionMargin === null
    ? "—"
    : formatMoney(line.contributionMargin, currency);
}

function Row({
  label,
  sublabel,
  line,
  currency,
  muted,
}: {
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  line: PerformanceFigures;
  currency?: string;
  muted?: boolean;
}) {
  return (
    <tr className={cn("border-t", muted && "bg-muted/30")}>
      <td className="px-3 py-2">
        <div
          className={cn(
            "truncate text-sm",
            muted && "italic text-muted-foreground",
          )}
        >
          {label}
        </div>
        {sublabel && (
          <div className="truncate text-xs text-muted-foreground">
            {sublabel}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {line.orders}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {formatMoney(line.revenue, currency)}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {formatMoney(line.spend, currency)}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right text-sm tabular-nums",
          line.roas === null && "text-muted-foreground",
        )}
      >
        {formatRoas(line.roas)}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right text-sm tabular-nums",
          line.contributionMargin === null && "text-muted-foreground",
          line.contributionMargin !== null &&
            line.contributionMargin < 0 &&
            "text-destructive",
        )}
      >
        {formatMargin(line, currency)}
      </td>
    </tr>
  );
}

/**
 * Which of the creatives under this campaign actually sold something.
 *
 * Every figure here is a real subdivision of the campaign line above it, from
 * the same read: an order resolves onto one ad by the `utm_content` its link
 * carried, and the ad's spend is the figures recorded against that ad alone.
 * The rows plus the unassigned row beneath them add back up to the campaign, so
 * the split never changes the total a merchant already trusted.
 *
 * **Unassigned is always shown and never divided.** It is what this campaign
 * earned that no ad of its claimed, together with the cost recorded against the
 * push without naming one — spreading it across whichever creatives happen to
 * exist would flatter every one of them. It is also not the same thing as
 * unattributed on the store report: those orders have no campaign at all, these
 * have this one.
 *
 * A campaign with no ads renders nothing. An ad is a subdivision a merchant
 * opts into, and a campaign without one reports exactly as it did before ads
 * existed — an empty table with a nagging empty state would suggest otherwise.
 */
export function AdBreakdown({
  line,
  currency,
}: {
  line: CampaignRevenueLine;
  currency?: string;
}) {
  if (line.ads.length === 0) return null;

  return (
    <section aria-labelledby="campaign-ad-split-title" className="space-y-2">
      <h4
        id="campaign-ad-split-title"
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        By ad
      </h4>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Ad</th>
              <th className="px-3 py-2 text-right font-medium">Orders</th>
              <th className="px-3 py-2 text-right font-medium">Revenue</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 text-right font-medium">ROAS</th>
              <th className="px-3 py-2 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {line.ads.map((ad: AdRevenueLine) => (
              <Row
                key={ad.adId}
                label={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{ad.name}</span>
                    {ad.status === "archived" && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Archived
                      </span>
                    )}
                  </span>
                }
                sublabel={<code className="font-mono">{ad.tag}</code>}
                line={ad}
                currency={currency}
              />
            ))}

            {/* Its own visible bucket, always, and never redistributed above. */}
            <Row
              label="Unassigned"
              sublabel="No ad tag on the link, or a tag no ad here owns"
              line={line.unassigned}
              currency={currency}
              muted
            />
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        An order lands on an ad by the <code>utm_content</code> its link
        carried. These rows plus unassigned add up to the campaign figures above
        — the split does not move them. Unassigned is not the same as
        unattributed: those orders belong to this campaign, they just do not
        name a creative.
      </p>
    </section>
  );
}
