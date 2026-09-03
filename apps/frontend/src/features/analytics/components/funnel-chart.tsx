import * as React from "react";
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { num, seqStep } from "../utils";
import { ChartCard, EmptyState } from "./chart-card";

export type FunnelStage = {
  stage: string;
  sessions: number;
  /** % change vs the prior period. Wired in P3; absent for now. */
  delta?: number;
};

/**
 * Horizontal conversion funnel: a smooth tapering silhouette banded per stage,
 * with the stage figure, its step-conversion, and (when available) its delta
 * sitting directly above each band.
 *
 * Stage heights are share of the *entered* (first) stage, so the silhouette is a
 * true picture of drop-off; the per-step % below is share of the *previous*
 * stage, which is the number you act on. Bands walk a single blue ramp dark →
 * light — an ordered scale, not eight identities.
 */
export function FunnelChart({
  title,
  description,
  icon,
  action,
  stages,
  emptyLabel = "No traffic yet for this period",
  emptyDetail,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  stages: FunnelStage[];
  emptyLabel?: string;
  emptyDetail?: React.ReactNode;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const n = stages.length;
  const entered = stages[0]?.sessions ?? 0;
  const completed = n > 0 ? stages[n - 1].sessions : 0;
  const conversionPct =
    entered > 0 ? Math.round((completed / entered) * 1000) / 10 : 0;

  // ── SVG geometry ──────────────────────────────────────────────────────────
  const W = 1000;
  const H = 220;
  const usableH = H * 0.86;
  const colW = n > 0 ? W / n : W;
  const barH = (v: number) => (entered > 0 ? (v / entered) * usableH : 0);
  const nodeX = (i: number) => (i + 0.5) * colW;

  type Pt = { x: number; y: number };
  const top: Pt[] = [];
  const bot: Pt[] = [];
  const addPoint = (x: number, v: number) => {
    const h = barH(v);
    top.push({ x, y: (H - h) / 2 });
    bot.push({ x, y: (H + h) / 2 });
  };
  addPoint(0, stages[0]?.sessions ?? 0);
  stages.forEach((s, i) => addPoint(nodeX(i), s.sessions));
  addPoint(W, stages[n - 1]?.sessions ?? 0);

  // Smooth cubic-bezier through points, horizontal tangents at each node.
  const smooth = (pts: Pt[]): string => {
    let d = "";
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const mx = (p0.x + p1.x) / 2;
      d += ` C ${mx} ${p0.y} ${mx} ${p1.y} ${p1.x} ${p1.y}`;
    }
    return d;
  };

  const path =
    `M ${top[0]?.x ?? 0} ${top[0]?.y ?? 0}` +
    smooth(top) +
    ` L ${bot[bot.length - 1]?.x ?? W} ${bot[bot.length - 1]?.y ?? H}` +
    smooth([...bot].reverse()) +
    " Z";

  const cols = `repeat(${n}, minmax(0, 1fr))`;

  return (
    <ChartCard
      title={title}
      description={description}
      icon={icon}
      action={action}
    >
      {entered === 0 ? (
        <EmptyState message={emptyLabel} detail={emptyDetail} />
      ) : (
        <div>
          {/* Stage headers — figure, delta, step conversion */}
          <div className="grid gap-2" style={{ gridTemplateColumns: cols }}>
            {stages.map((s, i) => {
              const prev = i > 0 ? stages[i - 1].sessions : s.sessions;
              const stepPct =
                i === 0
                  ? 100
                  : prev > 0
                    ? Math.round((s.sessions / prev) * 100)
                    : 0;
              const hasDelta =
                typeof s.delta === "number" && Number.isFinite(s.delta);
              return (
                <div
                  key={s.stage}
                  className={cn(
                    "rounded-md px-2 py-1.5 transition-colors",
                    hover === i && "bg-muted/60",
                  )}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                    {s.stage}
                  </p>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-bold leading-none tabular-nums">
                      {num(s.sessions)}
                    </span>
                    {hasDelta ? (
                      <span
                        className={cn(
                          "flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
                          s.delta! >= 0
                            ? "text-status-good"
                            : "text-status-critical",
                        )}
                      >
                        {s.delta! >= 0 ? (
                          <TrendingUpIcon className="h-3 w-3" />
                        ) : (
                          <TrendingDownIcon className="h-3 w-3" />
                        )}
                        {Math.abs(s.delta!)}%
                      </span>
                    ) : null}
                  </div>
                  {i > 0 ? (
                    <p
                      className={cn(
                        "mt-1 text-[11px] tabular-nums",
                        stepPct < 50
                          ? "text-status-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {stepPct}% of previous
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      entered
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Funnel silhouette, banded per stage along one ordered ramp */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="mt-3 h-40 w-full"
            role="img"
            aria-label={`Conversion funnel: ${stages
              .map((s) => `${s.stage} ${s.sessions}`)
              .join(", ")}`}
          >
            <defs>
              <clipPath id="funnelClip">
                <path d={path} />
              </clipPath>
            </defs>
            {/* One band per stage, clipped to the funnel silhouette */}
            <g clipPath="url(#funnelClip)">
              {stages.map((s, i) => (
                <rect
                  key={s.stage}
                  x={i * colW}
                  y={0}
                  width={colW}
                  height={H}
                  fill={seqStep(i, n)}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                  className="transition-opacity duration-200 motion-reduce:transition-none"
                />
              ))}
            </g>
            {/* Hairline dividers between stages */}
            {stages.map((_, i) =>
              i > 0 ? (
                <line
                  key={i}
                  x1={i * colW}
                  y1={0}
                  x2={i * colW}
                  y2={H}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ) : null,
            )}
            {/* Hover targets */}
            {stages.map((s, i) => (
              <rect
                key={`hit-${s.stage}`}
                x={i * colW}
                y={0}
                width={colW}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </svg>

          <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
            <span className="text-muted-foreground">
              {num(entered)} entered · {num(Math.max(entered - completed, 0))}{" "}
              dropped
            </span>
            <span className="font-semibold tabular-nums">
              {conversionPct}% completed
            </span>
          </div>
        </div>
      )}
    </ChartCard>
  );
}
