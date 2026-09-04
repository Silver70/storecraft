import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, LoaderCircleIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatMoney, toCents } from "~/lib/money";
import type {
    AttributionTouch,
    CampaignSpend,
    CampaignSpendReport,
    Period,
} from "~/types/api";
import { campaignSpendQueryOptions } from "../queries";
import { CampaignPerformancePanel } from "./campaign-performance-panel";
import { PerformancePeriodTabs } from "./campaign-performance-controls";
import {
    deleteCampaignSpendServerFn,
    recordCampaignSpendRangeServerFn,
    recordCampaignSpendServerFn,
    updateCampaignSpendServerFn,
} from "../server";

/**
 * A typed amount as whole minor units, or `null` if it is not money.
 *
 * The explicit refusal matters: `toCents` answers 0 for anything it cannot
 * parse, including a negative, and silently recording a zero where a merchant
 * typed something else is exactly the kind of quiet wrongness this feature is
 * meant to avoid.
 */
function parseAmount(input: string): number | null {
    const trimmed = input.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    return toCents(trimmed);
}

/** Minor units back into something typeable, for editing a saved figure. */
function toInput(amount: number): string {
    return (amount / 100).toFixed(2);
}

/**
 * A spend day as the merchant reads it. Formatted in UTC against a `YYYY-MM-DD`
 * pinned to UTC midnight — parsing it in the browser's timezone would render
 * the day before for anyone west of Greenwich.
 */
function formatDay(day: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A `YYYY-MM-DD` shifted by whole days.
 *
 * UTC arithmetic, because a calendar day has no offset and UTC has no DST —
 * walking in local time would land on the same date twice across a spring
 * forward. Only ever used to seed a form default from the store's own today.
 */
function shiftDays(day: string, delta: number): string {
    return new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * How many days a range covers, both ends included — how many rows the entry
 * will write.
 *
 * This is a count of rows, not a division of money. The split itself, and the
 * rule that its remainder lands on the first day, stays on the backend: a
 * second implementation of it here would be free to drift from the one that
 * actually writes the rows, and the merchant would be shown a figure that is
 * not what was saved.
 */
function countDays(from: string, to: string): number {
    const span = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
    return span < 0 ? 0 : Math.round(span / DAY_MS) + 1;
}

/**
 * Every period of this campaign's spend, since a write can land in any of them,
 * and the performance report beside it — that report divides spend into revenue
 * now, so a figure typed here is stale there the moment it is saved.
 */
function useInvalidateSpend(campaignId: string) {
    const queryClient = useQueryClient();
    return () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: ["campaigns", "detail", campaignId, "spend"] }),
            queryClient.invalidateQueries({ queryKey: ["campaigns", "revenue"] }),
        ]);
}

/** Which of the two entry forms is showing. */
type EntryMode = "day" | "range";

interface EntryProps {
    campaignId: string;
    /** Absent while loading or failed: entry stays disabled without it. */
    report: CampaignSpendReport | undefined;
}

/**
 * What this campaign cost, entered by hand one day at a time.
 *
 * Two facts drive the whole card and are stated on it, because a merchant who
 * does not know them will misread their own numbers. Recording a day that
 * already has a figure *corrects* that day rather than adding to it, so a
 * double-submit is harmless and a corrected figure replaces the wrong one.
 * And spend is recorded per day while revenue is recorded to the second, so
 * comparing the two on a day still in progress is comparing a whole day's cost
 * against a partial day's sales.
 *
 * The currency and the latest permitted date come from the store via the API,
 * never from the browser: a date picker capped by the viewer's own clock would
 * be wrong for anyone not sitting in the store's timezone.
 *
 * Entry comes in two shapes because merchants know their costs in two shapes:
 * a day at a time, and a week's total from an invoice. Both write the same
 * per-day rows.
 */
export function CampaignSpendCard({ campaignId }: { campaignId: string }) {
    const [period, setPeriod] = React.useState<Period>("30d");
    const [touch, setTouch] = React.useState<AttributionTouch>("last");
    const [mode, setMode] = React.useState<EntryMode>("day");

    const {
        data: report,
        isPending,
        error: loadError,
        refetch,
    } = useQuery(campaignSpendQueryOptions(campaignId, period));

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 border-b pb-4">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Performance &amp; spend
                </CardTitle>
                <PerformancePeriodTabs value={period} onValueChange={setPeriod} />
            </CardHeader>

            <CardContent className="space-y-5 pt-5">
                <CampaignPerformancePanel
                    campaignId={campaignId}
                    period={period}
                    touch={touch}
                    currency={report?.currency}
                    onTouchChange={setTouch}
                />

                <Separator />

                <p className="text-xs text-muted-foreground">
                    What you paid for this campaign, one figure per day, in{" "}
                    {report?.currency ?? "your store's currency"}. Recording a day you have already entered{" "}
                    <strong>corrects</strong> it rather than adding to it, so entering a figure twice is harmless. Spend
                    is recorded per day while revenue is recorded to the second — a day still in progress compares a
                    whole day's cost against part of a day's sales.
                </p>

                {/* ── Recorded days ───────────────────────────────────────────────── */}
                {isPending ? (
                    <p className="text-xs text-muted-foreground">Loading spend…</p>
                ) : !report ? (
                    // Without the report there is no currency to record in and no
                    // store date to cap the picker with, so entry stays disabled.
                    // Saying so is the point: an unexplained dead button is the
                    // worst version of this state.
                    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-4 text-xs">
                        <p className="font-medium text-destructive">Could not load spend for this campaign.</p>
                        <p className="text-muted-foreground">
                            {loadError instanceof Error ? loadError.message : "The request failed."}
                        </p>
                        <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
                            Try again
                        </Button>
                    </div>
                ) : report.rows.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                        No spend recorded for this period.
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-md border">
                        <ul className="divide-y">
                            {report.rows.map(row => (
                                <SpendRow key={row.id} row={row} campaignId={campaignId} />
                            ))}
                        </ul>
                        <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-sm">
                            <span className="text-xs font-medium text-muted-foreground">Total for this period</span>
                            <span className="font-semibold tabular-nums">
                                {formatMoney(report.total, report.currency)}
                            </span>
                        </div>
                    </div>
                )}

                {/* ── Record spend ────────────────────────────────────────────────── */}
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label>Record spend</Label>
                        {/* Two shapes because merchants know their costs in two
                            shapes — a day at a time, or a week's total off an
                            invoice. Both write the same per-day rows. */}
                        <Tabs value={mode} onValueChange={v => setMode(v as EntryMode)}>
                            <TabsList className="h-8">
                                <TabsTrigger value="day" className="text-xs">
                                    One day
                                </TabsTrigger>
                                <TabsTrigger value="range" className="text-xs">
                                    Date range
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    {mode === "day" ? (
                        <SingleDayEntry campaignId={campaignId} report={report} />
                    ) : (
                        <RangeEntry campaignId={campaignId} report={report} />
                    )}

                    <p className="text-xs text-muted-foreground">
                        Spend is recorded in your store's currency and is never converted. An archived campaign still
                        accepts spend, so a finished campaign's real cost can be closed out.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * One day, one figure.
 *
 * The day defaults to today where the *store* is, a date only the API knows.
 * `null` for untouched is what lets that default apply without overwriting a
 * day the merchant has since chosen, or refilling one they cleared.
 */
function SingleDayEntry({ campaignId, report }: EntryProps) {
    const invalidate = useInvalidateSpend(campaignId);
    const [chosenDay, setChosenDay] = React.useState<string | null>(null);
    const [amount, setAmount] = React.useState("");
    const [note, setNote] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);

    const day = chosenDay ?? report?.today ?? "";

    const recordMutation = useMutation({
        mutationFn: () => {
            const minorUnits = parseAmount(amount);
            if (minorUnits === null) {
                throw new Error("Enter an amount as a positive number, such as 125 or 125.50.");
            }
            return recordCampaignSpendServerFn({
                data: {
                    campaignId,
                    day,
                    amount: minorUnits,
                    currency: report!.currency,
                    // Sent as an empty string when blank, which the backend reads as null.
                    note: note.trim(),
                },
            });
        },
        onSuccess: () => {
            setAmount("");
            setNote("");
            setError(null);
            void invalidate();
        },
        onError: err => setError(err.message),
    });

    const canRecord = report !== undefined && day !== "" && amount.trim() !== "" && !recordMutation.isPending;
    const submitOnEnter = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && canRecord) recordMutation.mutate();
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                    <Label htmlFor="spend-day" className="text-xs text-muted-foreground">
                        Day
                    </Label>
                    <Input
                        id="spend-day"
                        type="date"
                        className="w-40"
                        value={day}
                        // Capped by the store's today, not the browser's: spend cannot
                        // be dated in the future, and the backend refuses it anyway.
                        max={report?.today}
                        onChange={e => setChosenDay(e.target.value)}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="spend-amount" className="text-xs text-muted-foreground">
                        Amount ({report?.currency ?? "—"})
                    </Label>
                    <Input
                        id="spend-amount"
                        className="w-32 tabular-nums"
                        inputMode="decimal"
                        placeholder="125.00"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        onKeyDown={submitOnEnter}
                    />
                </div>

                <div className="min-w-[180px] flex-1 space-y-1.5">
                    <Label htmlFor="spend-note" className="text-xs text-muted-foreground">
                        Note (optional)
                    </Label>
                    <Input
                        id="spend-note"
                        placeholder="Boosted the reel"
                        value={note}
                        maxLength={255}
                        onChange={e => setNote(e.target.value)}
                        onKeyDown={submitOnEnter}
                    />
                </div>

                <Button type="button" className="gap-1.5" disabled={!canRecord} onClick={() => recordMutation.mutate()}>
                    {recordMutation.isPending ? (
                        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <PlusIcon className="h-3.5 w-3.5" />
                    )}
                    Record
                </Button>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

/**
 * One total, spread across the days it covers.
 *
 * For the merchant who has an invoice for the week and no idea what Wednesday
 * cost on its own. The total is divided into one row per day by the backend,
 * with the remainder added to the first day so the rows sum to exactly what was
 * typed — which is why the amount field is labelled a *total* and the row count
 * is shown before submitting. A merchant who reads it as a daily figure would
 * enter seven times what they meant.
 *
 * Like single-day entry, this corrects: every day in the range is overwritten,
 * so re-entering an overlapping week repairs those days rather than doubling
 * them. The range defaults to the last seven days ending today where the store
 * is, which is the entry this form exists for.
 */
function RangeEntry({ campaignId, report }: EntryProps) {
    const invalidate = useInvalidateSpend(campaignId);
    const [chosenStart, setChosenStart] = React.useState<string | null>(null);
    const [chosenEnd, setChosenEnd] = React.useState<string | null>(null);
    const [total, setTotal] = React.useState("");
    const [note, setNote] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);

    const endDay = chosenEnd ?? report?.today ?? "";
    const startDay = chosenStart ?? (report ? shiftDays(report.today, -6) : "");

    const dayCount = startDay !== "" && endDay !== "" ? countDays(startDay, endDay) : 0;
    const inverted = startDay !== "" && endDay !== "" && dayCount === 0;

    const recordMutation = useMutation({
        mutationFn: () => {
            const minorUnits = parseAmount(total);
            if (minorUnits === null) {
                throw new Error("Enter a total as a positive number, such as 700 or 700.50.");
            }
            return recordCampaignSpendRangeServerFn({
                data: {
                    campaignId,
                    startDay,
                    endDay,
                    total: minorUnits,
                    currency: report!.currency,
                    note: note.trim(),
                },
            });
        },
        onSuccess: () => {
            setTotal("");
            setNote("");
            setError(null);
            void invalidate();
        },
        onError: err => setError(err.message),
    });

    const canRecord = report !== undefined && dayCount > 0 && total.trim() !== "" && !recordMutation.isPending;
    const submitOnEnter = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && canRecord) recordMutation.mutate();
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                    <Label htmlFor="spend-start" className="text-xs text-muted-foreground">
                        From
                    </Label>
                    <Input
                        id="spend-start"
                        type="date"
                        className="w-40"
                        value={startDay}
                        max={report?.today}
                        onChange={e => setChosenStart(e.target.value)}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="spend-end" className="text-xs text-muted-foreground">
                        To
                    </Label>
                    <Input
                        id="spend-end"
                        type="date"
                        className="w-40"
                        value={endDay}
                        max={report?.today}
                        onChange={e => setChosenEnd(e.target.value)}
                    />
                </div>

                <div className="space-y-1.5">
                    {/* "Total", not "Amount": this figure covers the whole range,
                        and a merchant reading it as a daily rate would enter
                        seven times what they meant. */}
                    <Label htmlFor="spend-total" className="text-xs text-muted-foreground">
                        Total ({report?.currency ?? "—"})
                    </Label>
                    <Input
                        id="spend-total"
                        className="w-32 tabular-nums"
                        inputMode="decimal"
                        placeholder="700.00"
                        value={total}
                        onChange={e => setTotal(e.target.value)}
                        onKeyDown={submitOnEnter}
                    />
                </div>

                <div className="min-w-[180px] flex-1 space-y-1.5">
                    <Label htmlFor="spend-range-note" className="text-xs text-muted-foreground">
                        Note (optional)
                    </Label>
                    <Input
                        id="spend-range-note"
                        placeholder="Launch week"
                        value={note}
                        maxLength={255}
                        onChange={e => setNote(e.target.value)}
                        onKeyDown={submitOnEnter}
                    />
                </div>

                <Button type="button" className="gap-1.5" disabled={!canRecord} onClick={() => recordMutation.mutate()}>
                    {recordMutation.isPending ? (
                        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <PlusIcon className="h-3.5 w-3.5" />
                    )}
                    Record range
                </Button>
            </div>

            {inverted ? (
                <p className="text-xs text-destructive">The end date is before the start date.</p>
            ) : (
                dayCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Writes {dayCount} {dayCount === 1 ? "row" : "rows"}, one per day, adding up to exactly the total
                        you enter. Any days already recorded in this range are corrected, not added to.
                    </p>
                )
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

/**
 * One recorded day, editable in place.
 *
 * Only the amount and the note can be changed. Moving a figure to another day
 * is recording it on that day — which corrects whatever is there — and deleting
 * this one, which is why there is a delete at all: a figure entered against the
 * wrong campaign should be removed rather than zeroed, since a zero claims the
 * campaign ran that day and cost nothing.
 */
function SpendRow({ row, campaignId }: { row: CampaignSpend; campaignId: string }) {
    const invalidate = useInvalidateSpend(campaignId);
    const [editing, setEditing] = React.useState(false);
    const [amount, setAmount] = React.useState(toInput(row.amount));
    const [note, setNote] = React.useState(row.note ?? "");
    const [error, setError] = React.useState<string | null>(null);

    const saveMutation = useMutation({
        mutationFn: () => {
            const minorUnits = parseAmount(amount);
            if (minorUnits === null) {
                throw new Error("Enter an amount as a positive number.");
            }
            return updateCampaignSpendServerFn({
                data: {
                    campaignId,
                    spendId: row.id,
                    amount: minorUnits,
                    note: note.trim(),
                },
            });
        },
        onSuccess: () => {
            setEditing(false);
            setError(null);
            void invalidate();
        },
        onError: err => setError(err.message),
    });

    const removeMutation = useMutation({
        mutationFn: () => deleteCampaignSpendServerFn({ data: { campaignId, spendId: row.id } }),
        onSuccess: () => void invalidate(),
        onError: err => setError(err.message),
    });

    function cancel() {
        setAmount(toInput(row.amount));
        setNote(row.note ?? "");
        setError(null);
        setEditing(false);
    }

    if (editing) {
        return (
            <li className="space-y-2 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">{formatDay(row.day)}</span>
                    <Input
                        className="w-28 tabular-nums"
                        inputMode="decimal"
                        aria-label={`Amount for ${formatDay(row.day)}`}
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter") saveMutation.mutate();
                            if (e.key === "Escape") cancel();
                        }}
                    />
                    <Input
                        className="min-w-[140px] flex-1"
                        placeholder="Note"
                        aria-label={`Note for ${formatDay(row.day)}`}
                        value={note}
                        maxLength={255}
                        onChange={e => setNote(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter") saveMutation.mutate();
                            if (e.key === "Escape") cancel();
                        }}
                    />
                    <Button
                        type="button"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label="Save"
                        disabled={saveMutation.isPending}
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
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        aria-label="Cancel"
                        onClick={cancel}
                    >
                        <XIcon className="h-3.5 w-3.5" />
                    </Button>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
            </li>
        );
    }

    return (
        <li className="space-y-1 px-3 py-2">
            <div className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">{formatDay(row.day)}</span>
                <span className="w-24 shrink-0 font-medium tabular-nums">{formatMoney(row.amount, row.currency)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{row.note}</span>
                <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Edit spend for ${formatDay(row.day)}`}
                    onClick={() => setEditing(true)}
                >
                    <PencilIcon className="h-3.5 w-3.5" />
                </Button>
                <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove spend for ${formatDay(row.day)}`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate()}
                >
                    {removeMutation.isPending ? (
                        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <XIcon className="h-3.5 w-3.5" />
                    )}
                </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </li>
    );
}
