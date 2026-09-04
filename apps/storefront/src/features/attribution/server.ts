import { createServerFn } from "@tanstack/react-start";
import { gqlFetch } from "~/lib/gql-client";
import { getCartId } from "~/lib/session";
import { optionalAttribution } from "./schema";
import { RECORD_CART_ATTRIBUTION_MUTATION } from "./graphql";

/**
 * Tells an existing cart about a new arrival: the visitor came back through a
 * different campaign before they finished buying, so its last touch should
 * advance while its first touch stays put.
 *
 * Deliberately does **not** create a cart. A visitor who has added nothing has
 * no cart to attribute, and minting one per campaign landing would fill the
 * table with empty carts — the first touch is already stored in the browser and
 * travels with the cart when one is finally created.
 *
 * Never throws: this runs fire-and-forget from an effect, and a reporting
 * concern must not surface as an error to a shopper.
 */
export const syncAttributionServerFn = createServerFn({ method: "POST" })
  .inputValidator(optionalAttribution)
  .handler(async ({ data }): Promise<{ recorded: boolean }> => {
    const cartId = getCartId();
    if (!cartId || !data) return { recorded: false };

    try {
      await gqlFetch(RECORD_CART_ATTRIBUTION_MUTATION, {
        cartId,
        attribution: data,
      });
      return { recorded: true };
    } catch {
      // The cart may have been checked out or swept since the cookie was set.
      // Either way the order it became already carries its frozen copy.
      return { recorded: false };
    }
  });
