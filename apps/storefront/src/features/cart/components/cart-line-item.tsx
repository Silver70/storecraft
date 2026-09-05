import { Link } from "@tanstack/react-router";
import { ImageOff, Trash2 } from "lucide-react";
import type { CartItem } from "~/types/api";
import { formatMoney } from "~/lib/money";
import { QuantityStepper } from "./quantity-stepper";

interface CartLineItemProps {
  item: CartItem;
  currency: string;
  /** Quantity the shopper picked on the stepper. The caller does the mutating. */
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
  /** Freezes the stepper and the remove control while a cart edit is in flight. */
  disabled?: boolean;
  /** Called when a PDP link is clicked — used to close the drawer. */
  onNavigate?: () => void;
}

/** One cart line. Presentational: it renders what it is given and calls back. */
export function CartLineItem({
  item,
  currency,
  onQuantityChange,
  onRemove,
  disabled,
  onNavigate,
}: CartLineItemProps) {
  return (
    <div className="flex gap-3">
      <Link
        to="/products/$slug"
        params={{ slug: item.productSlug }}
        onClick={onNavigate}
        className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted"
      >
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.productName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-5" />
          </div>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/products/$slug"
            params={{ slug: item.productSlug }}
            onClick={onNavigate}
            className="text-sm leading-snug font-medium hover:underline"
          >
            {item.productName}
          </Link>
          <button
            type="button"
            aria-label="Remove item"
            disabled={disabled}
            onClick={onRemove}
            className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        {item.variantName && (
          <p className="text-xs text-muted-foreground">{item.variantName}</p>
        )}

        <div className="mt-1 flex items-center justify-between">
          <QuantityStepper
            quantity={item.quantity}
            disabled={disabled}
            onChange={onQuantityChange}
          />
          <span className="text-sm font-medium">
            {formatMoney(item.totalPrice, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
