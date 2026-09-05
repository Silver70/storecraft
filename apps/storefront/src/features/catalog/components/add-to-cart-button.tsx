import { Check } from "lucide-react";
import { Button } from "~/components/ui/button";

interface AddToCartButtonProps {
  /** Resolved variant to add; null while the selection is incomplete. */
  variantId: string | null;
  /** An add is in flight. The button stays clickable — see below. */
  isAdding?: boolean;
  /** The last add succeeded — shows the confirmation. */
  justAdded?: boolean;
  /** Shown under the button when the add failed. */
  error?: string | null;
  onAdd: () => void;
}

/**
 * Adds the selected variant to the cart, with pending and confirmation states.
 *
 * Presentational: it renders what it is given and calls back. The page owns the
 * mutation, because the optimistic line the click paints into the cart needs
 * the product's name, image and price — details the page is already rendering
 * and this button has no business fetching.
 *
 * An add in flight does not disable the button. The cart already shows the
 * unit, so a shopper who wants a second one should not have to wait out a
 * round-trip they were never meant to notice: two quick clicks are two units.
 */
export function AddToCartButton({
  variantId,
  isAdding,
  justAdded,
  error,
  onAdd,
}: AddToCartButtonProps) {
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        className="w-full"
        disabled={!variantId}
        onClick={onAdd}
      >
        {isAdding ? (
          "Adding…"
        ) : justAdded ? (
          <>
            <Check /> Added to cart
          </>
        ) : variantId ? (
          "Add to cart"
        ) : (
          "Select options"
        )}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
