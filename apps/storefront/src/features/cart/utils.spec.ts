/**
 * The cart patch functions, exercised as pure units — no DOM, no React, no
 * network. What is asserted here is the cart a shopper ends up looking at
 * during the round-trip: which lines are in it, and what the money reads.
 *
 * These figures are a transient estimate that the server's authoritative cart
 * replaces on resolution, but they are money the shopper reads, so they are
 * pinned here in the smallest currency unit throughout.
 */
import { describe, expect, it } from "vitest";
import type { Cart } from "~/types/api";
import { optimisticQuantity, optimisticRemove } from "./utils";

/** Two tees at $25 and one mug at $12.50 — $62.50, nothing off. */
const CART: Cart = {
  id: "cart-1",
  status: "active",
  couponCode: null,
  subtotal: 62_50,
  discountAmount: 0,
  taxAmount: 0,
  shippingAmount: 0,
  total: 62_50,
  currency: "USD",
  items: [
    {
      id: "line-tee",
      variantId: "variant-tee-m",
      quantity: 2,
      unitPrice: 25_00,
      totalPrice: 50_00,
      productName: "Studio Tee",
      productSlug: "studio-tee",
      variantName: "Medium",
      sku: "TEE-M",
      imageUrl: null,
    },
    {
      id: "line-mug",
      variantId: "variant-mug",
      quantity: 1,
      unitPrice: 12_50,
      totalPrice: 12_50,
      productName: "Enamel Mug",
      productSlug: "enamel-mug",
      variantName: null,
      sku: "MUG",
      imageUrl: null,
    },
  ],
};

/** The same cart with $10 already taken off by a coupon. */
const DISCOUNTED: Cart = {
  ...CART,
  couponCode: "TENOFF",
  discountAmount: 10_00,
  total: 52_50,
};

const lineById = (cart: Cart, id: string) =>
  cart.items.find((item) => item.id === id);

describe("optimisticQuantity", () => {
  it("moves the line total, the subtotal and the cart total together", () => {
    const patched = optimisticQuantity(CART, "line-tee", 3);

    expect(lineById(patched, "line-tee")?.quantity).toBe(3);
    expect(lineById(patched, "line-tee")?.totalPrice).toBe(75_00);
    expect(patched.subtotal).toBe(87_50);
    expect(patched.total).toBe(87_50);
  });

  it("leaves every other line exactly as it was", () => {
    // A stepper on one row must not disturb the row below it.
    const patched = optimisticQuantity(CART, "line-tee", 3);

    expect(lineById(patched, "line-mug")).toEqual(lineById(CART, "line-mug"));
  });

  it("takes a quantity down as readily as up", () => {
    const patched = optimisticQuantity(CART, "line-tee", 1);

    expect(lineById(patched, "line-tee")?.totalPrice).toBe(25_00);
    expect(patched.subtotal).toBe(37_50);
    expect(patched.total).toBe(37_50);
  });

  it("removes the line at zero rather than leaving a zero-quantity row", () => {
    // Stepping down to zero is how a shopper removes the last unit. A row
    // reading "0 × Studio Tee" is a cart nobody has.
    const patched = optimisticQuantity(CART, "line-tee", 0);

    expect(patched.items.map((item) => item.id)).toEqual(["line-mug"]);
    expect(patched.items.some((item) => item.quantity === 0)).toBe(false);
    expect(patched.subtotal).toBe(12_50);
    expect(patched.total).toBe(12_50);
  });

  it("treats a negative quantity as a removal too", () => {
    expect(optimisticQuantity(CART, "line-tee", -1).items).toEqual(
      optimisticQuantity(CART, "line-tee", 0).items,
    );
  });

  it("keeps the server's discount and takes it off the new subtotal", () => {
    // The client cannot reprice a coupon, so the estimate carries the discount
    // across unchanged. Recomputing it here is what the round-trip is for.
    const patched = optimisticQuantity(DISCOUNTED, "line-mug", 2);

    expect(patched.discountAmount).toBe(10_00);
    expect(patched.subtotal).toBe(75_00);
    expect(patched.total).toBe(65_00);
  });

  it("never shows a negative total when the discount outruns the subtotal", () => {
    // Shrinking a heavily discounted cart must floor at zero; a total of
    // -$5.00 is the sort of number a shopper screenshots.
    const patched = optimisticQuantity(
      { ...DISCOUNTED, discountAmount: 60_00, total: 2_50 },
      "line-tee",
      1,
    );

    expect(patched.subtotal).toBe(37_50);
    expect(patched.total).toBe(0);
  });

  it("keeps every figure in whole cents", () => {
    // Money is integer cents everywhere; a fractional total here would be a
    // division that crept into the estimate.
    const patched = optimisticQuantity(DISCOUNTED, "line-mug", 3);

    for (const amount of [
      patched.subtotal,
      patched.total,
      ...patched.items.map((item) => item.totalPrice),
    ]) {
      expect(Number.isInteger(amount)).toBe(true);
    }
  });

  it("leaves a cart holding no such line untouched", () => {
    const patched = optimisticQuantity(CART, "line-gone", 5);

    expect(patched.items).toEqual(CART.items);
    expect(patched.subtotal).toBe(62_50);
    expect(patched.total).toBe(62_50);
  });

  it("does not mutate the cached cart it was handed", () => {
    // The cache holds this object; patching in place would leave nothing to
    // roll back to when the mutation fails.
    optimisticQuantity(CART, "line-tee", 9);

    expect(lineById(CART, "line-tee")?.quantity).toBe(2);
    expect(CART.subtotal).toBe(62_50);
    expect(CART.total).toBe(62_50);
  });
});

describe("optimisticRemove", () => {
  it("drops the line and takes its share off both totals", () => {
    const patched = optimisticRemove(CART, "line-tee");

    expect(patched.items.map((item) => item.id)).toEqual(["line-mug"]);
    expect(patched.subtotal).toBe(12_50);
    expect(patched.total).toBe(12_50);
  });

  it("carries the discount over onto the smaller subtotal", () => {
    const patched = optimisticRemove(DISCOUNTED, "line-mug");

    expect(patched.discountAmount).toBe(10_00);
    expect(patched.subtotal).toBe(50_00);
    expect(patched.total).toBe(40_00);
  });

  it("leaves an empty cart rather than a malformed one on the last line", () => {
    const emptied = optimisticRemove(
      optimisticRemove(CART, "line-tee"),
      "line-mug",
    );

    expect(emptied.items).toEqual([]);
    expect(emptied.subtotal).toBe(0);
    expect(emptied.total).toBe(0);
    // Still the same cart: the drawer renders its empty state, and the id the
    // server response will land against is intact.
    expect(emptied.id).toBe("cart-1");
    expect(emptied.currency).toBe("USD");
    expect(emptied.status).toBe("active");
  });

  it("empties a discounted cart to zero, not to minus the discount", () => {
    const emptied = optimisticRemove(
      optimisticRemove(DISCOUNTED, "line-tee"),
      "line-mug",
    );

    expect(emptied.subtotal).toBe(0);
    expect(emptied.total).toBe(0);
  });

  it("leaves a cart holding no such line untouched", () => {
    const patched = optimisticRemove(CART, "line-gone");

    expect(patched.items).toEqual(CART.items);
    expect(patched.total).toBe(62_50);
  });

  it("does not mutate the cached cart it was handed", () => {
    optimisticRemove(CART, "line-tee");

    expect(CART.items.map((item) => item.id)).toEqual(["line-tee", "line-mug"]);
    expect(CART.total).toBe(62_50);
  });
});
