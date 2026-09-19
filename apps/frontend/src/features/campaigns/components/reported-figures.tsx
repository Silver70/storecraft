import { AlertTriangleIcon, RadioTowerIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import type { ReportedAdFigures } from "~/types/api";
import { formatPlatform, formatRoas } from "../utils";

/**
 * What the ad platform says about this creative, beside what we say.
 *
 * ## Why this is its own component and not five more rows in `FigureList`
 *
 * Those figures are ours. These were stated by somebody else, counted on an
 * attribution window that is not ours, in a currency that need not be the
 * store's. They will routinely disagree with ours by a factor of two — and
 * **that disagreement is the reason this block exists**. Before it, a merchant
 * had one number and no way to tell a measurement difference from a tracking
 * failure; with both on the card, and both windows named, the gap becomes
 * information.
 *
 * So the separation is structural rather than a matter of restraint (ADR-0005).
 * The backend nests these in their own array, this component is the only thing
 * that renders one, and every figure it draws sits under a heading naming the
 * platform that said it. Moving one of these numbers up into the list above
 * would take a deliberate act, which is the point: unlabelled, a reported
 * figure is indistinguishable from one of ours.
 *
 * ## What this deliberately never does
 *
 * It never combines a figure here with a figure there. There is no ratio in
 * this file with one of our numbers on one side, and none anywhere else in the
 * product — `roas` below is the platform's revenue over the platform's spend,
 * both its own figures in one currency. Where the ad account bills in another
 * currency the block says so in words and shows the figures as what they are:
 * no conversion, no combined ratio, no margin. The merchant is shown the
 * mismatch rather than a number derived from a rate nobody chose.
 *
 * And it never stands in for a figure of ours that is missing. An ad earning
 * nothing here and a fortune there renders as exactly that.
 */
export function ReportedFiguresBlock({
  reported,
  className,
}: {
  reported: ReportedAdFigures[];
  className?: string;
}) {
  // The ordinary state, and the permanent one for every ad on a platform no
  // sync covers. Nothing is drawn — not an empty heading and not a row of
  // dashes, either of which would read as a figure someone failed to supply.
  if (reported.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {reported.map((figures) => (
        <ReportedBlock
          key={`${figures.platform}:${figures.currency}`}
          figures={figures}
        />
      ))}
    </div>
  );
}

/** One platform's claim, in one currency. */
function ReportedBlock({ figures }: { figures: ReportedAdFigures }) {
  const platform = formatPlatform(figures.platform);
  const mismatched = !figures.matchesStoreCurrency;

  const rows: { label: string; value: string; caveat?: string }[] = [
    {
      label: "Spend",
      // Formatted in the ad account's currency and never the store's. The
      // symbol is part of the claim: a €47.50 drawn as $47.50 is a conversion
      // performed by the renderer.
      value: formatMoney(figures.spend, figures.currency),
    },
    {
      label: "Revenue",
      value: formatMoney(figures.revenue, figures.currency),
    },
    {
      label: "ROAS",
      value: formatRoas(figures.roas),
      // The window sits against the figure it qualifies, opposite our own
      // lookback window a few lines up. That pairing is what turns "these two
      // numbers disagree" into "these two numbers were measured differently".
      caveat: windowNote(figures, platform),
    },
  ];

  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <RadioTowerIcon className="h-3 w-3 shrink-0" aria-hidden />
        {/* Never "Spend" alone. A reported figure without its source on screen
            is one a merchant will read as ours. */}
        Reported by {platform}
      </p>

      <dl className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-right">
              <span className="text-xs font-medium tabular-nums">
                {row.value}
              </span>
              {row.caveat && (
                <span className="block text-[10px] leading-tight text-muted-foreground/70">
                  {row.caveat}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {mismatched ? (
        <p className="mt-2 flex gap-1.5 border-t border-dashed pt-2 text-[10px] leading-tight text-amber-700 dark:text-amber-500">
          <AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>
            This ad account bills in {figures.currency} and your store is in{" "}
            {figures.storeCurrency}. These figures are shown as they are and are
            not combined with yours — no exchange rate is applied anywhere, so
            no ROAS or margin is calculated across the two.
          </span>
        </p>
      ) : (
        <p className="mt-2 border-t border-dashed pt-2 text-[10px] leading-tight text-muted-foreground/70">
          {platform}&apos;s own figures, kept separate from yours. They are not
          added to the numbers above and never feed contribution margin.
        </p>
      )}
    </div>
  );
}

/**
 * The window beneath the platform's ROAS.
 *
 * Absent where the platform stated none, and our own lookback window is
 * emphatically not substituted: printing "30-day window" under somebody else's
 * number would claim they agreed to it, and the window is the one thing on this
 * block that explains the disagreement it exists to show.
 */
function windowNote(
  figures: ReportedAdFigures,
  platform: string,
): string | undefined {
  if (figures.roas === null) return `${platform} reported no spend`;
  if (!figures.attribution) return `${platform} did not state its window`;

  const { clickDays, viewDays } = figures.attribution;
  const click = `${clickDays}-day click`;
  return viewDays === null
    ? `${platform}: ${click}`
    : `${platform}: ${click}, ${viewDays}-day view`;
}
