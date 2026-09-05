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
import { optimisticQuantity, optimisticRemove } from "./utils";

/** Read the cart (server state). Powers the header badge, drawer, and page. */
export function useCart() {
  return useQuery(cartQueryOptions());
}

interface OptimisticContext {
  previous: Cart | null | undefined;
}

/**
 * Cart mutations. Each commerce mutation returns the full, repriced cart, so we
 * write that authoritative result straight into the `["cart"]` cache (no
 * refetch). Quantity edits and removals additionally patch optimistically for a
 * snappy stepper, rolling back on error.
 */
export function useCartMutations() {
  const queryClient = useQueryClient();
  const setCart = (cart: Cart) =>
    queryClient.setQueryData(CART_QUERY_KEY, cart);

  const addToCart = useMutation({
    mutationFn: (vars: { variantId: string; quantity?: number }) =>
      addToCartServerFn({
        data: {
          variantId: vars.variantId,
          quantity: vars.quantity ?? 1,
          // Read here rather than held in state: this is the first add, so it
          // is the call that creates the cart, and the first touch it carries
          // may have been recorded on a visit days ago.
          attribution: readDeclaredAttribution(),
        },
      }),
    onSuccess: setCart,
  });

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
    addToCart,
    updateItem,
    removeItem,
    applyCoupon,
    removeCoupon,
    pendingItemId,
  };
}
