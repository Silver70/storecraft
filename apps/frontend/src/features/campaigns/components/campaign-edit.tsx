import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ImageIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import { formatMoney, toCents } from "~/lib/money";
import type {
  AdPerformanceLine,
  Campaign,
  CampaignFormContext,
  DraftComplaint,
  DraftField,
  UpdateCampaignInput,
} from "~/types/api";
import {
  AdEditor,
  Complaints,
  UploadPicker,
  adGaps,
  emptyAd,
  toAdInput,
  type AdDraftState,
} from "./campaign-ad-editor";
import { CreativeTile } from "./campaign-cards";
import {
  addCampaignAdServerFn,
  setAdDeliveryServerFn,
  setCampaignCoverServerFn,
  setCampaignDeliveryServerFn,
  updateCampaignServerFn,
  type CampaignEditResult,
} from "../server";

/**
 * Changing a running campaign, from its own page.
 *
 * Every change but the cover is made at Meta first, and this page shows it the
 * moment Meta accepts it. A change Meta refuses changes nothing, and its words
 * are shown where they belong. What is not offered is deliberate: the audience
 * and the goal would reset what Meta has learned, and an existing ad's picture
 * or copy would send it back through review and lose its engagement. The way to
 * refresh a creative is to add a new ad and pause the old one.
 */

/** Something a change said that belongs on the page rather than in a dialog. */
export type EditNotice = { message: string; complaints: DraftComplaint[] };

/** Refetches everything a change can move: the campaign, its figures, the grid. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["campaigns"] });
}

/**
 * Why the budget cannot be changed here, or null when it can. The same rule the
 * server applies, so the field is disabled with the reason rather than refused
 * after Save.
 */
export function budgetLockedReason(campaign: Campaign): string | null {
  if (campaign.budgetLevel === "ad_set") {
    return "This campaign’s budget is set on each of its ad sets. Change it in Meta Ads Manager.";
  }
  if (campaign.budgetLevel === null) {
    return "This campaign’s budget hasn’t been read from Meta yet. Refresh, then try again.";
  }
  if (campaign.dailyBudget === null) {
    return "This campaign has a lifetime budget rather than a daily one. Change it in Meta Ads Manager.";
  }
  return null;
}

/** The last day an end instant covers, in the store's calendar. */
function endDayOf(endsAt: string | null, timezone: string): string {
  if (!endsAt) return "";
  // The end is the midnight after the last day, so the day before it is the one.
  const lastMoment = new Date(new Date(endsAt).getTime() - 1);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(lastMoment);
  } catch {
    return lastMoment.toISOString().slice(0, 10);
  }
}

function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

// ─── Name, budget, end date ───────────────────────────────────────────────────

export function EditCampaignButton({
  campaign,
  context,
}: {
  campaign: Campaign;
  context: CampaignFormContext;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <PencilIcon className="h-4 w-4" />
        Edit
      </Button>
      {open && (
        <EditCampaignDialog
          campaign={campaign}
          context={context}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EditCampaignDialog({
  campaign,
  context,
  onClose,
}: {
  campaign: Campaign;
  context: CampaignFormContext;
  onClose: () => void;
}) {
  const refresh = useRefresh();
  const locked = budgetLockedReason(campaign);
  const initialEnd = endDayOf(campaign.endsAt, context.timezone);

  const [name, setName] = React.useState(campaign.name);
  const [budget, setBudget] = React.useState(centsToInput(campaign.dailyBudget));
  const [hasEnd, setHasEnd] = React.useState(initialEnd !== "");
  const [endDate, setEndDate] = React.useState(initialEnd);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [complaints, setComplaints] = React.useState<DraftComplaint[]>([]);

  /** Only what differs from what is there, so nothing else is sent to Meta. */
  function changes(): UpdateCampaignInput {
    const out: UpdateCampaignInput = {};
    if (name.trim() !== campaign.name) out.name = name.trim();
    if (!locked && toCents(budget) !== campaign.dailyBudget) {
      out.dailyBudget = toCents(budget);
    }
    const end = hasEnd ? endDate : "";
    if (end !== initialEnd) out.endDate = end || null;
    return out;
  }

  const save = useMutation({
    mutationFn: (input: UpdateCampaignInput) =>
      updateCampaignServerFn({ data: { campaignId: campaign.id, changes: input } }),
    onSuccess: async (result) => {
      // Part of a change can have landed before Meta refused the rest, so the
      // page is refetched whatever the answer.
      await refresh();
      if (result.ok) {
        onClose();
        return;
      }
      setSummary(result.message);
      setComplaints(result.complaints);
    },
    onError: (err) => {
      setSummary(err.message);
      setComplaints([]);
    },
  });

  function submit() {
    const gaps: DraftComplaint[] = [];
    const add = (field: DraftField, message: string) =>
      gaps.push({ adIndex: null, field, message });
    if (!name.trim()) add("name", "Name the campaign.");
    if (!locked && toCents(budget) < 1) add("dailyBudget", "Set a daily budget.");
    if (hasEnd && !endDate) add("schedule", "Choose the end date, or remove it.");
    if (gaps.length) {
      setSummary("A few things are missing.");
      setComplaints(gaps);
      return;
    }
    const input = changes();
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    setSummary(null);
    setComplaints([]);
    save.mutate(input);
  }

  const about = (field: DraftField) => complaints.filter((c) => c.field === field);
  const unplaced = complaints.filter((c) => c.field === null);
  const busy = save.isPending;
  const budgetChanged = !locked && toCents(budget) !== campaign.dailyBudget;

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-lg" showCloseButton={!busy}>
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>
            Changes are made on Meta straight away. To try a new picture or new
            copy, add an ad and pause the old one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5">
          {summary && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">{summary}</p>
                {unplaced.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {unplaced.map((c, i) => (
                      <li key={i}>{c.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
            />
            <p className="text-xs text-muted-foreground">
              Renaming keeps every sale it has already been credited with.
            </p>
            <Complaints items={about("name")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-budget">Daily budget</Label>
            <div
              className={cn(
                "flex items-center rounded-md border bg-background pl-3 text-sm",
                locked && "opacity-60",
              )}
            >
              <span className="text-muted-foreground">{context.currency}</span>
              <Input
                id="edit-budget"
                inputMode="decimal"
                value={budget}
                disabled={locked !== null}
                onChange={(e) => setBudget(e.target.value)}
                placeholder={locked ? "" : "20.00"}
                className="border-0 shadow-none focus-visible:ring-0"
              />
            </div>
            {locked ? (
              <p className="text-xs text-muted-foreground">{locked}</p>
            ) : budgetChanged && toCents(budget) > 0 ? (
              <p className="text-xs text-muted-foreground">
                From {formatMoney(campaign.dailyBudget ?? 0, context.currency)} to{" "}
                {formatMoney(toCents(budget), context.currency)} a day, from the
                moment you save.
              </p>
            ) : null}
            <Complaints items={about("dailyBudget")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-end">Ends</Label>
            {hasEnd ? (
              <div className="flex gap-1">
                <Input
                  id="edit-end"
                  type="date"
                  min={todayIn(context.timezone)}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs"
                  onClick={() => {
                    setHasEnd(false);
                    setEndDate("");
                  }}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full justify-start font-normal text-muted-foreground"
                onClick={() => setHasEnd(true)}
              >
                No end date — runs until paused
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              In the store’s timezone, {context.timezone}. The end date is spent
              in full.
            </p>
            <Complaints items={about("schedule")} />
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit} className="gap-2">
            {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pause and resume ─────────────────────────────────────────────────────────

/**
 * Pause stops spending at once, so it asks nothing. Resume starts spending
 * again, so it says how much first.
 */
export function CampaignDeliveryButton({
  campaign,
  currency,
  onNotice,
}: {
  campaign: Campaign;
  currency: string;
  onNotice: (notice: EditNotice | null) => void;
}) {
  const refresh = useRefresh();
  const [confirming, setConfirming] = React.useState(false);
  const paused = campaign.status === "paused";

  const flip = useMutation({
    mutationFn: (status: "active" | "paused") =>
      setCampaignDeliveryServerFn({ data: { campaignId: campaign.id, status } }),
    onSuccess: async (result) => {
      setConfirming(false);
      onNotice(result.ok ? null : result);
      await refresh();
    },
    onError: (err) => {
      setConfirming(false);
      onNotice({ message: err.message, complaints: [] });
    },
  });

  if (campaign.status === "ended") return null;

  return (
    <>
      {paused ? (
        <Button
          variant="outline"
          className="gap-2"
          disabled={flip.isPending}
          onClick={() => setConfirming(true)}
        >
          <PlayIcon className="h-4 w-4" />
          Resume
        </Button>
      ) : (
        <Button
          variant="outline"
          className="gap-2"
          disabled={flip.isPending}
          onClick={() => flip.mutate("paused")}
        >
          {flip.isPending ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <PauseIcon className="h-4 w-4" />
          )}
          Pause
        </Button>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !flip.isPending && setConfirming(open)}>
        <DialogContent className="max-w-md" showCloseButton={!flip.isPending}>
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle>Resume this campaign?</DialogTitle>
            <DialogDescription>
              {campaign.dailyBudget !== null
                ? `It starts spending again, up to ${formatMoney(campaign.dailyBudget, currency)} a day.`
                : "It starts spending again, on the budget set in Meta Ads Manager."}{" "}
              Ads you paused one by one stay paused.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-5 pb-5">
            <Button
              variant="outline"
              disabled={flip.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={flip.isPending}
              onClick={() => flip.mutate("active")}
              className="gap-2"
            >
              {flip.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
              Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Pause or resume one ad, leaving its siblings as they are. */
export function AdDeliveryToggle({
  campaignId,
  ad,
  onNotice,
}: {
  campaignId: string;
  ad: AdPerformanceLine;
  onNotice: (notice: EditNotice | null) => void;
}) {
  const refresh = useRefresh();
  const flip = useMutation({
    mutationFn: (status: "active" | "paused") =>
      setAdDeliveryServerFn({ data: { campaignId, adId: ad.adId, status } }),
    onSuccess: async (result: CampaignEditResult<Campaign>) => {
      onNotice(
        result.ok
          ? null
          : { ...result, message: `${ad.name}: ${result.message}` },
      );
      await refresh();
    },
    onError: (err) => onNotice({ message: err.message, complaints: [] }),
  });

  if (ad.status === "ended") return null;
  const paused = ad.status === "paused";

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      disabled={flip.isPending}
      onClick={() => flip.mutate(paused ? "active" : "paused")}
      title={paused ? "Resume this ad" : "Pause this ad"}
    >
      {flip.isPending ? (
        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
      ) : paused ? (
        <PlayIcon className="h-3.5 w-3.5" />
      ) : (
        <PauseIcon className="h-3.5 w-3.5" />
      )}
      {paused ? "Resume" : "Pause"}
    </Button>
  );
}

// ─── Adding an ad ─────────────────────────────────────────────────────────────

export function AddAdButton({
  campaign,
  context,
}: {
  campaign: Campaign;
  context: CampaignFormContext;
}) {
  const [open, setOpen] = React.useState(false);
  if (campaign.status === "ended") return null;
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <PlusIcon className="h-4 w-4" />
        Add an ad
      </Button>
      {open && (
        <AddAdDialog campaign={campaign} context={context} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * The create form's ad editor, for one more ad. It joins the campaign's
 * audience, budget and schedule as they are, and is measured from its first
 * click like every ad made here.
 */
function AddAdDialog({
  campaign,
  context,
  onClose,
}: {
  campaign: Campaign;
  context: CampaignFormContext;
  onClose: () => void;
}) {
  const refresh = useRefresh();
  const [ad, setAd] = React.useState<AdDraftState>(emptyAd);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [complaints, setComplaints] = React.useState<DraftComplaint[]>([]);
  // Kept when the request failed without an answer, so pressing again cannot
  // add a second ad; replaced once the server has answered about this draft.
  const idempotencyKey = React.useRef(crypto.randomUUID());

  const add = useMutation({
    mutationFn: () =>
      addCampaignAdServerFn({
        data: {
          campaignId: campaign.id,
          idempotencyKey: idempotencyKey.current,
          ad: toAdInput(ad),
        },
      }),
    onSuccess: async (result) => {
      idempotencyKey.current = crypto.randomUUID();
      if (result.ok) {
        await refresh();
        onClose();
        return;
      }
      setSummary(result.message);
      setComplaints(result.complaints);
    },
    onError: (err) => {
      setSummary(err.message);
      setComplaints([]);
    },
  });

  function submit() {
    const gaps = adGaps(ad, 0);
    if (gaps.length) {
      setSummary("A few things are missing.");
      setComplaints(gaps);
      return;
    }
    setSummary(null);
    setComplaints([]);
    add.mutate();
  }

  const busy = add.isPending;
  const live = campaign.status !== "paused";

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle>Add an ad</DialogTitle>
          <DialogDescription>
            It reaches the same people on the same budget and dates as the
            campaign’s other ads.{" "}
            {live
              ? "Meta reviews it, then starts showing it."
              : "The campaign is paused, so it waits with the rest until you resume."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5">
          {!context.canBuildLinks && (
            <p className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              Ads link to your storefront, and this store doesn’t say where its
              storefront is yet. Set the storefront URL in Settings first.
            </p>
          )}
          {summary && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="font-medium">{summary}</span>
            </p>
          )}
          <AdEditor
            index={0}
            title="New ad"
            ad={ad}
            storefrontUrl={context.storefrontUrl}
            complaints={complaints}
            onChange={setAd}
            onRemove={null}
          />
        </div>

        <DialogFooter className="border-t px-5 py-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !context.canBuildLinks} onClick={submit} className="gap-2">
            {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Add ad
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── The cover ────────────────────────────────────────────────────────────────

/**
 * The picture the campaign is recognised by on the grid: one of its own ads'
 * pictures, or an upload. Ours alone — Meta has no cover, so nothing is sent.
 */
export function CoverPickerButton({
  campaignId,
  coverUrl,
  ads,
}: {
  campaignId: string;
  coverUrl: string | null;
  ads: AdPerformanceLine[];
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="gap-1.5 shadow-sm"
        onClick={() => setOpen(true)}
      >
        <ImageIcon className="h-3.5 w-3.5" />
        Change cover
      </Button>
      {open && (
        <CoverDialog
          campaignId={campaignId}
          coverUrl={coverUrl}
          ads={ads}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CoverDialog({
  campaignId,
  coverUrl,
  ads,
  onClose,
}: {
  campaignId: string;
  coverUrl: string | null;
  ads: AdPerformanceLine[];
  onClose: () => void;
}) {
  const refresh = useRefresh();
  const choices = ads.filter((ad) => ad.creativeUrl);

  const choose = useMutation({
    mutationFn: (cover: { adId: string } | { uploadUrl: string }) =>
      setCampaignCoverServerFn({ data: { campaignId, cover } }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(next) => !next && !choose.isPending && onClose()}>
      <DialogContent className="max-w-lg" showCloseButton={!choose.isPending}>
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle>Choose the cover</DialogTitle>
          <DialogDescription>
            The picture this campaign is recognised by in the list. Meta never
            sees it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-5">
          {choices.length > 0 && (
            <div className="space-y-2">
              <Label>From its ads</Label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {choices.map((ad) => (
                  <button
                    key={ad.adId}
                    type="button"
                    disabled={choose.isPending}
                    onClick={() => choose.mutate({ adId: ad.adId })}
                    className={cn(
                      "overflow-hidden rounded-md transition hover:ring-2 hover:ring-ring",
                      ad.creativeUrl === coverUrl && "ring-2 ring-primary",
                    )}
                    title={ad.name}
                  >
                    <CreativeTile
                      src={ad.creativeUrl}
                      name={ad.name}
                      className="aspect-square h-auto w-full rounded-md"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Or upload one</Label>
            <UploadPicker
              imagesOnly
              onUploaded={(media) => {
                if (media?.source === "upload") {
                  choose.mutate({ uploadUrl: media.url });
                }
              }}
            />
          </div>

          {choose.isPending && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </p>
          )}
          {choose.error && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
              {choose.error.message}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── The page-level notice ────────────────────────────────────────────────────

/** A refusal from a button outside any dialog, said once, near the top. */
export function EditNoticeBanner({
  notice,
  onDismiss,
}: {
  notice: EditNotice;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">{notice.message}</p>
          {notice.complaints.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {notice.complaints.map((c, i) => (
                <li key={i}>{c.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
