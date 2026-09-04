import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { gqlFetch } from "~/lib/gql-client";
import { clearCartId, getCartId, getOrCreateCartId } from "~/lib/session";
import type { Cart } from "~/types/api";
import { optionalAttribution } from "~/features/attribution/schema";
import {
  ADD_TO_CART_MUTATION,
  APPLY_COUPON_MUTATION,
  CART_QUERY,
  REMOVE_COUPON_MUTATION,
  REMOVE_FROM_CART_MUTATION,
  UPDATE_CART_ITEM_MUTATION,
} from "./graphql";

/** The cart id, derived from the cookie. Throws when there is no active cart. */
function requireCartId(): string {
  const cartId = getCartId();
  if (!cartId) throw new Error("No active cart");
  return cartId;
}

/**
 * Read the current cart, or `null` when the visitor has no cart yet. Does NOT
 * create a cart — that would mint an empty cart for every visitor. The cart is
 * created lazily on the first `addToCart`. A stale cookie (cart deleted) is
 * cleared and treated as no cart.
 */
export const getCartServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Cart | null> => {
    const cartId = getCartId();
    if (!cartId) return null;
    try {
      const res = await gqlFetch<{ cart: Cart | null }>(CART_QUERY, { cartId });
      // A cart that has been converted (checked out) or abandoned (expired by
      // the backend's idle-cart sweep) is no longer usable. Forget the cookie
      // and treat the visitor as having no cart, so a fresh one is minted on
      // their next add rather than every mutation failing against the old cart.
      if (!res.cart || res.cart.status !== "active") {
        clearCartId();
        return null;
      }
      return res.cart;
    } catch (err) {
      if (err instanceof Error && /not found/i.test(err.message)) {
        clearCartId();
        return null;
      }
      throw err;
    }
  },
);

export const addToCartServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().positive().default(1),
      // Where the visitor came from, read from the browser at click time. The
      // cart is created lazily on this call, so this is the moment attribution
      // has to travel; unparseable attribution degrades to none rather than
      // failing the add.
      attribution: optionalAttribution,
    }),
  )
  .handler(async ({ data }): Promise<Cart> => {
    const addTo = (cartId: string) =>
      gqlFetch<{ addToCart: Cart }>(ADD_TO_CART_MUTATION, {
        cartId,
        variantId: data.variantId,
        quantity: data.quantity,
      });

    const cartId = await getOrCreateCartId(data.attribution);
    try {
      return (await addTo(cartId)).addToCart;
    } catch (err) {
      // The cookie's cart may have been abandoned by the backend's idle sweep
      // (or already converted / deleted). Discard it, mint a fresh cart, and
      // retry once so the visitor never gets stuck on a dead cart.
      if (
        err instanceof Error &&
        /no longer active|not found/i.test(err.message)
      ) {
        clearCartId();
        const freshId = await getOrCreateCartId(data.attribution);
        return (await addTo(freshId)).addToCart;
      }
      throw err;
    }
  });

export const updateCartItemServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      itemId: z.string().min(1),
      // 0 removes the line (enforced by the backend).
      quantity: z.number().int().min(0),
    }),
  )
  .handler(async ({ data }): Promise<Cart> => {
    const res = await gqlFetch<{ updateCartItem: Cart }>(
      UPDATE_CART_ITEM_MUTATION,
      { cartId: requireCartId(), itemId: data.itemId, quantity: data.quantity },
    );
    return res.updateCartItem;
  });

export const removeFromCartServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ itemId: z.string().min(1) }))
  .handler(async ({ data }): Promise<Cart> => {
    const res = await gqlFetch<{ removeFromCart: Cart }>(
      REMOVE_FROM_CART_MUTATION,
      { cartId: requireCartId(), itemId: data.itemId },
    );
    return res.removeFromCart;
  });

export const applyCouponServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().min(1) }))
  .handler(async ({ data }): Promise<Cart> => {
    const res = await gqlFetch<{ applyCoupon: Cart }>(APPLY_COUPON_MUTATION, {
      cartId: requireCartId(),
      code: data.code,
    });
    return res.applyCoupon;
  });

export const removeCouponServerFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<Cart> => {
    const res = await gqlFetch<{ removeCoupon: Cart }>(REMOVE_COUPON_MUTATION, {
      cartId: requireCartId(),
    });
    return res.removeCoupon;
  },
);
