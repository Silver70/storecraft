import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Cart } from "~/types/api";
import { readDeclaredAttribution } from "~/features/attribution/client";
import { CART_QUERY_KEY, cartQueryOptions } from "./queries";
import {
  addToCartServerFn,
  applyCouponServerFn,
  removeCouponServerFn,
  removeFromCartServerFn,
  updateCartItemServerFn,
} from "./server";
import type { AddedLine } from "./utils";
import { optimisticAdd, optimisticQuantity, optimisticRemove } from "./utils";

/** Read the cart (server state). Powers the header badge, drawer, and page. */
export function useCart() {
  return useQuery(cartQueryOptions());
}

interface OptimisticContext {
  previous: Cart | null | undefined;
}

/**
 * Add a variant to the cart. Its own hook rather than one of `useCartMutations`
 * because it is the only cart mutation a page outside the cart calls, and the
 * only one that needs the product's display details.
 *
 * The cached cart is patched on the click — synthesizing a cart when the
 * shopper has none yet, merging into the line when the variant is already
 * there — and the server's authoritative cart replaces that estimate wholesale
 * when it lands. A failure puts the cart back exactly as it was.
 */
export function useAddToCart() {
  const queryClient = useQueryClient();
  // Two quick clicks race, and only the newest add owns the cache: an older
  // response landing last would show a cart a unit behind, and an older
  // rollback would wipe the newer estimate off the top of it.
  const newest = React.useRef(0);

  return useMutation({
    mutationFn: (line: AddedLine) =>
      addToCartServerFn({
        data: {
          variantId: line.variantId,
          quantity: line.quantity,
          // Read here rather than held in state: this is the first add, so it
          // is the call that creates the cart, and the first touch it carries
          // may have been recorded on a visit days ago.
          attribution: readDeclaredAttribution(),
        },
      }),
    onMutate: async (line) => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
      const previous = queryClient.getQueryData<Cart | null>(CART_QUERY_KEY);
      queryClient.setQueryData(CART_QUERY_KEY, optimisticAdd(previous, line));
      return { previous, seq: ++newest.current };
    },
    onSuccess: (cart, _line, ctx) => {
      if (ctx.seq === newest.current)
        queryClient.setQueryData(CART_QUERY_KEY, cart);
    },
    onError: (_err, _line, ctx) => {
      if (!ctx || ctx.seq !== newest.current) return;
      queryClient.setQueryData(CART_QUERY_KEY, ctx.previous);
      // An add can fail because the cookie's cart was swept or converted, which
      // makes the cart we just rolled back to stale too. Refetching settles it:
      // the read clears a dead cookie and reports no cart, so the next add
      // mints a fresh one instead of failing against the old one forever.
      queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
    },
  });
}

/**
 * Cart mutations for a cart the shopper is already looking at. Each commerce
 * mutation returns the full, repriced cart, so we write that authoritative
 * result straight into the `["cart"]` cache (no refetch). Quantity edits and
 * removals additionally patch optimistically for a snappy stepper, rolling
 * back on error.
 */
export function useCartMutations() {
  const queryClient = useQueryClient();
  const setCart = (cart: Cart) =>
    queryClient.setQueryData(CART_QUERY_KEY, cart);

  const updateItem = useMutation({
    mutationFn: (vars: { itemId: string; quantity: number }) =>
      updateCartItemServerFn({ data: vars }),
    onMutate: async (vars): Promise<OptimisticContext> => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
      const previous = queryClient.getQueryData<Cart | null>(CART_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData(
          CART_QUERY_KEY,
          optimisticQuantity(previous, vars.itemId, vars.quantity),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(CART_QUERY_KEY, ctx.previous);
    },
    onSuccess: setCart,
  });

  const removeItem = useMutation({
    mutationFn: (vars: { itemId: string }) =>
      removeFromCartServerFn({ data: vars }),
    onMutate: async (vars): Promise<OptimisticContext> => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
      const previous = queryClient.getQueryData<Cart | null>(CART_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData(
          CART_QUERY_KEY,
          optimisticRemove(previous, vars.itemId),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(CART_QUERY_KEY, ctx.previous);
    },
    onSuccess: setCart,
  });

  const applyCoupon = useMutation({
    mutationFn: (vars: { code: string }) => applyCouponServerFn({ data: vars }),
    onSuccess: setCart,
  });

  const removeCoupon = useMutation({
    mutationFn: () => removeCouponServerFn(),
    onSuccess: setCart,
  });

  // Which line, if any, has an edit in flight. Pages hand this to the line
  // item so only the line the shopper touched freezes its controls — the same
  // per-line behaviour as when each line owned its own mutation.
  const pendingItemId =
    (updateItem.isPending && updateItem.variables?.itemId) ||
    (removeItem.isPending && removeItem.variables?.itemId) ||
    null;

  return {
    updateItem,
    removeItem,
    applyCoupon,
    removeCoupon,
    pendingItemId,
  };
}
