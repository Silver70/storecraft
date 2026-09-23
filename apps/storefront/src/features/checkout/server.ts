import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { gqlFetch } from "~/lib/gql-client";
import {
  clearCartId,
  getCartId,
  getPendingOrder,
  getVisitorConsent,
  setPendingOrder,
} from "~/lib/session";
import type { CheckoutResult, Order, ShippingRate } from "~/types/api";
import { RECORD_CART_ATTRIBUTION_MUTATION } from "~/features/attribution/graphql";
import {
  CHECKOUT_MUTATION,
  ORDER_STATUS_QUERY,
  SHIPPING_RATES_QUERY,
} from "./graphql";

export const getShippingRatesServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      countryCode: z.string().length(2),
      orderSubtotal: z.number().int().min(0),
    }),
  )
  .handler(async ({ data }): Promise<ShippingRate[]> => {
    const res = await gqlFetch<{ shippingRates: ShippingRate[] }>(
      SHIPPING_RATES_QUERY,
      { countryCode: data.countryCode, orderSubtotal: data.orderSubtotal },
    );
    return res.shippingRates;
  });

const shippingAddressSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  company: z.string().max(255).optional(),
  line1: z.string().min(1).max(255),
  line2: z.string().max(255).optional(),
  city: z.string().min(1).max(100),
  state: z.string().max(100).optional(),
  postalCode: z.string().min(1).max(20),
  countryCode: z.string().length(2),
  phone: z.string().max(50).optional(),
});

export const createCheckoutServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      shippingAddress: shippingAddressSchema,
      shippingMethodId: z.string().min(1),
      email: z.string().email(),
      idempotencyKey: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const cartId = getCartId();
    if (!cartId) throw new Error("No active cart");

    await recordConsent(cartId);

    const res = await gqlFetch<{ checkout: CheckoutResult }>(
      CHECKOUT_MUTATION,
      {
        cartId,
        input: {
          shippingAddress: data.shippingAddress,
          shippingMethodId: data.shippingMethodId,
          email: data.email,
          idempotencyKey: data.idempotencyKey,
        },
      },
      { idempotencyKey: data.idempotencyKey },
    );

    // Cart is converted to an order server-side. Drop the cart cookie so the
    // header resets and a fresh cart starts, and stash the order context for
    // the guest confirmation page.
    clearCartId();
    setPendingOrder({
      orderNumber: res.checkout.orderNumber,
      email: data.email,
    });

    return res.checkout;
  });

/**
 * Writes the visitor's consent answer onto the cart a moment before it becomes
 * an order.
 *
 * Checkout is the last point at which the answer can still be corrected: from
 * here it is frozen on the order and is what decides, days later, whether a
 * Purchase Event may be reported about this person at all. The browser already
 * declares it on each add and when the banner is answered, so this is the
 * backstop for the one that did not land — a store that asks for consent gets
 * one small mutation, a store that does not gets none, because a visitor who
 * was never asked has no answer to send.
 *
 * Never throws: a reporting concern must not be able to stop a sale.
 */
async function recordConsent(cartId: string): Promise<void> {
  const measurementConsent = getVisitorConsent();
  if (!measurementConsent) return;
  try {
    await gqlFetch(RECORD_CART_ATTRIBUTION_MUTATION, {
      cartId,
      attribution: { measurementConsent },
    });
  } catch {
    // The cart keeps whatever it was last told, which is the answer the
    // shopper gave — just possibly an older reading of it.
  }
}

export const getOrderStatusServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      orderNumber: z.string().min(1),
      // Optional — defaults to the email stored at checkout (httpOnly cookie),
      // so the email never has to travel in the URL.
      email: z.string().email().optional(),
    }),
  )
  .handler(async ({ data }): Promise<Order | null> => {
    const pending = getPendingOrder();
    const email =
      data.email ??
      (pending?.orderNumber === data.orderNumber ? pending.email : undefined);
    if (!email) return null;

    const res = await gqlFetch<{ orderStatus: Order | null }>(
      ORDER_STATUS_QUERY,
      { orderNumber: data.orderNumber, email },
    );
    return res.orderStatus;
  });
