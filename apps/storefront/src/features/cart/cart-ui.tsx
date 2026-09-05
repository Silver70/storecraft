import * as React from "react";

interface CartUi {
  /** Whether the cart drawer is open. */
  isCartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  /** Open the drawer — called when an add is confirmed by the server. */
  openCart: () => void;
}

const CartUiContext = React.createContext<CartUi | null>(null);

/**
 * The cart drawer's open state, lifted above both the header that renders the
 * drawer and the product page whose successful add opens it. Neither sits
 * inside the other, so this is the nearest place they share.
 *
 * This is view state only — the cart itself is server state and still comes
 * from `useCart`.
 */
export function CartUiProvider({ children }: { children: React.ReactNode }) {
  const [isCartOpen, setCartOpen] = React.useState(false);
  const value = React.useMemo<CartUi>(
    () => ({ isCartOpen, setCartOpen, openCart: () => setCartOpen(true) }),
    [isCartOpen],
  );

  return <CartUiContext value={value}>{children}</CartUiContext>;
}

export function useCartUi(): CartUi {
  const ctx = React.useContext(CartUiContext);
  if (!ctx) throw new Error("useCartUi must be used inside <CartUiProvider>");
  return ctx;
}
