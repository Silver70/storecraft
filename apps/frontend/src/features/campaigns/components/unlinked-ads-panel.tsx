import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  ImageIcon,
  LinkIcon,
  LoaderCircleIcon,
  UndoIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatMoney } from "~/lib/money";
import type { Campaign, UnlinkedAd, UnlinkedAdClaimResult } from "~/types/api";
import { campaignAdsQueryOptions, unlinkedAdsQueryOptions } from "../queries";
import { claimUnlinkedAdServerFn, moveUnlinkedAdServerFn } from "../server";
import { CopyButton } from "./copy-button";

/**
 * The ads a platform is spending on that nothing in this store claims.
 *
 * This is where the whole ad-platform integration earns its keep. A sync can
 * tell a merchant an ad spent $2,675; only a link carrying the ad tag can tell
 * them what it sold. So the list is not a tidy-up queue — it is the prompt that
 * turns platform spend into something measurable, and the tagged link is handed
 * over at the moment the merchant makes the decision that creates the need for
 * it.
 *
 * **Nothing here was created automatically.** An ad invented from a sync would
 * carry real cost and have no tag rule, so it would show spend against zero
 * revenue and read as the worst performer in the account. Every row is a
 * question, and every answer is the merchant's.
 */
export function UnlinkedAdsPanel({
  campaigns,
  waiting,
}: {
  campaigns: Campaign[];
  /** The count read beside the grid, so the panel opens knowing its own size. */
  waiting: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [showDismissed, setShowDismissed] = React.useState(false);

  // Nothing waiting and nothing dismissed is not an empty state worth drawing:
  // a store with no connected platform would otherwise carry a permanent card
  // about a feature it does not use.
  if (waiting === 0 && !open) return null;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2.5">
          <LinkIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Unlinked ads</span>
          {waiting > 0 && <Badge variant="default">{waiting}</Badge>}
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            Your ad platform is spending on these and nothing here claims them,
            so their cost is not counted against any campaign. Claim one onto a
            campaign and every figure already pulled for it — including the
            history from before you connected — comes with it. None of them was
            turned into an ad automatically: one created that way would carry
            real cost with no way to earn revenue.
          </p>

          <UnlinkedList
            state="pending"
            campaigns={campaigns}
            emptyMessage="Nothing waiting. Every ad your platform is spending on is claimed or dismissed."
          />

          <div className="border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setShowDismissed((v) => !v)}
            >
              {showDismissed ? "Hide" : "Show"} dismissed
            </Button>
            {showDismissed && (
              <div className="mt-3">
                <UnlinkedList
                  state="dismissed"
                  campaigns={campaigns}
                  emptyMessage="Nothing dismissed."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function UnlinkedList({
  state,
  campaigns,
  emptyMessage,
}: {
  state: "pending" | "dismissed";
  campaigns: Campaign[];
  emptyMessage: string;
}) {
  const { data, isPending } = useQuery(unlinkedAdsQueryOptions(state));

  if (isPending) {
    return (
      <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </p>
    );
  }

  if (!data || data.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-3">
      {data.map((row) => (
        <li key={row.id}>
          <UnlinkedAdRow unlinked={row} campaigns={campaigns} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One ad, with what it costs and the two things a merchant can do about it.
 *
 * The spend is the reason the row is worth reading at all, so it is the only
 * figure given emphasis. It is in the ad account's currency, which is not
 * necessarily the store's and is never converted into it — so it is always
 * shown with its own currency beside it.
 */
function UnlinkedAdRow({
  unlinked,
  campaigns,
}: {
  unlinked: UnlinkedAd;
  campaigns: Campaign[];
}) {
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = React.useState(false);
  const [claimed, setClaimed] = React.useState<UnlinkedAdClaimResult | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["unlinked-ads"] });

  const move = useMutation({
    mutationFn: (action: "dismiss" | "restore" | "unlink") =>
      moveUnlinkedAdServerFn({
        data: { unlinkedAdId: unlinked.id, action },
      }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  // A claim resolved the row, so the card stays on screen showing what to do
  // next rather than disappearing the moment the decision is made. The link is
  // the merchant's actual next action; vanishing would take it with it.
  if (claimed) {
    return <ClaimedRow result={claimed} onDone={refresh} />;
  }

  return (
    <div className="flex gap-3 rounded-lg border p-3">
      <Creative url={unlinked.creativeUrl} name={unlinked.name} />

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {unlinked.name ?? "Unnamed ad"}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {unlinked.platform} · {unlinked.externalAdId}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">
              {unlinked.currency
                ? formatMoney(unlinked.spendToDate, unlinked.currency)
                : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {unlinked.days === 0
                ? "no figures yet"
                : `over ${unlinked.days} day${unlinked.days === 1 ? "" : "s"}`}
              {unlinked.currency ? ` · ${unlinked.currency}` : ""}
            </p>
          </div>
        </div>

        <Flight startsAt={unlinked.startsAt} endsAt={unlinked.endsAt} />

        {error && <p className="text-xs text-destructive">{error}</p>}

        {claiming ? (
          <ClaimForm
            unlinked={unlinked}
            campaigns={campaigns}
            onCancel={() => setClaiming(false)}
            onClaimed={(result) => {
              setClaiming(false);
              setClaimed(result);
              refresh();
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {unlinked.state === "pending" ? (
              <>
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setClaiming(true)}
                  disabled={campaigns.length === 0}
                >
                  Claim
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                  onClick={() => move.mutate("dismiss")}
                  disabled={move.isPending}
                >
                  <XIcon className="h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => move.mutate("restore")}
                  disabled={move.isPending}
                >
                  <UndoIcon className="h-3.5 w-3.5" />
                  Put back
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setClaiming(true)}
                  disabled={campaigns.length === 0}
                >
                  Claim
                </Button>
              </>
            )}
            {campaigns.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                Create a campaign first — an ad belongs under one.
              </span>
            )}
            {/* Its figures stay pulled and readable either way. Dismissing
                declines to attribute the money, not to know about it. */}
            {unlinked.state === "dismissed" && (
              <span className="text-[11px] text-muted-foreground">
                Dismissed. Its figures are still recorded, just not against any
                campaign.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Which campaign this belongs to, and whether it is an ad we already have.
 *
 * The campaign is required on both paths, because an ad has no meaning outside
 * one. The ad picker is a second, optional step: most claims create a new ad,
 * and the case where the merchant already built this creative here is real but
 * rarer.
 */
function ClaimForm({
  unlinked,
  campaigns,
  onCancel,
  onClaimed,
}: {
  unlinked: UnlinkedAd;
  campaigns: Campaign[];
  onCancel: () => void;
  onClaimed: (result: UnlinkedAdClaimResult) => void;
}) {
  const [campaignId, setCampaignId] = React.useState(campaigns[0]?.id ?? "");
  const [adId, setAdId] = React.useState<string>("");
  const [name, setName] = React.useState(unlinked.name ?? "");
  const [error, setError] = React.useState<string | null>(null);

  // Only the chosen campaign's ads: an ad is resolved among its own campaign's
  // ads and never across siblings, and offering the rest would suggest
  // otherwise.
  const { data: existingAds } = useQuery({
    ...campaignAdsQueryOptions(campaignId, "active"),
    enabled: campaignId.length > 0,
  });

  const claim = useMutation({
    mutationFn: () =>
      claimUnlinkedAdServerFn({
        data: {
          unlinkedAdId: unlinked.id,
          campaignId,
          ...(adId ? { adId } : {}),
          ...(adId || !name.trim() ? {} : { name: name.trim() }),
        },
      }),
    onSuccess: onClaimed,
    onError: (err: Error) => setError(err.message),
  });

  const unclaimed = (existingAds ?? []).filter((ad) => !ad.externalId);

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Campaign</Label>
          <Select
            value={campaignId}
            onValueChange={(value) => {
              setCampaignId(value);
              setAdId("");
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Choose a campaign" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Ad</Label>
          <Select
            value={adId === "" ? "__new__" : adId}
            onValueChange={(value) => setAdId(value === "__new__" ? "" : value)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">Create a new ad</SelectItem>
              {unclaimed.map((ad) => (
                <SelectItem key={ad.id} value={ad.id}>
                  {ad.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {adId === "" && (
        <div className="space-y-1.5">
          <Label htmlFor={`claim-name-${unlinked.id}`} className="text-xs">
            Name it
          </Label>
          <Input
            id={`claim-name-${unlinked.id}`}
            className="h-8 text-xs"
            value={name}
            placeholder={unlinked.name ?? "Untitled ad"}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Its tag is derived from this name once and never changes, because a
            link already running in an ad platform cannot be recalled.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 gap-1.5 px-3 text-xs"
          onClick={() => claim.mutate()}
          disabled={claim.isPending || campaignId === ""}
        >
          {claim.isPending && (
            <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
          )}
          Claim it
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={onCancel}
          disabled={claim.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * What the merchant sees the moment a claim lands.
 *
 * The link is the substance of this card, not a confirmation decorating it: the
 * ad is now claimed, its history is attached, and the only thing still standing
 * between the merchant and a measurable ad is pasting this into the platform.
 * An ad claimed onto a campaign whose link never goes out reports cost against
 * no revenue for as long as it runs.
 */
function ClaimedRow({
  result,
  onDone,
}: {
  result: UnlinkedAdClaimResult;
  onDone: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            Claimed as {result.ad.name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {result.attached.days === 0
              ? "No figures pulled for it yet."
              : `${result.attached.days} day${
                  result.attached.days === 1 ? "" : "s"
                } of reported spend came with it — ${
                  result.attached.currency
                    ? formatMoney(
                        result.attached.spend,
                        result.attached.currency,
                      )
                    : "—"
                }, including anything backfilled.`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={onDone}
        >
          Done
        </Button>
      </div>

      {result.taggedLink ? (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Paste this into the ad on the platform. It carries the campaign tag
            and <code className="font-mono">utm_content={result.ad.tag}</code>,
            which is the only thing that will credit what this ad sells back to
            it.
          </p>
          <div className="rounded-md border bg-background px-2.5 py-2">
            <code className="block break-all font-mono text-[11px] leading-relaxed">
              {result.taggedLink.url}
            </code>
          </div>
          <CopyButton
            value={result.taggedLink.url}
            label="tagged link"
            variant="outline"
          >
            Copy link
          </CopyButton>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {result.taggedLinkProblem ??
            "Build a tagged link from this ad's card to make it measurable."}
        </p>
      )}
    </div>
  );
}

/** The picture, or the designed empty tile the rest of this screen uses. */
function Creative({ url, name }: { url: string | null; name: string | null }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted/30">
        <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name ?? "Ad creative"}
      className="h-14 w-14 shrink-0 rounded-md border object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/** When the platform says it ran. Either end may be missing, and often is. */
function Flight({
  startsAt,
  endsAt,
}: {
  startsAt: string | null;
  endsAt: string | null;
}) {
  if (!startsAt && !endsAt) return null;
  const format = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <p className="text-[11px] text-muted-foreground">
      {startsAt ? format(startsAt) : "?"} → {endsAt ? format(endsAt) : "no end"}
    </p>
  );
}
