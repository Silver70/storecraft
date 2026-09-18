import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import * as React from "react";
import { Card, CardContent } from "~/components/ui/card";
import { fmtCount, fmtCurrency } from "../utils";

// Tileable feTurbulence grain, inlined as a data URI — no exported asset, so
// it scales with the card instead of stretching a bitmap.
const NOISE_BG =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function KpiCard({
    label,
    subLabel,
    value,
    delta,
    icon: Icon,
    format = "currency",
    compareValue,
    compareLabel = "compared to previous 30 days",
}: {
    label: string;
    /** Short descriptor under the label, e.g. "Total sales revenue". */
    subLabel: string;
    value: number;
    delta: number;
    icon: React.ElementType;
    format?: "currency" | "number" | "percent";
    /**
     * Mockup-only placeholder for now — not derived from real prior-period
     * data yet. Wire this up to an actual comparison figure later.
     */
    compareValue: string;
    compareLabel?: string;
}) {
    const positive = delta >= 0;
    const displayValue =
        format === "currency" ? fmtCurrency(value) : format === "percent" ? `${value}%` : fmtCount(value);

    return (
        <Card className="relative gap-0 overflow-hidden rounded-[16px] border border-border/70 bg-[#fbfaf8] py-0 shadow-sm ring-0 dark:bg-card">
            {/* Slightly stronger orange glow upper-left, pale blue glow bottom-right */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    backgroundImage:
                        "radial-gradient(100% 90% at 0% 0%, color-mix(in oklab, var(--primary) 19%, transparent), transparent 60%), radial-gradient(165% 125% at 100% 100%, hsl(var(--chart-1) / 16%), transparent 66%)",
                }}
            />

            {/* A fan of three concentric arcs sweeping across the bottom-right, drawn
          after the glow so they sit over it. Concentric — one shared centre
          88px right of and 236px below the card's bottom-right corner — is what
          makes them read as parallel curves rather than three unrelated rings;
          the 20px radius step is the gap between them. The radii are large
          relative to the card (~2x its height) on purpose: that flattens the
          curves into long sweeps instead of a tight corner ornament.

          In light mode the two outer lines are white, which is the whole trick:
          the card's base is already near-white, so they only register where the
          blue glow has darkened the surface, and fade out as they travel into
          the pale part of the card. That only works with the arcs painted over
          the glow rather than under it — white under a translucent wash on a
          near-white base moves nothing. Dark mode has no such base to hide in,
          so the whites drop to a flat, much lower opacity there. Orange is the
          one line meant to read as a line: a touch thicker, and the only one
          with any real colour. */}
            <div className="pointer-events-none absolute -bottom-129 -right-92 h-140 w-140 rounded-full border border-white/65 dark:border-white/12" />
            <div className="pointer-events-none absolute -bottom-134 -right-97 h-150 w-150 rounded-full border-[1.25px] border-primary/35 dark:border-primary/30" />
            <div className="pointer-events-none absolute -bottom-139 -right-102 h-160 w-160 rounded-full border border-white/55 dark:border-white/10" />

            {/* Fine grain texture, over the whole card */}
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
                style={{ backgroundImage: NOISE_BG }}
            />

            <CardContent className="relative z-10 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="p-2.5 rounded-md bg-primary/10 shrink-0">
                            <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight truncate">{label}</p>
                            <p className="text-xs text-muted-foreground truncate">{subLabel}</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-5 mb-1.5">
                    <p className="text-2xl font-bold tracking-tight tabular-nums leading-none">{displayValue}</p>
                    <div
                        className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            positive
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-destructive/10 text-destructive"
                        }`}
                    >
                        {positive ? (
                            <ArrowUpRightIcon className="h-3 w-3" />
                        ) : (
                            <ArrowDownRightIcon className="h-3 w-3" />
                        )}
                        {Math.abs(delta)}%
                    </div>
                </div>

                <p className="text-[11px] text-muted-foreground/80 truncate">
                    <span
                        className={`font-medium ${
                            positive ? "text-emerald-600/90 dark:text-emerald-400/90" : "text-destructive/90"
                        }`}
                    >
                        {compareValue}
                    </span>{" "}
                    {compareLabel}
                </p>
            </CardContent>
        </Card>
    );
}
