import * as React from "react";

/**
 * Cards or a dense table. A grid of cards is how a merchant compares four
 * creatives; it is not how anyone reads forty, and the bookstore will have
 * forty.
 */
export type ViewMode = "cards" | "table";

const STORAGE_KEY = "admin.campaigns.view";

/**
 * What was chosen last, remembered for the tab.
 *
 * Held in a module variable as well as in storage on purpose. The page is
 * unmounted and remounted by every navigation, so state alone would forget the
 * choice the moment a merchant opened a campaign and came back — which is the
 * navigation they make most. Storage alone would work, but it cannot be read
 * during the first client render without disagreeing with what the server sent,
 * so the effect below is what fills this in; from then on every remount picks it
 * up with no flash of the other view.
 */
let remembered: ViewMode | null = null;

function isViewMode(value: unknown): value is ViewMode {
  return value === "cards" || value === "table";
}

export function useViewMode(): [ViewMode, (next: ViewMode) => void] {
  // Deliberately not read from storage here. This runs on the server too, where
  // there is none, and a first client render that disagreed with the server's
  // HTML would be a hydration mismatch rather than a preference.
  const [view, setView] = React.useState<ViewMode>(remembered ?? "cards");

  React.useEffect(() => {
    if (remembered) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isViewMode(stored)) {
        remembered = stored;
        setView(stored);
      }
    } catch {
      // A browser refusing storage is not a reason for the page not to render;
      // the choice simply lasts as long as the tab does.
    }
  }, []);

  const choose = React.useCallback((next: ViewMode) => {
    remembered = next;
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same: remembering is a convenience, never a precondition.
    }
  }, []);

  return [view, choose];
}
