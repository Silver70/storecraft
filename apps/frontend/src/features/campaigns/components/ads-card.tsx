import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { Ad } from "~/types/api";
import { campaignAdsQueryOptions } from "../queries";
import { CopyButton } from "./copy-button";
import {
  archiveCampaignAdServerFn,
  createCampaignAdServerFn,
  unarchiveCampaignAdServerFn,
  updateCampaignAdServerFn,
} from "../server";

/**
 * The creatives running under one campaign.
 *
 * A campaign may have none, and the empty state says so plainly rather than
 * prompting: an ad is a subdivision a merchant opts into, and a campaign without
 * one reports exactly as it did before ads existed. Nagging here would push
 * merchants into a structure they have no data for.
 *
 * Two things the card has to teach, because both are irreversible and neither is
 * guessable: the ad tag is fixed at creation and survives a rename, and there is
 * no delete — archiving is the only way to retire a creative.
 */
export function AdsCard({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = React.useState(false);

  const { data: ads = [], isPending } = useQuery(
    campaignAdsQueryOptions(campaignId, showArchived ? "all" : "active"),
  );

  const [name, setName] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Every list under this campaign, so a status change is reflected whichever
  // filter is showing.
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["campaigns", "detail", campaignId, "ads"],
    });

  const addMutation = useMutation({
    mutationFn: () =>
      createCampaignAdServerFn({
        data: {
          campaignId,
          name: name.trim(),
          startsAt: startsAt || undefined,
          endsAt: endsAt || undefined,
        },
      }),
    onSuccess: () => {
      setName("");
      setStartsAt("");
      setEndsAt("");
      setError(null);
      void invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const canAdd = name.trim().length > 0 && !addMutation.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b pb-4">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ads
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowArchived((shown) => !shown)}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <p className="text-xs text-muted-foreground">
          An ad is one creative running under this campaign, so you can tell two
          variants of the same push apart. Each one gets its own{" "}
          <code>utm_content</code> tag, unique within this campaign — every
          campaign is free to run a <code>video-a</code>.
        </p>

        {isPending ? (
          <p className="text-xs text-muted-foreground">Loading ads…</p>
        ) : ads.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
            {showArchived
              ? "No ads on this campaign."
              : "No ads on this campaign. Add one to measure a single creative separately — a campaign without ads reports exactly as it does now."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {ads.map((ad) => (
              <AdRow
                key={ad.id}
                campaignId={campaignId}
                ad={ad}
                onChanged={invalidate}
              />
            ))}
          </ul>
        )}

        {/* ── Add an ad ───────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor="ad-name">Add an ad</Label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1 space-y-1.5">
              <Input
                id="ad-name"
                placeholder="Beach video A"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAdd) addMutation.mutate();
                }}
              />
            </div>

            {/* Both optional, and either may be set alone: a merchant often
                knows when a test started and not when it will stop. */}
            <div className="space-y-1.5">
              <Label
                htmlFor="ad-starts-at"
                className="text-xs text-muted-foreground"
              >
                Runs from
              </Label>
              <Input
                id="ad-starts-at"
                type="date"
                className="w-40"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="ad-ends-at"
                className="text-xs text-muted-foreground"
              >
                To
              </Label>
              <Input
                id="ad-ends-at"
                type="date"
                className="w-40"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>

            <Button
              type="button"
              className="gap-1.5"
              disabled={!canAdd}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? (
                <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlusIcon className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <p className="text-xs text-muted-foreground">
            The ad tag is set from the name when the ad is created and does not
            change if you rename it, so a link already running in an ad platform
            keeps matching. Ads are archived rather than deleted, for the same
            reason campaigns are.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * `startsAt` and `endsAt` come back as ISO timestamps at UTC midnight. Slicing
 * the string is deliberate: reading them through the browser's timezone would
 * show a merchant west of UTC the day before the one they typed.
 */
function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function formatFlight(ad: Ad): string | null {
  const from = toDateInput(ad.startsAt);
  const to = toDateInput(ad.endsAt);
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return null;
}

function AdRow({
  campaignId,
  ad,
  onChanged,
}: {
  campaignId: string;
  ad: Ad;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(ad.name);
  const [startsAt, setStartsAt] = React.useState(toDateInput(ad.startsAt));
  const [endsAt, setEndsAt] = React.useState(toDateInput(ad.endsAt));
  const [error, setError] = React.useState<string | null>(null);

  const archived = ad.status === "archived";

  const saveMutation = useMutation({
    mutationFn: () =>
      updateCampaignAdServerFn({
        data: {
          campaignId,
          adId: ad.id,
          name: name.trim(),
          // Null clears a date the merchant has emptied; omitting it would
          // leave the old one in place, which is a different instruction.
          startsAt: startsAt || null,
          endsAt: endsAt || null,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err.message),
  });

  const statusMutation = useMutation({
    mutationFn: () =>
      archived
        ? unarchiveCampaignAdServerFn({ data: { campaignId, adId: ad.id } })
        : archiveCampaignAdServerFn({ data: { campaignId, adId: ad.id } }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err.message),
  });

  function cancel() {
    setName(ad.name);
    setStartsAt(toDateInput(ad.startsAt));
    setEndsAt(toDateInput(ad.endsAt));
    setError(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-2 px-3 py-3">
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="min-w-[180px] flex-1"
            value={name}
            aria-label={`Name of ${ad.name}`}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            type="date"
            className="w-40"
            value={startsAt}
            aria-label={`Start date of ${ad.name}`}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          <Input
            type="date"
            className="w-40"
            value={endsAt}
            aria-label={`End date of ${ad.name}`}
            onChange={(e) => setEndsAt(e.target.value)}
          />
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Save ad"
            disabled={name.trim().length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckIcon className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Cancel"
            onClick={cancel}
          >
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        {/* The one thing a rename cannot change, said where it is being done. */}
        <p className="text-xs text-muted-foreground">
          Renaming keeps the tag <code>{ad.tag}</code>.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </li>
    );
  }

  const flight = formatFlight(ad);

  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex items-center gap-3 text-sm">
        <span
          className={`min-w-0 truncate ${archived ? "text-muted-foreground" : ""}`}
        >
          {ad.name}
        </span>

        <code className="shrink-0 font-mono text-xs text-muted-foreground">
          {ad.tag}
        </code>
        <CopyButton value={ad.tag} label="ad tag" />

        {flight && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {flight}
          </span>
        )}

        <span className="flex-1" />

        {archived && (
          <span className="shrink-0 text-xs text-muted-foreground">
            Archived
          </span>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Edit ${ad.name}`}
          onClick={() => setEditing(true)}
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>

        {/* There is no delete: revenue already reported against an ad would be
            silently re-bucketed by removing it. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={archived ? `Restore ${ad.name}` : `Archive ${ad.name}`}
          disabled={statusMutation.isPending}
          onClick={() => statusMutation.mutate()}
        >
          {statusMutation.isPending ? (
            <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
          ) : archived ? (
            <ArchiveRestoreIcon className="h-3.5 w-3.5" />
          ) : (
            <ArchiveIcon className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}
