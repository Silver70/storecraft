import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useCart, useCartMutations } from "../hooks";
import { CartLineItem } from "../components/cart-line-item";
import { CartSummary } from "../components/cart-summary";
import { CouponField } from "../components/coupon-field";

/**
 * Full-page cart at `/cart` — the same pieces as the drawer, laid out wide.
 * The page owns every hook call; the pieces below it take props only.
 */
export function CartPage() {
  const { data: cart } = useCart();
  const { updateItem, removeItem, applyCoupon, removeCoupon, pendingItemId } =
    useCartMutations();
  const isEmpty = !cart || cart.items.length === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-6 font-heading text-2xl font-semibold tracking-tight">
        Your cart
      </h1>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <ShoppingBag className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Your cart is empty.</p>
          <Button asChild>
            <Link to="/products">Shop all</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            {cart.items.map((item) => (
              <CartLineItem
                key={item.id}
                item={item}
                currency={cart.currency}
                disabled={pendingItemId === item.id}
                onQuantityChange={(quantity) =>
                  updateItem.mutate({ itemId: item.id, quantity })
                }
                onRemove={() => removeItem.mutate({ itemId: item.id })}
              />
            ))}
          </div>

          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <CouponField
              appliedCode={cart.couponCode}
              onApply={(code) => applyCoupon.mutateAsync({ code })}
              onRemove={() => removeCoupon.mutate()}
              isApplying={applyCoupon.isPending}
              isRemoving={removeCoupon.isPending}
            />
            <div className="rounded-xl border p-4">
              <CartSummary cart={cart} />
            </div>
            <Button asChild size="lg" className="w-full">
              <Link to="/checkout">Checkout</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
