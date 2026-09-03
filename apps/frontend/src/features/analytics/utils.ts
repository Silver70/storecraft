/** Compact currency from integer cents: $1.2M / $3.4k / $999.00. */
export function money(cents: number): string {
  const n = cents / 100;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact count: 1.2M / 3.4k / 999. */
export function num(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

/**
 * Categorical series colours in fixed slot order. Assign by index — never cycle
 * or generate a 9th hue; past eight, fold the tail into "Other". Values live in
 * app.css, where light and dark are stepped separately and validated for
 * colour-blind separation against each surface.
 */
export const SERIES = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--chart-7))",
  "hsl(var(--chart-8))",
];

/** Colour for series slot `i`, capped at the last slot rather than wrapping. */
export const series = (i: number) => SERIES[Math.min(i, SERIES.length - 1)];

/** Ordered blue ramp, dark → light: magnitude and funnel stages. */
export const SEQUENTIAL = [
  "hsl(var(--seq-1))",
  "hsl(var(--seq-2))",
  "hsl(var(--seq-3))",
  "hsl(var(--seq-4))",
  "hsl(var(--seq-5))",
];

/** Step `i` of `n` along the sequential ramp, dark → light. */
export function seqStep(i: number, n: number): string {
  if (n <= 1) return SEQUENTIAL[0];
  const idx = Math.round((i / (n - 1)) * (SEQUENTIAL.length - 1));
  return SEQUENTIAL[Math.min(Math.max(idx, 0), SEQUENTIAL.length - 1)];
}
