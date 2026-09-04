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
  /** Basis points when type is percentage (2000 = 20%), cents otherwise. */
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
  /** Basis points when type is percentage (2000 = 20%), cents otherwise. */
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

/**
 * The attribution field a matching rule compares against. Order matters: when
 * more than one rule could claim a visit, a `utm_campaign` rule wins over
 * `utm_source` or `utm_medium`, which win over `referrer_host`.
 */
export const CAMPAIGN_RULE_FIELDS = [
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "referrer_host",
] as const;

export type CampaignRuleField = (typeof CAMPAIGN_RULE_FIELDS)[number];

/** `equals` wins over `starts_with` when both could claim the same visit. */
export const CAMPAIGN_RULE_OPERATORS = ["equals", "starts_with"] as const;

export type CampaignRuleOperator = (typeof CAMPAIGN_RULE_OPERATORS)[number];

// Raw campaign_matching_rules row from backend
export type CampaignMatchingRule = {
  id: string;
  organizationId: string;
  storeId: string;
  campaignId: string;
  field: CampaignRuleField;
  operator: CampaignRuleOperator;
  /**
   * Compared with case, hyphens, underscores and spacing ignored, so one rule
   * covers `summer_sale`, `Summer-Sale` and `summer sale`.
   */
  value: string;
  /**
   * The rule on the campaign's own tag, created with the campaign. Not
   * removable — every generated link carries that tag.
   */
  isCanonical: boolean;
  createdAt: string;
  updatedAt: string;
};

// ─── Tagged links ─────────────────────────────────────────────────────────────

/**
 * A URL generated for a campaign, ready to paste into an ad platform.
 *
 * Composed by the backend rather than here: the `utm_campaign` value is the
 * campaign's canonical tag, and having one place that builds it is what makes a
 * generated link match by construction instead of by two implementations
 * agreeing. Nothing is stored — the same choices always give the same link.
 */
export type CampaignTaggedLink = {
  url: string;
  /** Where it points, before any tagging. */
  destination: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  campaignId: string;
  campaignName: string;
};

// ─── Campaign spend ───────────────────────────────────────────────────────────

/**
 * What a merchant paid for a campaign on one day.
 *
 * One row per campaign per day: recording a day that already has a figure
 * corrects it rather than adding to it, so a double-submit cannot double a
 * day's cost. The `day` is a calendar date in the store's timezone, never an
 * instant — ad platforms report daily totals and nothing here is more precise
 * than that.
 */
export type CampaignSpend = {
  id: string;
  organizationId: string;
  storeId: string;
  campaignId: string;
  /** `YYYY-MM-DD` in the store's timezone. */
  day: string;
  /** Smallest currency unit. Formatted only for display, never on the wire. */
  amount: number;
  /**
   * The store's currency, frozen on the row when it was recorded so a later
   * currency change cannot reinterpret it. There is no conversion anywhere.
   */
  currency: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A campaign's spend for a period, with the two facts an entry form needs to be
 * correct: the currency it must be in, and the latest day it may be dated.
 * Both come from the store, not from the browser — a date capped by the
 * viewer's own clock would be wrong for anyone not sitting in the store's
 * timezone.
 */
export type CampaignSpendReport = {
  campaignId: string;
  period: Period;
  currency: string;
  timezone: string;
  /** Today where the store is: the latest day spend can be recorded for. */
  today: string;
  /** The inclusive calendar day range the rows cover. */
  from: string;
  to: string;
  rows: CampaignSpend[];
  /** The period's spend in the smallest currency unit. */
  total: number;
};

// ─── Attributed revenue ───────────────────────────────────────────────────────

/**
 * Which touch a report credits: the ad that discovered the visitor, or the one
 * that closed them. Both are stored on every order, so switching is a re-read.
 */
export type AttributionTouch = "first" | "last";

export type RevenueBucket = {
  orders: number;
  /** Smallest currency unit. The backend never formats money. */
  revenue: number;
};

/**
 * The **goods basis** — the second of the report's two revenue figures, and the
 * costs against it. All in the smallest currency unit.
 *
 * Not the order total and never meant to be: tax is collected and remitted and
 * is never profit, and shipping is left out of both sides because shipping cost
 * is modelled nowhere, so counting the charge would inflate every margin. What
 * is left is the goods — the only part of an order there is a cost price for.
 */
export type CampaignGoods = {
  /** Line-item totals *before* discount. No tax, no shipping. */
  goodsRevenue: number;
  /**
   * Cost of goods, counted only where the variant has a cost price. An unpriced
   * line contributes nothing rather than a zero that would read as free.
   */
  cost: number;
  /** The part of `goodsRevenue` that had a known cost behind it. */
  revenueWithCost: number;
  /**
   * Discounts on those orders. Subtracted from the goods basis exactly once —
   * the order total already has them netted out, so subtracting there as well
   * would penalise a discounted order twice.
   */
  discount: number;
};

export type CampaignMargin = {
  /**
   * Goods revenue minus discounts minus cost of goods minus spend, in the
   * smallest currency unit. **The figure that says whether to keep spending**,
   * where ROAS only says how much came back — a 3× ROAS on goods costing 70% of
   * their price loses money on every order.
   *
   * Negative when the campaign lost money, and never clamped. Null when goods
   * were sold and not one of them has a cost price: a margin built on no cost
   * data is not a conservative estimate, it is fiction, and the blank is what
   * sends a merchant to fill their cost prices in.
   */
  contributionMargin: number | null;
  /**
   * How much of the goods revenue had a known cost behind it, as a whole-number
   * percentage. **Display only** — the same convention the analytics profit
   * report uses. It is what qualifies the margin beside it: at 60% the figure
   * understates cost and so overstates margin, and the merchant has to be able
   * to see that.
   */
  costCoveragePct: number;
};

export type CampaignRevenueLine = RevenueBucket &
  CampaignGoods &
  CampaignMargin & {
    campaignId: string;
    name: string;
    tag: string;
    platform: CampaignPlatform;
    status: CampaignStatus;
    /**
     * Spend recorded for the period, in the smallest currency unit. Zero for a
     * campaign nobody recorded a cost against.
     */
    spend: number;
    /**
     * Revenue over spend, to two decimal places. A **ratio**, not money — 4.25
     * means $4.25 back per dollar spent, so it is never passed through the money
     * formatter. Null when nothing was spent: an organic or email campaign has no
     * return *on spend*, and a zero would rank it as a failure while an infinity
     * would rank it as the best thing in the account.
     */
    roas: number | null;
  };

/** Every campaign line summed, and the figures taken of the sums. */
export type BlendedPerformance = CampaignGoods &
  CampaignMargin & {
    /** The order-total basis. Smallest currency unit. */
    revenue: number;
    /** Smallest currency unit. */
    spend: number;
    /** A ratio, not money. Null when nothing was spent anywhere. */
    roas: number | null;
  };

export type AttributedRevenueReport = {
  period: Period;
  touch: AttributionTouch;
  /**
   * The active lookback window in days — why these figures differ from what an
   * ad platform reports, so it is shown next to them rather than assumed.
   */
  lookbackDays: number;
  rangeStart: string;
  rangeEnd: string;
  campaigns: CampaignRevenueLine[];
  /**
   * The inclusive calendar days spend was counted over, in the store's
   * timezone. Spend is recorded per day and revenue to the second, so the two
   * windows are named separately rather than assumed to be the same shape.
   */
  spendFrom: string;
  spendTo: string;
  /**
   * The account as a whole. Unattributed is not part of it — nobody spent
   * against a bucket that has no campaign.
   */
  blended: BlendedPerformance;
  /** Its own line. Never spread across the campaigns above. */
  unattributed: RevenueBucket;
  /** Attributed plus unattributed — the period's realized revenue. */
  totals: RevenueBucket;
};

// ─── Matching-rule preview ────────────────────────────────────────────────────

/**
 * What a candidate matching rule would do to a period's orders, before it is
 * saved.
 *
 * Campaigns resolve at read time, so a saved rule reshapes historical reports
 * the instant it exists. That is what lets a correction repair the past, and it
 * is what lets an over-broad rule quietly rewrite it — so the consequence is
 * shown while the rule is still a draft. The backend runs the same matcher over
 * the same orders for the same period as the revenue report, which is why
 * saving produces the figures shown here.
 */
export type RulePreviewOverlap = {
  campaignId: string;
  name: string;
  tag: string;
  status: CampaignStatus;
  /** What this campaign would lose, because the candidate outranks its rule. */
  taken: RevenueBucket;
  /** What the candidate matches but this campaign keeps, because it outranks. */
  blocked: RevenueBucket;
};

/** One order the rule would claim, named so the merchant can recognise it. */
export type RulePreviewSampleOrder = {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  /** Smallest currency unit. The backend never formats money. */
  total: number;
  /** The campaign crediting it today. Null is Unattributed. */
  currentCampaignId: string | null;
  currentCampaignName: string | null;
  /** What the order carries in the field this rule compares. */
  matchedValue: string | null;
};

export type RulePreviewReport = {
  campaignId: string;
  campaignName: string;
  /** The candidate exactly as it would be stored and compared. */
  rule: {
    field: CampaignRuleField;
    operator: CampaignRuleOperator;
    /** What would be written — a pasted URL is already reduced to a host. */
    value: string;
    /** What both sides of every comparison are actually reduced to. */
    normalizedValue: string;
  };
  /** True when this campaign already has a rule meaning the same thing. */
  duplicate: boolean;
  period: Period;
  touch: AttributionTouch;
  lookbackDays: number;
  rangeStart: string;
  rangeEnd: string;
  /** Orders the rule would move onto this campaign. The headline figure. */
  claimed: RevenueBucket;
  /** The part of `claimed` that is unattributed today. */
  fromUnattributed: RevenueBucket;
  /** Every other campaign the rule would meet, in either direction. */
  overlaps: RulePreviewOverlap[];
  /** This campaign's figures as they stand, and as they would stand. */
  campaignBefore: RevenueBucket;
  campaignAfter: RevenueBucket;
  /** The period's realized revenue — the scale to judge the claim against. */
  totals: RevenueBucket;
  /** How many orders `samples` can hold, so the UI can say "10 of 47". */
  sampleLimit: number;
  samples: RulePreviewSampleOrder[];
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
