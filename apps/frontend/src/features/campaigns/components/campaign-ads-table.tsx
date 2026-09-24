import type * as React from "react";
import { Card } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import type { AdPerformanceLine, CampaignPerformanceLine } from "~/types/api";
import { formatAdFormat, formatCount, formatRoas, reviewNote } from "../utils";
import { CreativeTile } from "./campaign-cards";
import { CampaignStatusBadge } from "./campaign-status-badge";
import { Absent } from "./performance-panel";

const NUM = "text-right tabular-nums";
const NOT_TRACKED = "Not tracked";

/**
 * The ads that ran under the campaign, one row each, and the campaign's total
 * beneath them — so which creative carried it is read off the page, not worked
 * out.
 *
 * The rows add up to the total for every figure. Spend, impressions and clicks
 * are the ads' own and sum exactly. Orders and revenue sum with one more row:
 * **"Not linked to an ad"**, the campaign's orders whose link named no ad of its
 * — only a hand-edited link produces one, so the row appears only then.
 *
 * An ad whose link carries no tags has no readable revenue, and shows a dash
 * there rather than a zero. Its status is the platform's, collapsed; a review
 * verdict against it is named beneath, so an ad paused after a rejection reads
 * as both.
 */
export function CampaignAdsTable({
  line,
  action,
}: {
  line: CampaignPerformanceLine;
  /** What can be done to one ad, in a last column. Absent draws no column. */
  action?: (ad: AdPerformanceLine) => React.ReactNode;
}) {
  const tracked = line.hasLinkTags;
  const unassigned = line.unassigned;

  if (line.ads.length === 0) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-muted-foreground">No ads on this campaign.</p>
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead className="pl-5">Ad</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className={NUM}>Spend</TableHead>
            <TableHead className={NUM}>Impressions</TableHead>
            <TableHead className={NUM}>Clicks</TableHead>
            <TableHead className={NUM}>Orders</TableHead>
            <TableHead className={NUM}>Revenue</TableHead>
            <TableHead className={cn(NUM, action ? undefined : "pr-5")}>ROAS</TableHead>
            {action && <TableHead className="pr-5" />}
          </TableRow>
        </TableHeader>

        <TableBody>
          {line.ads.map((ad) => {
            const note = reviewNote(ad.reviewStatus, line.platform);
            return (
              <TableRow key={ad.adId}>
                <TableCell className="pl-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <CreativeTile src={ad.creativeUrl} name={ad.name} className="h-10 w-10" />
                    <span className="max-w-[16rem] truncate font-medium" title={ad.name}>
                      {ad.name}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatAdFormat(ad.format) ?? <Absent />}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <CampaignStatusBadge status={ad.status} />
                    {note ? (
                      <span className="text-[11px] text-amber-700 dark:text-amber-400">{note}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className={NUM}>{formatMoney(ad.spend)}</TableCell>
                <TableCell className={NUM}>{formatCount(ad.impressions)}</TableCell>
                <TableCell className={NUM}>{formatCount(ad.clicks)}</TableCell>
                <TableCell className={NUM}>
                  {ad.hasLinkTags ? formatCount(ad.orders) : <Absent reason={NOT_TRACKED} />}
                </TableCell>
                <TableCell className={NUM}>
                  {ad.hasLinkTags ? formatMoney(ad.revenue) : <Absent reason={NOT_TRACKED} />}
                </TableCell>
                <TableCell className={cn(NUM, action ? undefined : "pr-5")}>
                  {ad.roas !== null ? formatRoas(ad.roas) : <Absent />}
                </TableCell>
                {action && <TableCell className="pr-5 text-right">{action(ad)}</TableCell>}
              </TableRow>
            );
          })}

          {unassigned.orders > 0 ? (
            <TableRow className="text-muted-foreground hover:bg-transparent">
              <TableCell className="pl-5 italic" colSpan={6}>
                Not linked to an ad
              </TableCell>
              <TableCell className={NUM}>{formatCount(unassigned.orders)}</TableCell>
              <TableCell className={NUM}>{formatMoney(unassigned.revenue)}</TableCell>
              <TableCell className="pr-5" colSpan={action ? 2 : 1} />
            </TableRow>
          ) : null}
        </TableBody>

        <TableFooter>
          <TableRow className="font-semibold hover:bg-transparent">
            <TableCell className="pl-5" colSpan={3}>
              Campaign total
            </TableCell>
            <TableCell className={NUM}>{formatMoney(line.spend)}</TableCell>
            <TableCell className={NUM}>{formatCount(line.impressions)}</TableCell>
            <TableCell className={NUM}>{formatCount(line.clicks)}</TableCell>
            <TableCell className={NUM}>
              {tracked ? formatCount(line.orders) : <Absent reason={NOT_TRACKED} />}
            </TableCell>
            <TableCell className={NUM}>
              {tracked ? formatMoney(line.revenue) : <Absent reason={NOT_TRACKED} />}
            </TableCell>
            <TableCell className={cn(NUM, action ? undefined : "pr-5")}>
              {line.roas !== null ? formatRoas(line.roas) : <Absent />}
            </TableCell>
            {action && <TableCell className="pr-5" />}
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  );
}
