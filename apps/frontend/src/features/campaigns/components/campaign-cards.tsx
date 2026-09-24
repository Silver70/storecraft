import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ImageIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Card } from "~/components/ui/card";
import type { CampaignRevenueLine } from "~/types/api";
import { formatPlatform } from "../utils";
import { CampaignStatusBadge } from "./campaign-status-badge";

/**
 * The picture a merchant recognises a campaign or an ad by.
 *
 * The empty state is drawn as a deliberate tile rather than as a hole where a
 * picture failed to load, and an image whose URL fails falls back to the same
 * tile, so the one thing that cannot appear is a broken image.
 */
export function CreativeTile({
  src,
  name,
  className,
}: {
  src: string | null;
  name: string;
  /** Overrides the small square thumbnail's size and frame. */
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  const showing = src && !failed;

  return (
    <div
      className={cn(
        "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md",
        showing
          ? "border border-border/60"
          : "border-2 border-dashed border-border bg-muted/30 text-muted-foreground/60",
        className,
      )}
    >
      {showing ? (
        <img
          src={src}
          alt={`Creative for ${name}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <ImageIcon className="h-5 w-5" aria-hidden />
      )}
    </div>
  );
}

/**
 * One campaign on the grid: its creative, its name, its platform, its status
 * and what it earned in the page's window. Nothing else — the rest is one click
 * away, on the campaign's own page, which the whole card opens.
 *
 * **Not Tracked is not zero.** A campaign whose ads carry no Link Tags cannot be
 * named by any order, so its revenue is unknown: it reads as a dash and the
 * words "Not tracked", never as `$0.00`, which would invent a failure that did
 * not happen.
 */
export function CampaignCard({ line }: { line: CampaignRevenueLine }) {
  return (
    <Link
      to="/admin/campaigns/$campaignId"
      params={{ campaignId: line.campaignId }}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full gap-0 overflow-hidden py-0 transition-shadow group-hover:shadow-md">
        <CreativeTile
          src={line.coverUrl}
          name={line.name}
          className="aspect-[4/3] h-auto w-full rounded-none border-0 border-b"
        />

        <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
          <div className="min-w-0 space-y-1.5">
            <p className="truncate text-sm font-semibold leading-tight group-hover:underline">
              {line.name}
            </p>
            <div className="flex items-center gap-2">
              <CampaignStatusBadge status={line.status} />
              <span className="text-[11px] text-muted-foreground">
                {formatPlatform(line.platform)}
              </span>
            </div>
          </div>

          <div className="mt-auto">
            <p className="text-xs text-muted-foreground">Revenue</p>
            {line.hasLinkTags ? (
              <p className="text-lg font-semibold tabular-nums">
                {formatMoney(line.revenue)}
              </p>
            ) : (
              <p className="flex items-baseline gap-2">
                <span
                  className="text-lg font-semibold text-muted-foreground"
                  aria-hidden
                >
                  —
                </span>
                <span className="text-xs text-muted-foreground">
                  Not tracked
                </span>
              </p>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
