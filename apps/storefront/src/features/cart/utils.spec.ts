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
import type { AddedLine } from "./utils";
import type { Cart } from "~/types/api";
import { storeConfig } from "~/config/store.config";
import {
  OPTIMISTIC_CART_ID,
  isOptimisticLine,
  itemCount,
  optimisticAdd,
  optimisticQuantity,
  optimisticRemove,
} from "./utils";

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

/** One cap at $18, from a product page the shopper is looking at right now. */
const ADD_CAP: AddedLine = {
  variantId: "variant-cap",
  quantity: 1,
  unitPrice: 18_00,
  productName: "Field Cap",
  productSlug: "field-cap",
  variantName: "One size",
  sku: "CAP",
  imageUrl: "https://cdn.example.com/cap.jpg",
};

/** One more of the tee already sitting in the cart. */
const ADD_TEE: AddedLine = {
  variantId: "variant-tee-m",
  quantity: 1,
  unitPrice: 25_00,
  productName: "Studio Tee",
  productSlug: "studio-tee",
  variantName: "Medium",
  sku: "TEE-M",
  imageUrl: null,
};

describe("optimisticAdd", () => {
  describe("with no cart yet", () => {
    // The cart is created lazily on the first add, so the patch has to
    // synthesize the whole cart. A shopper's first add must feel exactly like
    // their second.
    it("synthesizes a cart holding the line", () => {
      const patched = optimisticAdd(null, ADD_CAP);

      expect(patched.items).toHaveLength(1);
      expect(patched.items[0]).toMatchObject({
        variantId: "variant-cap",
        quantity: 1,
        unitPrice: 18_00,
        totalPrice: 18_00,
        productName: "Field Cap",
        productSlug: "field-cap",
        variantName: "One size",
        sku: "CAP",
        imageUrl: "https://cdn.example.com/cap.jpg",
      });
      expect(patched.subtotal).toBe(18_00);
      expect(patched.total).toBe(18_00);
    });

    it("discounts, taxes and ships nothing on a cart that does not exist", () => {
      const patched = optimisticAdd(undefined, ADD_CAP);

      expect(patched.discountAmount).toBe(0);
      expect(patched.taxAmount).toBe(0);
      expect(patched.shippingAmount).toBe(0);
      expect(patched.couponCode).toBeNull();
    });

    it("renders as a live cart: active, in the store's currency, badged", () => {
      // The drawer, the summary and the badge all read this cart before the
      // server has issued one, so it has to be shaped like the real thing.
      const patched = optimisticAdd(null, ADD_CAP);

      expect(patched.status).toBe("active");
      expect(patched.currency).toBe(storeConfig.currency);
      expect(itemCount(patched)).toBe(1);
    });

    it("carries a multi-unit add through at the right money", () => {
      const patched = optimisticAdd(null, { ...ADD_CAP, quantity: 3 });

      expect(patched.items[0]?.totalPrice).toBe(54_00);
      expect(patched.subtotal).toBe(54_00);
      expect(patched.total).toBe(54_00);
    });
  });

  describe("adding a variant the cart does not hold", () => {
    it("appends the line and moves both totals", () => {
      const patched = optimisticAdd(CART, ADD_CAP);

      expect(patched.items).toHaveLength(3);
      expect(patched.items[2]?.variantId).toBe("variant-cap");
      expect(patched.subtotal).toBe(80_50);
      expect(patched.total).toBe(80_50);
    });

    it("leaves the lines already there exactly as they were", () => {
      const patched = optimisticAdd(CART, ADD_CAP);

      expect(patched.items.slice(0, 2)).toEqual(CART.items);
    });

    it("keeps the server's discount and takes it off the new subtotal", () => {
      // The client cannot reprice a coupon against a bigger cart; the
      // round-trip is what recomputes it.
      const patched = optimisticAdd(DISCOUNTED, ADD_CAP);

      expect(patched.discountAmount).toBe(10_00);
      expect(patched.subtotal).toBe(80_50);
      expect(patched.total).toBe(70_50);
    });

    it("moves the badge by the units added", () => {
      expect(itemCount(CART)).toBe(3);
      expect(itemCount(optimisticAdd(CART, { ...ADD_CAP, quantity: 2 }))).toBe(
        5,
      );
    });
  });

  describe("adding a variant the cart already holds", () => {
    // Appending a second line would double the badge and show a cart the
    // shopper does not have — the failure that gets reported as "it added it
    // twice", and the one a manual test that only ever adds one thing misses.
    it("merges into the line already holding that variant", () => {
      const patched = optimisticAdd(CART, ADD_TEE);

      expect(patched.items).toHaveLength(2);
      expect(patched.items.map((item) => item.id)).toEqual([
        "line-tee",
        "line-mug",
      ]);
      expect(lineById(patched, "line-tee")?.quantity).toBe(3);
      expect(lineById(patched, "line-tee")?.totalPrice).toBe(75_00);
    });

    it("counts the badge as the sum, not as a doubled line", () => {
      const patched = optimisticAdd(CART, ADD_TEE);

      expect(itemCount(patched)).toBe(4);
    });

    it("moves the totals by one unit, not by a whole second line", () => {
      const patched = optimisticAdd(CART, ADD_TEE);

      expect(patched.subtotal).toBe(87_50);
      expect(patched.total).toBe(87_50);
    });

    it("prices the merge at the line's price, not the page's", () => {
      // The product page may be showing a price the cart line was not created
      // at — a sale that started mid-session, a stale render. The cart is what
      // the shopper is buying at, so the line's own unit price wins.
      const patched = optimisticAdd(CART, { ...ADD_TEE, unitPrice: 5_00 });

      expect(lineById(patched, "line-tee")?.unitPrice).toBe(25_00);
      expect(lineById(patched, "line-tee")?.totalPrice).toBe(75_00);
    });

    it("compounds two quick clicks rather than swallowing one", () => {
      // Both clicks reach the server; the second patch reads the first's
      // estimate out of the cache, so the shopper sees two units go on.
      const patched = optimisticAdd(optimisticAdd(CART, ADD_TEE), ADD_TEE);

      expect(patched.items).toHaveLength(2);
      expect(lineById(patched, "line-tee")?.quantity).toBe(4);
      expect(itemCount(patched)).toBe(5);
    });

    it("merges a repeat of a line it synthesized itself", () => {
      // Two clicks before any cart exists: the first invents the cart, the
      // second has to find its own line in it.
      const patched = optimisticAdd(optimisticAdd(null, ADD_CAP), ADD_CAP);

      expect(patched.items).toHaveLength(1);
      expect(patched.items[0]?.quantity).toBe(2);
      expect(patched.subtotal).toBe(36_00);
    });
  });

  describe("as an estimate", () => {
    it("marks a line it invented, and leaves the server's alone", () => {
      // Nothing on the server answers to this id, so the stepper and the remove
      // control read this and stay frozen until the real cart lands.
      const patched = optimisticAdd(CART, ADD_CAP);

      expect(patched.items.filter(isOptimisticLine)).toHaveLength(1);
      expect(isOptimisticLine(patched.items[2]!)).toBe(true);
      expect(isOptimisticLine(patched.items[0]!)).toBe(false);
    });

    it("leaves a merged line addressable, because the server issued it", () => {
      const patched = optimisticAdd(CART, ADD_TEE);

      expect(patched.items.some(isOptimisticLine)).toBe(false);
    });

    it("is thrown away whole when the server's cart lands", () => {
      // The mutation writes the server's cart into the cache rather than
      // merging into the estimate, so nothing the client invented survives it.
      const estimate = optimisticAdd(null, ADD_CAP);
      expect(estimate.id).toBe(OPTIMISTIC_CART_ID);
      expect(estimate.items.every(isOptimisticLine)).toBe(true);

      const confirmed: Cart = {
        ...estimate,
        id: "cart-9",
        items: [{ ...estimate.items[0]!, id: "line-cap" }],
      };

      expect(confirmed.items.some(isOptimisticLine)).toBe(false);
      expect(confirmed.id).not.toBe(OPTIMISTIC_CART_ID);
      expect(itemCount(confirmed)).toBe(itemCount(estimate));
    });

    it("never shows a negative total when the discount outruns the subtotal", () => {
      const patched = optimisticAdd(
        {
          ...DISCOUNTED,
          items: [],
          discountAmount: 60_00,
          subtotal: 0,
          total: 0,
        },
        ADD_CAP,
      );

      expect(patched.subtotal).toBe(18_00);
      expect(patched.total).toBe(0);
    });

    it("keeps every figure in whole cents", () => {
      const patched = optimisticAdd(DISCOUNTED, { ...ADD_CAP, quantity: 3 });

      for (const amount of [
        patched.subtotal,
        patched.total,
        ...patched.items.map((item) => item.totalPrice),
      ]) {
        expect(Number.isInteger(amount)).toBe(true);
      }
    });

    it("does not mutate the cached cart it was handed", () => {
      // The cache holds this object; patching in place would leave nothing for
      // a failed add to roll back to.
      optimisticAdd(CART, ADD_CAP);
      optimisticAdd(CART, ADD_TEE);

      expect(CART.items.map((item) => item.id)).toEqual([
        "line-tee",
        "line-mug",
      ]);
      expect(lineById(CART, "line-tee")?.quantity).toBe(2);
      expect(CART.subtotal).toBe(62_50);
      expect(CART.total).toBe(62_50);
    });
  });
});
