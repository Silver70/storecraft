import { storeConfig } from "~/config/store.config";
import type { Cart, CartItem } from "~/types/api";

/**
 * Marks a cart or a line the client invented while an add is in flight. The
 * server never issues an id in this shape, so it is a reliable answer to "did
 * the server give me this line, or did I make it up a moment ago?"
 */
const OPTIMISTIC_PREFIX = "optimistic:";

/** The cart id a first add synthesizes, before the server has issued one. */
export const OPTIMISTIC_CART_ID = `${OPTIMISTIC_PREFIX}cart`;

/**
 * True for a line the client synthesized and the server has not confirmed yet.
 * Its id addresses nothing on the server, so quantity edits and removals have
 * to stay frozen on it until the real cart lands.
 */
export function isOptimisticLine(item: CartItem): boolean {
  return item.id.startsWith(OPTIMISTIC_PREFIX);
}

/** Total number of units across all cart lines (for the header badge). */
export function itemCount(cart: Cart | null | undefined): number {
  return cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
}

/** Recompute the rough subtotal/total after a line change. */
function reprice(cart: Cart, items: CartItem[]): Cart {
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  return {
    ...cart,
    items,
    subtotal,
    total: Math.max(0, subtotal - cart.discountAmount),
  };
}

/**
 * Optimistically apply a quantity change to a cached cart so the stepper feels
 * instant. This is a transient estimate (discounts can't be recomputed on the
 * client) — the server's authoritative cart replaces it when the mutation
 * resolves. Quantity ≤ 0 removes the line.
 */
export function optimisticQuantity(
  cart: Cart,
  itemId: string,
  quantity: number,
): Cart {
  const items =
    quantity <= 0
      ? cart.items.filter((item) => item.id !== itemId)
      : cart.items.map((item) =>
          item.id === itemId
            ? { ...item, quantity, totalPrice: item.unitPrice * quantity }
            : item,
        );
  return reprice(cart, items);
}

/** Optimistically remove a line, recomputing the rough subtotal/total. */
export function optimisticRemove(cart: Cart, itemId: string): Cart {
  return optimisticQuantity(cart, itemId, 0);
}

/**
 * What the shopper is looking at when they click Add: the variant to add plus
 * the display details of the line to show while the server answers. The
 * product page already renders every one of these, so it passes them down
 * rather than the button fetching them.
 */
export interface AddedLine {
  variantId: string;
  quantity: number;
  /** Unit price in cents, as shown on the product page. */
  unitPrice: number;
  productName: string;
  productSlug: string;
  variantName?: string | null;
  sku: string;
  imageUrl?: string | null;
}

/**
 * Optimistically add a line to the cached cart, so the line and the header
 * badge move on the click rather than on the round-trip.
 *
 * Two things separate this from the stepper's patch. There may be no cart at
 * all — the cart is created lazily on the first add, so a first add synthesizes
 * the whole cart rather than amending one, with nothing discounted, taxed or
 * shipped yet. And a variant already in the cart merges into the line that
 * holds it: appending a second line would double the badge and show a cart the
 * shopper does not have.
 *
 * Like the other patches this is a transient estimate the server's cart
 * replaces wholesale, and it never mutates the cart it was handed — that
 * object is what a failed add rolls back to.
 */
export function optimisticAdd(
  cart: Cart | null | undefined,
  line: AddedLine,
): Cart {
  const base: Cart = cart ?? {
    id: OPTIMISTIC_CART_ID,
    status: "active",
    couponCode: null,
    subtotal: 0,
    discountAmount: 0,
    taxAmount: 0,
    shippingAmount: 0,
    total: 0,
    currency: storeConfig.currency,
    items: [],
  };

  const existing = base.items.find((item) => item.variantId === line.variantId);
  const items = existing
    ? base.items.map((item) =>
        item.variantId === line.variantId
          ? {
              ...item,
              quantity: item.quantity + line.quantity,
              // The price the server set on the line, not the one just read off
              // the product page: the cart is what the shopper is buying at.
              totalPrice: item.unitPrice * (item.quantity + line.quantity),
            }
          : item,
      )
    : [
        ...base.items,
        {
          // Deterministic in the variant, so a second click on the same button
          // merges into the line the first one put there.
          id: `${OPTIMISTIC_PREFIX}${line.variantId}`,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: line.unitPrice * line.quantity,
          productName: line.productName,
          productSlug: line.productSlug,
          variantName: line.variantName ?? null,
          sku: line.sku,
          imageUrl: line.imageUrl ?? null,
        },
      ];

  return reprice(base, items);
}
