import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { AttributionTouch, Period } from "~/types/api";

export const PERFORMANCE_PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export const ATTRIBUTION_TOUCHES: {
  value: AttributionTouch;
  label: string;
  hint: string;
}[] = [
  {
    value: "last",
    label: "Last touch",
    hint: "Credits the campaign that closed the sale — the last tagged arrival before the order.",
  },
  {
    value: "first",
    label: "First touch",
    hint: "Credits the campaign that discovered the customer — the first tagged arrival before the order.",
  },
];

export function attributionTouchHint(touch: AttributionTouch): string {
  return ATTRIBUTION_TOUCHES.find((option) => option.value === touch)!.hint;
}

/**
 * The period selector shared by the account report and one-Campaign view.
 * Keeping the options and their values here makes both screens ask the API the
 * same question instead of slowly acquiring two meanings for "30 days".
 */
export function PerformancePeriodTabs({
  value,
  onValueChange,
}: {
  value: Period;
  onValueChange: (value: Period) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as Period)}>
      <TabsList aria-label="Performance period">
        {PERFORMANCE_PERIODS.map((period) => (
          <TabsTrigger key={period.value} value={period.value}>
            {period.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The same first/last-touch choice used everywhere performance is reported. */
export function AttributionTouchTabs({
  value,
  onValueChange,
}: {
  value: AttributionTouch;
  onValueChange: (value: AttributionTouch) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as AttributionTouch)}
    >
      <TabsList aria-label="Attribution touch">
        {ATTRIBUTION_TOUCHES.map((touch) => (
          <TabsTrigger key={touch.value} value={touch.value}>
            {touch.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
