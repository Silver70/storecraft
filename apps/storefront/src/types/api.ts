/**
 * Shared GraphQL response shapes for the storefront.
 *
 * Hand-written to mirror the backend's storefront-facing GraphQL types (single
 * source of types, no codegen — keeps the template lean). All monetary values
 * are integer cents (`Int`), never the `Money` scalar. Feature-specific local
 * UI models belong in `features/<feature>/types.ts`, not here.
 *
 * If drift becomes a problem, `graphql-codegen` against an emitted `schema.gql`
 * is a future option.
 */

// ─── Content ────────────────────────────────────────────────────────────────

/**
 * A published Content Slot. The public API returns published values only —
 * there is no draft field on this type, because a draft has no business in a
 * shopper's browser.
 */
export interface ContentSlot {
  key: string;
  type: "heading" | "text";
  value: string;
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export interface ProductOptionValue {
  id: string;
  value: string;
  position: number;
}

export interface ProductOption {
  id: string;
  name: string;
  position: number;
  values: ProductOptionValue[];
}

export interface ProductMediaItem {
  id: string;
  url: string;
  altText?: string | null;
  mediaType: string;
  position: number;
  isPrimary: boolean;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name?: string | null;
  /** Price in cents. */
  price: number;
  /** Compare-at price in cents, when on sale. */
  compareAtPrice?: number | null;
  weight?: number | null;
  weightUnit?: string | null;
  requiresShipping: boolean;
  isActive: boolean;
  position: number;
  optionValues: ProductOptionValue[];
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  vendor?: string | null;
  tags?: string[] | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  variants: ProductVariant[];
  options: ProductOption[];
  media: ProductMediaItem[];
  categoryIds: string[];
  /** Lowest variant price in cents. */
  minPrice: number;
  /** Highest variant price in cents. */
  maxPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  parentId?: string | null;
  position: number;
  children: Category[];
  createdAt: string;
  updatedAt: string;
}

export interface PageInfo {
  endCursor?: string | null;
  hasNextPage: boolean;
}

export interface ProductEdge {
  node: Product;
  cursor: string;
}

export interface ProductConnection {
  edges: ProductEdge[];
  pageInfo: PageInfo;
  totalCount: number;
}

/** Filter accepted by the `products` query. */
export interface ProductFilter {
  categoryId?: string;
  search?: string;
  vendor?: string;
}

// ─── Cart ─────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string;
  variantId: string;
  quantity: number;
  /** Unit price in cents. */
  unitPrice: number;
  /** Line total in cents (quantity × unitPrice). */
  totalPrice: number;
  productName: string;
  /** Product slug, for linking back to the PDP. */
  productSlug: string;
  variantName?: string | null;
  sku: string;
  imageUrl?: string | null;
}

export interface Cart {
  id: string;
  customerId?: string | null;
  status: string;
  couponCode?: string | null;
  /** Subtotal before discounts, in cents. */
  subtotal: number;
  /** Total discount amount in cents. */
  discountAmount: number;
  /** Tax amount in cents (0 until checkout). */
  taxAmount: number;
  /** Shipping amount in cents (0 until checkout). */
  shippingAmount: number;
  /** Grand total in cents. */
  total: number;
  currency: string;
  items: CartItem[];
}

// ─── Checkout & shipping ──────────────────────────────────────────────────────

export interface ShippingRate {
  methodId: string;
  name: string;
  /** Price in cents. */
  price: number;
  rateType: string;
  estimatedDaysMin?: number | null;
  estimatedDaysMax?: number | null;
}

/** Inline shipping address for checkout (mirrors the GraphQL `AddressInput`). */
export interface ShippingAddressInput {
  firstName: string;
  lastName: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  phone?: string;
}

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  /** Stripe PaymentIntent client secret — handed to Stripe Elements only. */
  paymentClientSecret: string;
  /** Grand total charged in cents. */
  total: number;
  currency: string;
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export interface OrderAddress {
  firstName: string;
  lastName: string;
  company?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  countryCode: string;
  phone?: string | null;
}

export interface OrderLineItem {
  id: string;
  productName: string;
  variantName?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discountAmount: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  fulfillmentStatus: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  total: number;
  currency: string;
  couponCode?: string | null;
  shippingAddress: OrderAddress;
  lineItems: OrderLineItem[];
  createdAt: string;
  updatedAt: string;
}
