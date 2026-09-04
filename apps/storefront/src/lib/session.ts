/**
 * Server-only cookie/session helpers.
 *
 * The cart id and the customer's JWTs live in httpOnly, Secure, SameSite=Lax
 * cookies set by server functions — never in localStorage, never JS-readable,
 * never in URLs or query keys. A client therefore cannot operate on someone
 * else's cart: every cart server fn derives the cart id from the cookie.
 */
import {
  getCookie,
  setCookie,
  deleteCookie,
} from "@tanstack/react-start/server";
import { gqlFetch } from "./gql-client";
import { CREATE_CART_MUTATION } from "~/features/attribution/graphql";
import type { DeclaredAttributionInput } from "~/features/attribution/schema";

const CART_COOKIE = "cartId";
const CUSTOMER_ACCESS_COOKIE = "customerAccessToken";
const CUSTOMER_REFRESH_COOKIE = "customerRefreshToken";

const ONE_HOUR = 60 * 60;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// ─── Cart ─────────────────────────────────────────────────────────────────────

/**
 * Returns the current cart id from the httpOnly cookie, creating a fresh cart
 * (and setting the cookie) when none exists. Every cart server fn calls this so
 * the cart id is always server-derived and never trusted from the client.
 *
 * `attribution` is where the visitor came from, as the browser recorded it. It
 * is declared here because this is the one moment it can be — the cart is
 * created on the visitor's first add, and everything after that reads a frozen
 * copy. Omitting it produces an Unattributed order and nothing else.
 */
export async function getOrCreateCartId(
  attribution?: DeclaredAttributionInput,
): Promise<string> {
  const existing = getCookie(CART_COOKIE);
  if (existing) return existing;

  const create = (declared?: DeclaredAttributionInput) =>
    gqlFetch<{ createCart: { id: string } }>(CREATE_CART_MUTATION, {
      attribution: declared ?? null,
    });

  let createCart: { id: string };
  try {
    createCart = (await create(attribution)).createCart;
  } catch (err) {
    // Attribution must never cost a sale. If the declaration itself is what the
    // API rejected, mint the cart without it and let the order be Unattributed.
    if (!attribution) throw err;
    createCart = (await create()).createCart;
  }

  setCookie(CART_COOKIE, createCart.id, {
    ...baseCookieOptions,
    maxAge: THIRTY_DAYS,
  });
  return createCart.id;
}

/** Read the current cart id without creating one (undefined when absent). */
export function getCartId(): string | undefined {
  return getCookie(CART_COOKIE);
}

/** Forget the current cart (e.g. after a successful checkout). */
export function clearCartId(): void {
  deleteCookie(CART_COOKIE, baseCookieOptions);
}

// ─── Customer session (Account feature — optional v1) ───────────────────────

export function getCustomerToken(): string | undefined {
  return getCookie(CUSTOMER_ACCESS_COOKIE);
}

export function getCustomerRefreshToken(): string | undefined {
  return getCookie(CUSTOMER_REFRESH_COOKIE);
}

export function setCustomerSession(tokens: {
  accessToken: string;
  refreshToken: string;
}): void {
  setCookie(CUSTOMER_ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookieOptions,
    maxAge: ONE_HOUR,
  });
  setCookie(CUSTOMER_REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions,
    maxAge: THIRTY_DAYS,
  });
}

export function clearCustomerSession(): void {
  deleteCookie(CUSTOMER_ACCESS_COOKIE, baseCookieOptions);
  deleteCookie(CUSTOMER_REFRESH_COOKIE, baseCookieOptions);
}

// ─── Pending order (guest confirmation) ─────────────────────────────────────
// After checkout we stash the order number + email server-side so the guest
// confirmation page can poll `orderStatus` (which needs both) without putting
// the email in the URL.

const PENDING_ORDER_COOKIE = "pendingOrder";

export interface PendingOrder {
  orderNumber: string;
  email: string;
}

export function setPendingOrder(order: PendingOrder): void {
  setCookie(PENDING_ORDER_COOKIE, JSON.stringify(order), {
    ...baseCookieOptions,
    maxAge: 60 * 60 * 24, // 1 day — long enough to confirm payment
  });
}

export function getPendingOrder(): PendingOrder | null {
  const raw = getCookie(PENDING_ORDER_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingOrder;
    if (
      typeof parsed?.orderNumber === "string" &&
      typeof parsed?.email === "string"
    ) {
      return parsed;
    }
  } catch {
    // malformed cookie — treat as absent
  }
  return null;
}

export function clearPendingOrder(): void {
  deleteCookie(PENDING_ORDER_COOKIE, baseCookieOptions);
}
