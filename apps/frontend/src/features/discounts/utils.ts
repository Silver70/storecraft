import type { Discount, DiscountStatus } from "~/types/api";

/** Derive a discount's effective status from its active flag and date window. */
export function computeDiscountStatus(d: Discount): DiscountStatus {
  const now = new Date();
  if (!d.isActive) return "expired";
  if (d.endsAt && new Date(d.endsAt) < now) return "expired";
  if (d.startsAt && new Date(d.startsAt) > now) return "scheduled";
  return "active";
}

/**
 * Display a discount value: "20%" or "$10.00". `value` is stored in hundredths
 * of the display unit — basis points for percentage, cents for fixed_amount.
 */
export function formatValue(d: Discount): string {
  if (d.type !== "percentage") return `$${(d.value / 100).toFixed(2)}`;
  const pct = d.value / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** Short label for what a discount applies to. */
export function formatScope(d: Discount): string {
  if (d.scope === "order") return "All orders";
  if (d.scope === "category")
    return d.scopeId ? `Category ${d.scopeId.slice(0, 8)}` : "Category";
  return d.scopeId ? `Product ${d.scopeId.slice(0, 8)}` : "Product";
}

/** Generate a random coupon code like "DISC-4F9A". */
export function autoGenerateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const part = Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  return `DISC-${part}`;
}
