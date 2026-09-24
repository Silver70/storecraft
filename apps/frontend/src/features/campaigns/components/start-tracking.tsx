import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  Loader2Icon,
  TagIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { AdTrackingResult, CampaignRevenueLine, TrackingOutcome } from "~/types/api";
import { startCampaignTrackingServerFn } from "../server";

/**
 * Start tracking, for a campaign built in Ads Manager.
 *
 * It costs the merchant something, so it never runs for them and never runs
 * before they have read what it costs. Meta treats a tag change as a new ad:
 * each one goes back through review, and an ad made from an existing post can
 * only be tagged by giving up that post's likes and comments. We never do that,
 * and the ads it applies to come back named.
 *
 * Shown only on a Not Tracked campaign. The server leaves tagged ads alone, so
 * pressing it again only finishes what is left.
 */
export function StartTrackingBanner({ line }: { line: CampaignRevenueLine }) {
  const [open, setOpen] = React.useState(false);
  const untagged = line.ads.filter((ad) => !ad.hasLinkTags).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-2.5">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">Not tracked</p>
          <p className="text-muted-foreground">
            {line.ads.length === 0
              ? "This campaign has no ads yet, so there is nothing to measure."
              : "Its ads don’t carry our link tags, so the sales they drive can’t be credited here. Spend is still shown."}
          </p>
        </div>
      </div>

      {untagged > 0 && (
        <Button className="shrink-0 gap-2" onClick={() => setOpen(true)}>
          <TagIcon className="h-4 w-4" />
          Start tracking
        </Button>
      )}

      {open && (
        <StartTrackingDialog
          campaignId={line.campaignId}
          untagged={untagged}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function StartTrackingDialog({
  campaignId,
  untagged,
  onClose,
}: {
  campaignId: string;
  untagged: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: () => startCampaignTrackingServerFn({ data: { campaignId } }),
    // The campaign's Tracked flag and its ads' statuses have moved, whatever
    // the outcome, since a partial run keeps what it tagged.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  const close = () => {
    // Not while the platform is being written to: the answer is the only
    // record of which ads were tagged and which were refused.
    if (start.isPending) return;
    onClose();
  };

  const ads = untagged === 1 ? "ad" : "ads";

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-lg" showCloseButton={!start.isPending}>
        {start.data ? (
          <TrackingResult outcome={start.data} onClose={close} />
        ) : (
          <>
            <DialogHeader className="px-5 pt-5 pb-0">
              <DialogTitle>Start tracking this campaign?</DialogTitle>
              <DialogDescription>
                We’ll add our link tags to {untagged} {ads}, so the sales they
                drive are credited to this campaign and to the ad that was
                clicked. Before you go ahead:
              </DialogDescription>
            </DialogHeader>

            <ul className="space-y-3 px-5 text-sm">
              <Warning>
                <strong className="font-medium">
                  Every tagged ad goes back through Meta’s review.
                </strong>{" "}
                Meta treats a tag change as a new version of the ad.
              </Warning>
              <Warning>
                <strong className="font-medium">
                  An ad made from an existing Facebook or Instagram post loses
                  that post’s likes and comments if it is tagged.
                </strong>{" "}
                We won’t do that. Those ads are left as they are and listed
                afterwards, so you can decide what to do with them.
              </Warning>
              <Warning>
                <strong className="font-medium">
                  Only sales from clicks after this are measured.
                </strong>{" "}
                Earlier sales can’t be traced to an ad, so they stay unattributed.
              </Warning>
            </ul>

            {start.error && (
              <p className="mx-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{start.error.message}</span>
              </p>
            )}

            <DialogFooter className="border-t px-5 py-4">
              <Button variant="outline" onClick={close} disabled={start.isPending}>
                Cancel
              </Button>
              <Button
                className="gap-2"
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                {start.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                {start.isPending ? `Tagging ${ads}…` : `Tag ${untagged} ${ads}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="text-muted-foreground [&_strong]:text-foreground">{children}</span>
    </li>
  );
}

/**
 * What happened, per ad. A platform failure is said plainly, and the campaign is
 * only called Tracked when the server says it is.
 */
function TrackingResult({
  outcome,
  onClose,
}: {
  outcome: TrackingOutcome;
  onClose: () => void;
}) {
  const refused = outcome.ads.filter((ad) => ad.result === "refused").length;

  const summary = outcome.tracked
    ? "Every ad now carries our link tags. Sales from new clicks will be credited to this campaign."
    : outcome.message
      ? outcome.message
      : refused > 0
        ? `Meta wouldn’t tag ${refused === 1 ? "one ad" : `${refused} ads`}, so this campaign stays Not tracked. The others are tagged.`
        : "This campaign is still Not tracked.";

  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-0">
        <DialogTitle>
          {outcome.tracked ? "This campaign is now tracked" : "Not every ad could be tagged"}
        </DialogTitle>
        <DialogDescription>{summary}</DialogDescription>
      </DialogHeader>

      <ul className="max-h-80 divide-y overflow-y-auto border-y">
        {outcome.ads.map((ad) => (
          <AdResultRow key={ad.adId} ad={ad} />
        ))}
      </ul>

      <DialogFooter className="px-5 pt-0 pb-4">
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

const RESULT_LABELS: Record<AdTrackingResult["result"], string> = {
  tagged: "Tagged — back in Meta’s review",
  already_tagged: "Already tagged",
  refused: "Not tagged",
  not_attempted: "Not tagged yet — try again shortly",
};

function AdResultRow({ ad }: { ad: AdTrackingResult }) {
  const Icon =
    ad.result === "tagged" || ad.result === "already_tagged"
      ? CheckCircle2Icon
      : ad.result === "refused"
        ? AlertCircleIcon
        : CircleDashedIcon;
  const tone =
    ad.result === "refused"
      ? "text-amber-600 dark:text-amber-400"
      : ad.result === "not_attempted"
        ? "text-muted-foreground"
        : "text-emerald-600 dark:text-emerald-400";

  return (
    <li className="flex items-start gap-2.5 px-5 py-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{ad.name}</p>
        <p className="text-xs text-muted-foreground">{RESULT_LABELS[ad.result]}</p>
        {ad.reason && <p className="text-xs text-muted-foreground">{ad.reason}</p>}
      </div>
    </li>
  );
}
