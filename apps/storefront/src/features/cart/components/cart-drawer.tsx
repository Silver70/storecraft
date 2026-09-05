import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import type { Cart } from "~/types/api";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Button } from "~/components/ui/button";
import { itemCount } from "../utils";
import { CartLineItem } from "./cart-line-item";
import { CartSummary } from "./cart-summary";
import { CouponField } from "./coupon-field";

interface CartDrawerProps {
  cart: Cart | null | undefined;
  /** Open state lives with the caller so an add elsewhere can open the drawer. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onRemoveItem: (itemId: string) => void;
  onApplyCoupon: (code: string) => Promise<unknown>;
  onRemoveCoupon: () => void;
  /** The line with an edit in flight, if any — only that line freezes. */
  pendingItemId?: string | null;
  isApplyingCoupon?: boolean;
  isRemovingCoupon?: boolean;
}

/**
 * Header cart: the icon/badge trigger plus the slide-over cart contents. It
 * renders its own trigger but owns no cart data — swap it for a differently
 * styled drawer with the same props and no page needs to change.
 */
export function CartDrawer({
  cart,
  open,
  onOpenChange,
  onQuantityChange,
  onRemoveItem,
  onApplyCoupon,
  onRemoveCoupon,
  pendingItemId,
  isApplyingCoupon,
  isRemovingCoupon,
}: CartDrawerProps) {
  const count = itemCount(cart);
  const isEmpty = !cart || cart.items.length === 0;
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={
            count > 0 ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"
          }
          className="relative inline-flex size-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
        >
          <ShoppingBag className="size-5" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Your cart{count > 0 ? ` (${count})` : ""}</SheetTitle>
        </SheetHeader>

        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <ShoppingBag className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Your cart is empty.</p>
            <Button asChild variant="outline" onClick={close}>
              <Link to="/products">Continue shopping</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-4">
              {cart.items.map((item) => (
                <CartLineItem
                  key={item.id}
                  item={item}
                  currency={cart.currency}
                  disabled={pendingItemId === item.id}
                  onQuantityChange={(quantity) =>
                    onQuantityChange(item.id, quantity)
                  }
                  onRemove={() => onRemoveItem(item.id)}
                  onNavigate={close}
                />
              ))}
              <CouponField
                appliedCode={cart.couponCode}
                onApply={onApplyCoupon}
                onRemove={onRemoveCoupon}
                isApplying={isApplyingCoupon}
                isRemoving={isRemovingCoupon}
              />
            </div>

            <SheetFooter className="border-t">
              <CartSummary cart={cart} />
              <Button asChild size="lg" className="w-full" onClick={close}>
                <Link to="/checkout">Checkout</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="w-full"
                onClick={close}
              >
                <Link to="/cart">View cart</Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
