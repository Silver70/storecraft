import { Button } from "~/components/ui/button";
import { writeConsent } from "../consent";
import { useMeasurement } from "../hooks";

/**
 * The consent banner, shown only on a store that asks and only until it has an
 * answer.
 *
 * Declining is exactly as easy as accepting — same size, same weight, same
 * place, one click each. A banner where "no" is a link in the small print or
 * three clicks deep is not a question, and a merchant who turned this on did so
 * because they need a real one.
 *
 * It sits above the page rather than in front of it: nothing is blocked, and a
 * visitor who wants to shop without answering can. Not answering means not
 * measuring, which is the correct default and costs them nothing.
 */
export function ConsentBanner() {
  const { askConsent } = useMeasurement();
  if (!askConsent) return null;

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 p-4 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use cookies to measure how our ads and our shop are doing. Nothing
          is measured until you say yes, and you can shop either way.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() => writeConsent("denied")}
          >
            Decline
          </Button>
          <Button size="lg" onClick={() => writeConsent("granted")}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
