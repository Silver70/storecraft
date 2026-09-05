import { Link } from "@tanstack/react-router";
import { storeConfig } from "~/config/store.config";
import { Brand } from "~/components/layout/brand";
import { CartDrawer } from "~/features/cart/components/cart-drawer";
import { useCartUi } from "~/features/cart/cart-ui";
import { useCart, useCartMutations } from "~/features/cart/hooks";

/**
 * Storefront header: brand mark, primary nav (from `store.config`), and the
 * cart drawer. The config-driven nav uses `<a>` because its targets are
 * arbitrary template config (could be any path); the brand mark links home via
 * a typed `<Link>` for client-side navigation.
 *
 * As the layout shell it stands in for a page above the drawer: the cart hooks
 * live here and the drawer receives their data and handlers as props. A page
 * may fetch; a component may not. The open state comes from `useCartUi`,
 * because a successful add on the product page has to be able to open it.
 */
export function Header() {
  const { data: cart } = useCart();
  const { updateItem, removeItem, applyCoupon, removeCoupon, pendingItemId } =
    useCartMutations();
  const { isCartOpen, setCartOpen } = useCartUi();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link to="/" className="flex shrink-0 items-center">
          <Brand />
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {storeConfig.nav.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <CartDrawer
          cart={cart}
          open={isCartOpen}
          onOpenChange={setCartOpen}
          pendingItemId={pendingItemId}
          isApplyingCoupon={applyCoupon.isPending}
          isRemovingCoupon={removeCoupon.isPending}
          onQuantityChange={(itemId, quantity) =>
            updateItem.mutate({ itemId, quantity })
          }
          onRemoveItem={(itemId) => removeItem.mutate({ itemId })}
          onApplyCoupon={(code) => applyCoupon.mutateAsync({ code })}
          onRemoveCoupon={() => removeCoupon.mutate()}
        />
      </div>
    </header>
  );
}
