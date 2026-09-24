import * as React from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  InfoIcon,
  Loader2Icon,
  PlusIcon,
  SendIcon,
} from "lucide-react";

import { CountryPicker } from "~/components/country-picker";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatMoney, toCents } from "~/lib/money";
import type {
  CampaignFormContext,
  CreateCampaignInput,
  DraftComplaint,
  DraftField,
} from "~/types/api";
import {
  AdEditor,
  Complaints,
  adGaps,
  emptyAd,
  toAdInput,
  type AdDraftState,
} from "../components/campaign-ad-editor";
import { metaConnection } from "../components/meta-connection";
import {
  adPlatformConnectionsQueryOptions,
  campaignFormContextQueryOptions,
} from "../queries";
import { createCampaignServerFn } from "../server";

const MAX_ADS = 6;
const AGES = Array.from({ length: 65 - 18 + 1 }, (_, i) => 18 + i);

/** Today, as the store's calendar has it. */
function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Create a campaign, without leaving the admin.
 *
 * One form, and what is not on it is deliberate: the goal is always Sales, the
 * placements are Meta's automatic ones, bidding is Meta's default, and there is
 * one ad set with the budget on the campaign. A merchant chooses the money, the
 * dates, where and to whom, and the ads.
 *
 * Nothing here decides whether the campaign is valid. The server checks it
 * against its own rules and against Meta's dry run before anything is created,
 * and every complaint comes back placed on the field it is about. The one
 * thing the page adds is a pause before Publish, because that starts spending.
 */
export function CampaignNewPage() {
  const connection = metaConnection(
    useSuspenseQuery(adPlatformConnectionsQueryOptions()).data,
  );
  const context = useSuspenseQuery(campaignFormContextQueryOptions()).data;

  if (connection?.status !== "connected") {
    return (
      <Shell>
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="text-sm font-medium">Meta isn’t connected</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {connection?.status === "disconnected"
              ? "Meta was disconnected from this store, so nothing can be created until it is connected again."
              : "A campaign is created on this store’s Meta ad account, so connect one first."}
          </p>
          <Button asChild variant="outline">
            <Link to="/admin/campaigns">Back to campaigns</Link>
          </Button>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <CampaignForm context={context} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <div className="space-y-3">
        <Link
          to="/admin/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Campaigns
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New campaign</h1>
          <p className="text-sm text-muted-foreground">
            On Meta, optimised for sales. Every ad is measured from its first click.
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function CampaignForm({ context }: { context: CampaignFormContext }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = todayIn(context.timezone);

  const [name, setName] = React.useState("");
  const [budget, setBudget] = React.useState("");
  const [startDate, setStartDate] = React.useState(today);
  const [hasEnd, setHasEnd] = React.useState(false);
  const [endDate, setEndDate] = React.useState("");
  const [countries, setCountries] = React.useState<string[]>([]);
  const [ageMin, setAgeMin] = React.useState(18);
  const [ageMax, setAgeMax] = React.useState(65);
  const [ads, setAds] = React.useState<AdDraftState[]>([emptyAd()]);

  const [complaints, setComplaints] = React.useState<DraftComplaint[]>([]);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  // One key per submission of one draft. Kept when the request failed without
  // an answer, so pressing again cannot make a second campaign. Replaced once
  // the server has answered about this draft, because the next press will
  // send a different one.
  const idempotencyKey = React.useRef(crypto.randomUUID());

  const create = useMutation({
    mutationFn: (launch: "active" | "paused") =>
      createCampaignServerFn({
        data: {
          idempotencyKey: idempotencyKey.current,
          campaign: toInput(launch),
        },
      }),
    onSuccess: async (result) => {
      idempotencyKey.current = crypto.randomUUID();
      setConfirming(false);
      if (!result.ok) {
        setSummary(result.message);
        setComplaints(result.complaints);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await navigate({
        to: "/admin/campaigns/$campaignId",
        params: { campaignId: result.outcome.campaignId },
      });
    },
    onError: (err) => {
      setConfirming(false);
      setSummary(err.message);
      setComplaints([]);
    },
  });

  function toInput(launch: "active" | "paused"): CreateCampaignInput {
    return {
      name: name.trim(),
      dailyBudget: toCents(budget),
      startDate,
      endDate: hasEnd && endDate ? endDate : null,
      countries,
      ageMin,
      ageMax,
      launch,
      ads: ads.map(toAdInput),
    };
  }

  /** What can be seen to be missing without asking anyone. */
  function missing(): DraftComplaint[] {
    const out: DraftComplaint[] = [];
    const add = (adIndex: number | null, field: DraftField, message: string) =>
      out.push({ adIndex, field, message });
    if (!name.trim()) add(null, "name", "Name the campaign.");
    if (toCents(budget) < 1) add(null, "dailyBudget", "Set a daily budget.");
    if (hasEnd && !endDate) add(null, "schedule", "Choose the end date, or remove it.");
    if (countries.length === 0) add(null, "audience", "Choose at least one country.");
    ads.forEach((ad, i) => out.push(...adGaps(ad, i)));
    return out;
  }

  function submit(launch: "active" | "paused") {
    const gaps = missing();
    if (gaps.length) {
      setSummary("A few things are missing.");
      setComplaints(gaps);
      return;
    }
    setSummary(null);
    setComplaints([]);
    if (launch === "active") {
      setConfirming(true);
      return;
    }
    create.mutate("paused");
  }

  const campaignWide = (field: DraftField) =>
    complaints.filter((c) => c.adIndex === null && c.field === field);
  const unplaced = complaints.filter((c) => c.adIndex === null && c.field === null);
  const busy = create.isPending;
  const blocked = !context.canBuildLinks;

  return (
    <div className="space-y-6">
      {blocked && (
        <Banner tone="warning">
          Ads link to your storefront, and this store doesn’t say where its
          storefront is yet.{" "}
          <Link to="/admin/settings" className="font-medium underline underline-offset-4">
            Set the storefront URL in Settings
          </Link>{" "}
          first.
        </Banner>
      )}

      {summary && (
        <Banner tone="error">
          <p className="font-medium">{summary}</p>
          {unplaced.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {unplaced.map((c, i) => (
                <li key={i}>{c.message}</li>
              ))}
            </ul>
          )}
        </Banner>
      )}

      <Section title="Campaign">
        <div className="space-y-1.5">
          <Label htmlFor="campaign-name">Name</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Autumn coats"
            maxLength={255}
          />
          <Complaints items={campaignWide("name")} />
        </div>
      </Section>

      <Section title="Budget and dates">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-budget">Daily budget</Label>
            <div className="flex items-center rounded-md border bg-background pl-3 text-sm">
              <span className="text-muted-foreground">{context.currency}</span>
              <Input
                id="campaign-budget"
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="20.00"
                className="border-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <Complaints items={campaignWide("dailyBudget")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-start">Starts</Label>
            <Input
              id="campaign-start"
              type="date"
              min={today}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-end">Ends</Label>
            {hasEnd ? (
              <div className="flex gap-1">
                <Input
                  id="campaign-end"
                  type="date"
                  min={startDate}
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
                No end date
              </Button>
            )}
          </div>
        </div>
        <Complaints items={campaignWide("schedule")} />
        <p className="text-xs text-muted-foreground">
          Dates are in the store’s timezone, {context.timezone}. The end date is
          spent in full.
        </p>
      </Section>

      <Section
        title="Who sees it"
        description="Countries and ages. Meta finds the people most likely to buy within them."
      >
        <CountryPicker selected={countries} onChange={setCountries} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Ages</span>
          <AgeSelect value={ageMin} onChange={setAgeMin} />
          <span>to</span>
          <AgeSelect value={ageMax} onChange={setAgeMax} />
        </div>
        <Complaints items={campaignWide("audience")} />
      </Section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold">Ads</h2>
            <p className="text-xs text-muted-foreground">
              Up to {MAX_ADS}. Meta spends more on the ones that sell.
            </p>
          </div>
        </div>
        <Complaints
          items={complaints.filter(
            (c) => c.adIndex === null && ["media", "primaryText", "headline", "callToAction", "destination"].includes(c.field ?? ""),
          )}
        />
        {ads.map((ad, index) => (
          <AdEditor
            key={ad.key}
            index={index}
            ad={ad}
            storefrontUrl={context.storefrontUrl}
            complaints={complaints.filter((c) => c.adIndex === index)}
            onChange={(next) =>
              setAds((all) => all.map((a) => (a.key === ad.key ? next : a)))
            }
            onRemove={
              ads.length > 1
                ? () => {
                    setAds((all) => all.filter((a) => a.key !== ad.key));
                    // Complaints are placed by position, which just moved.
                    setComplaints([]);
                  }
                : null
            }
          />
        ))}
        {ads.length < MAX_ADS && (
          <Button
            variant="outline"
            className="w-full gap-2 border-dashed"
            onClick={() => setAds((all) => [...all, emptyAd()])}
          >
            <PlusIcon className="h-4 w-4" />
            Add another ad
          </Button>
        )}
      </section>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0" />
        The goal is sales, placements are chosen by Meta, and bidding is Meta’s
        default. Meta checks the campaign before anything is created.
      </p>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={busy || blocked}
          onClick={() => submit("paused")}
        >
          {busy && create.variables === "paused" && (
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save as paused
        </Button>
        <Button disabled={busy || blocked} onClick={() => submit("active")} className="gap-2">
          <SendIcon className="h-4 w-4" />
          Publish
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent className="max-w-md" showCloseButton={!busy}>
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle>Publish this campaign?</DialogTitle>
            <DialogDescription>
              Once Meta approves the ads, it spends up to{" "}
              {formatMoney(toCents(budget), context.currency)} a day
              {hasEnd && endDate ? ` until the end of ${endDate}` : ", with no end date"}.
              To look it over first, save it paused.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-5 pb-5">
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => create.mutate("active")} className="gap-2">
              {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function AgeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AGES.map((age) => (
          <SelectItem key={age} value={String(age)}>
            {age === 65 ? "65+" : age}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warning" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "error"
          ? "flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          : "flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
      }
    >
      <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
