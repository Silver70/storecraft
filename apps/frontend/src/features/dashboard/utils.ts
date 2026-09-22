import type { Period } from "~/types/api";

/** Compact currency from integer cents: $1.2M / $3.4k / $999.00. */
export function fmt(cents: number): string {
  const n = cents / 100;
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(1)}k`
      : `$${n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
}

/** Full currency from integer cents, no k/M compaction: $1,234.56. */
export function fmtCurrency(cents: number): string {
  const n = cents / 100;
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact count: 1.2M / 3.4k / 999. */
export function fmtCount(n: number): string {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : n.toLocaleString();
}

const PERIOD_DAYS: Record<Period, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * Map a revenue sparkline to dated points spanning the selected period.
 *
 * Dates stay as `Date` objects rather than pre-formatted strings: the chart
 * builds a real time scale from them and derives its own tick and tooltip
 * labels, so formatting here would throw away the ordering information it
 * needs.
 */
export function sparklineToTrend(
  sparkline: number[],
  period: Period,
): { date: Date; revenue: number }[] {
  const days = PERIOD_DAYS[period];
  const start = new Date();
  start.setDate(start.getDate() - days);

  return sparkline.map((revenue, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { date: d, revenue };
  });
}
