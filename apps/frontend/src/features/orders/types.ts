// UI-only types for the manual create-order flow (draft state held in the form
// before submission). Server-shaped types live in ~/types/api.

// A single purchasable variant, flattened from the product catalog, used by the
// product search box. Prices are in integer cents (matching the backend).
export type CatalogVariant = {
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  unitPrice: number; // cents
  imageUrl: string | null;
};

// A line item in the draft order. `variantId` is the row identity (variants are
// deduped on add). Prices are in integer cents.
export type LineItem = {
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  imageUrl: string | null;
  qty: number;
  unitPrice: number; // cents
};

// A coupon resolved from the real backend coupon list and applied to the draft
// order. Value units match the backend `Coupon`: percentage is basis points
// (2000 = 20%), fixed_amount is integer cents, free_shipping ignores `value`.
export type AppliedDiscount = {
  type: "percentage" | "fixed_amount" | "free_shipping";
  value: number;
  label: string;
};

// Editable shipping-address draft. All fields are strings; empty optionals are
// converted to `undefined` when building the create-order payload. Mirrors the
// backend ManualOrderAddressDto / CreateAddressDto.
export type ShippingAddress = {
  firstName: string;
  lastName: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phone: string;
};
