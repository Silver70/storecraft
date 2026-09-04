// ─── Auth ─────────────────────────────────────────────────────────────────────

export type AdminRole = "super_admin" | "product_manager" | "support_agent";

export type OrganizationMembership = {
  organizationId: string;
  organizationName: string;
  role: AdminRole;
};

// Shape returned by GET /api/auth/me
export type AdminUser = {
  userId: string;
  email: string;
  name: string | null;
  organizationId: string;
  role: AdminRole;
  memberships: OrganizationMembership[];
};

// Returned by listByStore / listByOrg — rawKey is omitted (hash only stored)
export type ApiKey = {
  id: string;
  storeId: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

// Returned only on key generation (rawKey shown once and never persisted)
export type ApiKeyWithSecret = ApiKey & {
  rawKey: string;
};

// ─── Organizations ────────────────────────────────────────────────────────────

// currency/timezone here are only defaults for new stores; authoritative values live on Store
export type Organization = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  logoUrl: string | null;
};

// ─── Stores ───────────────────────────────────────────────────────────────────

// The active store scopes all catalog / orders / inventory / pricing / shipping data.
// currency and timezone are authoritative here, not on Organization.
export type Store = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  isActive: boolean;
};

// ─── Products ─────────────────────────────────────────────────────────────────

export type ProductStatus = "draft" | "active" | "archived";

export type OptionValue = {
  id: string;
  value: string;
  position: number;
};

export type ProductOption = {
  id: string;
  name: string;
  position: number;
  values: OptionValue[];
};

export type ProductVariant = {
  id: string;
  sku: string;
  name: string | null;
  price: number;
  compareAtPrice: number | null;
  isActive: boolean;
  position: number;
  optionValues: OptionValue[];
};

export type ProductMedia = {
  id: string;
  url: string;
  altText: string | null;
  mediaType: string;
  position: number;
  isPrimary: boolean;
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProductStatus;
  vendor: string | null;
  tags: string[] | null;
  variants: ProductVariant[];
  options: ProductOption[];
  media: ProductMedia[];
  categoryIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description?: string | null;
  position?: number;
  children: Category[];
};

// ─── Orders ───────────────────────────────────────────────────────────────────

export type OrderStatus =
  | "pending"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "refunded"
  | "cancelled";

export type FulfillmentStatus = "unfulfilled" | "partial" | "fulfilled";

export type OrderLineItem = {
  id: string;
  productName: string;
  variantName: string | null;
  sku: string | null;
  unitPrice: number;
  totalPrice: number;
  discountAmount: number;
  quantity: number;
  imageUrl: string | null;
};

export type OrderTimelineEvent = {
  id: string;
  eventType: string;
  message: string;
  actorType: string | null;
  actorId: string | null;
  createdAt: string;
};

export type Order = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  customerEmail: string;
  customerName: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  total: number;
  currency: string;
  couponCode: string | null;
  // total units across the order's line items — present on list responses
  itemCount?: number;
  // only present on detail endpoint responses
  lineItems?: OrderLineItem[];
  timeline?: OrderTimelineEvent[];
  createdAt: string;
};

// ─── Customers ────────────────────────────────────────────────────────────────

// Backend enum: only "active" | "disabled"
export type CustomerStatus = "active" | "disabled";

// Org-scoped customer group (mirrors the customer_groups table)
export type CustomerGroup = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

// Matches the backend Address schema exactly
export type CustomerAddress = {
  id: string;
  customerId: string;
  firstName: string;
  lastName: string;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
};

// SafeCustomer — raw DB row minus passwordHash. No computed ordersCount / totalSpent.
export type Customer = {
  id: string;
  organizationId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: CustomerStatus;
  emailVerified: boolean;
  marketingOptIn: boolean;
  groupId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined / computed — not returned by the admin list or detail endpoint.
  // Available only when fetched separately or enriched server-side.
  group?: CustomerGroup;
  ordersCount?: number;
  totalSpent?: number;
  addresses?: CustomerAddress[];
};

// POST /admin/customers returns the new customer plus a one-time link the admin
// shares manually so the customer can set their password.
export type CreatedCustomerResult = {
  customer: Customer;
  setPasswordUrl: string;
};

export type SetPasswordLinkResult = {
  setPasswordUrl: string;
  expiresAt: string;
};

// ─── Inventory ────────────────────────────────────────────────────────────────

export type StockStatus = "ok" | "low" | "out";

// Matches the inventory_items DB schema exactly. No joined sku / product name.
export type InventoryItem = {
  id: string;
  organizationId: string;
  storeId: string;
  variantId: string;
  quantity: number;
  reserved: number;
  allowBackorder: boolean;
  lowStockThreshold: number;
  updatedAt: string;
};

// Inventory item enriched with variant + product labels (list endpoints).
export type InventoryItemView = InventoryItem & {
  sku: string;
  variantName: string | null;
  productName: string;
};

// ─── Discounts & Coupons ──────────────────────────────────────────────────────

export type DiscountType = "percentage" | "fixed_amount";
// Computed client-side from isActive + startsAt + endsAt — not a backend field
export type DiscountStatus = "active" | "scheduled" | "expired";
export type DiscountScope = "order" | "category" | "product";

// Raw Discount row from backend (no coupons array, no computed status/usage)
export type Discount = {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  type: DiscountType;
  value: number;
  scope: DiscountScope;
  scopeId: string | null;
  minOrderAmount: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CouponType = "percentage" | "fixed_amount" | "free_shipping";

// Raw Coupon row from backend
export type Coupon = {
  id: string;
  organizationId: string;
  storeId: string;
  code: string;
  type: CouponType;
  value: number;
  minOrderAmount: number | null;
  maxUsageCount: number | null;
  usageCount: number;
  maxUsagePerCustomer: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Campaigns ────────────────────────────────────────────────────────────────

/**
 * Kept in sync with the `campaign_platform` enum in the backend schema. Adding
 * one is an `ALTER TYPE ... ADD VALUE` there and a line here.
 */
export const CAMPAIGN_PLATFORMS = [
  "meta",
  "google",
  "tiktok",
  "instagram",
  "youtube",
  "x",
  "linkedin",
  "pinterest",
  "email",
  "sms",
  "affiliate",
  "influencer",
  "other",
] as const;

export type CampaignPlatform = (typeof CAMPAIGN_PLATFORMS)[number];

/** There is no deleted state — a campaign explains orders already reported. */
export type CampaignStatus = "active" | "archived";

// Raw campaigns row from backend
export type Campaign = {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  /**
   * The canonical `utm_campaign` value. Assigned at creation, unique within the
   * store, and unchanged by a rename so links already live keep matching.
   */
  tag: string;
  platform: CampaignPlatform;
  externalId: string | null;
  status: CampaignStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Price Lists ──────────────────────────────────────────────────────────────

export type PriceListType = "fixed" | "adjustment";
// Computed client-side from isActive + startsAt + endsAt (mirrors DiscountStatus)
export type PriceListStatus = "active" | "scheduled" | "expired";

// Raw price_lists row from backend
export type PriceList = {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  type: PriceListType;
  // signed basis points, present only when type === "adjustment"
  adjustmentBasisPoints: number | null;
  priority: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Explicit per-variant price (only used by type === "fixed")
export type PriceListPrice = {
  id: string;
  organizationId: string;
  priceListId: string;
  variantId: string;
  price: number;
  createdAt: string;
  updatedAt: string;
};

// Binds a price list to a customer or group (exactly one is set)
export type PriceListAssignment = {
  id: string;
  organizationId: string;
  priceListId: string;
  customerId: string | null;
  groupId: string | null;
  createdAt: string;
};

// GET /admin/price-lists/:id returns the list plus its prices + assignments
export type PriceListDetail = PriceList & {
  prices: PriceListPrice[];
  assignments: PriceListAssignment[];
};

// ─── Shipping ─────────────────────────────────────────────────────────────────

export type RateType = "flat_rate" | "free" | "calculated";

// Raw ShippingMethod row — no description field; days use estimatedDays* naming
export type ShippingMethod = {
  id: string;
  organizationId: string;
  storeId: string;
  zoneId: string;
  name: string;
  rateType: RateType;
  price: number;
  minOrderAmount: number | null;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// Raw ShippingZone row — methods are fetched separately via GET /shipping/methods?zoneId=
export type ShippingZone = {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  countries: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

// ─── Tax Rates ────────────────────────────────────────────────────────────────

// Field names match the tax_rates DB schema (countryCode / stateCode)
export type TaxRate = {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  countryCode: string;
  stateCode: string | null;
  rate: number;
  isInclusive: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

export type Period = "today" | "7d" | "30d" | "90d";

export type MetricWithSparkline = {
  current: number;
  prior: number;
  delta: number;
  sparkline: number[];
};

export type DashboardStats = {
  period: Period;
  revenue: MetricWithSparkline;
  orders: MetricWithSparkline;
  aov: MetricWithSparkline;
  conversion: MetricWithSparkline;
  returning: MetricWithSparkline;
  pendingOrders: number;
  processingOrders: number;
  lowStockItems: number;
};

// ─── Analytics ────────────────────────────────────────────────────────────────

export type SalesAnalytics = {
  period: Period;
  topProducts: { productName: string; quantity: number; revenue: number }[];
  salesByCategory: {
    categoryName: string;
    quantity: number;
    revenue: number;
  }[];
  profit: {
    revenue: number;
    cost: number;
    grossProfit: number;
    marginPct: number;
    coveragePct: number;
  };
  discounts: {
    couponCode: string;
    orders: number;
    discountTotal: number;
    revenue: number;
  }[];
};

export type OrdersAnalytics = {
  period: Period;
  statusBreakdown: { status: OrderStatus; count: number; revenue: number }[];
  cartAbandonment: {
    convertedCount: number;
    abandonedCount: number;
    abandonmentRatePct: number;
    lostValue: number;
  };
  refunds: { count: number; amount: number; refundRatePct: number };
  payments: {
    captured: number;
    failed: number;
    pending: number;
    successRatePct: number;
  };
};

export type CustomersAnalytics = {
  period: Period;
  totalCustomers: number;
  newInPeriod: number;
  growth: { date: string; count: number }[];
  newVsReturning: { newCustomers: number; returning: number };
};

export type InventoryAnalytics = {
  lowStockCount: number;
  outOfStockCount: number;
  inStockCount: number;
  stockUnits: number;
  stockValueAtCost: number;
  lowStock: {
    productName: string;
    variantName: string | null;
    sku: string;
    available: number;
    threshold: number;
  }[];
};

export type TrafficAnalytics = {
  period: Period;
  uniqueVisitors: number;
  orders: number;
  trueConversionRatePct: number;
  sources: { channel: string; sessions: number }[];
  topReferrers: { referrer: string; sessions: number }[];
  funnel: { stage: string; sessions: number }[];
};

export type AudienceAnalytics = {
  period: Period;
  totalSessions: number;
  devices: { label: string; sessions: number }[];
  browsers: { label: string; sessions: number }[];
  operatingSystems: { label: string; sessions: number }[];
  countries: { countryCode: string; sessions: number }[];
};

export type BehaviorAnalytics = {
  period: Period;
  topPages: { path: string; views: number; visitors: number }[];
  entryPages: { path: string; sessions: number }[];
  topClicks: { label: string; count: number }[];
  forms: { name: string; submissions: number }[];
};

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditEntry = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorEmail: string;
  ipAddress: string | null;
  createdAt: string;
};

// ─── Team ─────────────────────────────────────────────────────────────────────

export type TeamMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: AdminRole;
};

export type Invitation = {
  id: string;
  email: string;
  role: AdminRole;
  sentDate: string;
};

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * Every paginated admin list returns this envelope. Admin uses numbered pages
 * (offset + a real count); the cursor is storefront-GraphQL-only and is null
 * on every admin response.
 */
export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  nextCursor?: string | null;
};

export type OrdersResponse = PaginatedResponse<Order>;

/** Inventory additionally returns the counts behind its all/low/out tabs. */
export type InventoryResponse = PaginatedResponse<InventoryItemView> & {
  counts: { all: number; low: number; out: number };
};

export const PAGE_SIZE = 25;
