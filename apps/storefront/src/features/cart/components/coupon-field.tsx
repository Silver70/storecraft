import * as React from "react";
import { X } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

interface CouponFieldProps {
  appliedCode?: string | null;
  /**
   * Applies the typed code. Resolve when the backend accepts it — the input
   * clears; reject and the rejection's message is shown under the field.
   */
  onApply: (code: string) => Promise<unknown>;
  onRemove: () => void;
  isApplying?: boolean;
  isRemoving?: boolean;
}

/**
 * Apply / remove a coupon code. The backend validates and reprices the cart.
 * The typed code and the error message are local UI state; the cart itself and
 * the mutating are the caller's.
 */
export function CouponField({
  appliedCode,
  onApply,
  onRemove,
  isApplying,
  isRemoving,
}: CouponFieldProps) {
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  if (appliedCode) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2 text-sm">
        <span>
          Coupon <span className="font-medium">{appliedCode}</span> applied
        </span>
        <button
          type="button"
          aria-label="Remove coupon"
          disabled={isRemoving}
          onClick={onRemove}
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await onApply(trimmed);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid coupon");
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Coupon code"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          variant="outline"
          onClick={() => void submit()}
          disabled={isApplying || !code.trim()}
        >
          {isApplying ? "Applying…" : "Apply"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
