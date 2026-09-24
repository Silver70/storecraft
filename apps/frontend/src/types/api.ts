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

// ─── Ad platforms ─────────────────────────────────────────────────────────────

// The ad platforms a Store can be connected to — and the only platforms a
// Campaign can be on.
export const AD_PLATFORMS = [
  "meta",
  "google",
  "tiktok",
  "linkedin",
  "pinterest",
  "x",
] as const;

export type AdPlatform = (typeof AD_PLATFORMS)[number];

// What the admin is allowed to see about a connection. There is no credential
// here and there never will be: the secret is held server-side, sealed, and is
// not returned by any read.
export type AdPlatformConnection = {
  id: string;
  platform: AdPlatform;
  // `awaiting_account` is the middle of the flow: the merchant approved at the
  // platform, and has not yet said which of their ad accounts this store
  // reports against.
  status: "awaiting_account" | "connected" | "disconnected";
  accountId: string | null;
  accountName: string | null;
  // The ad account's currency. On a connected account it is the store's — an
  // account billed in anything else is refused — and it is kept so the check is
  // readable rather than only having happened.
  accountCurrency: string | null;
  // The ad account's pixel, found or created at connection. Not a secret: it is
  // embedded in the storefront's own pages.
  pixelId: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  // When a sync last succeeded, or null if none ever has. Shown so a figure
  // that stopped moving because the sync stopped running is distinguishable
  // from one that stopped moving because nothing was spent.
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  // Why the last attempt failed, in words already written for a merchant.
  // Displayed, never thrown: a vendor outage costs freshness, not the page.
  lastSyncError: string | null;
  syncPausedUntil: string | null;
};

/**
 * One ad account the approved login can see, already judged against the store.
 *
 * Every account is listed, including the ones that cannot be used, because an
 * account missing from the picker is a merchant wondering whether they approved
 * with the wrong login. `reason` is what the row says instead of nothing.
 */
export type AdAccountChoice = {
  accountId: string;
  name: string | null;
  currency: string | null;
  selectable: boolean;
  reason: string | null;
};

// What a sync did, as the page reports it back. A failure arrives here rather
// than as an error, which is why the button can say what happened.
export type AdPlatformSyncOutcome = {
  platform: AdPlatform;
  // "partial": figures were written but the platform is still gathering the
  // range, so it is retried like a failure without being one.
  status: "synced" | "partial" | "failed";
  from: string;
  to: string;
  backfill: boolean;
  message: string | null;
  campaignsDiscovered: number;
  adsDiscovered: number;
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
  // Where this store's storefront is served, and the shape of its product page
  // paths. The engine is headless, so it cannot know either — an ad's
  // destination can only be built once these are set. Null until then.
  storefrontUrl: string | null;
  productPathPattern: string;
  // Whether the storefront must ask a visitor before it measures anything.
  // Off by default: a store selling only where consent is not required should
  // not be made worse by a banner nobody needed.
  requiresMeasurementConsent: boolean;
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
 * A Campaign's platform is always an ad platform a Store can connect — the
 * backend uses the same enum for both.
 */
export type CampaignPlatform = AdPlatform;

/**
 * What the platform says a Campaign or Ad is doing, collapsed to five answers.
 * Read from the platform and never set here; `ended` covers a finished schedule
 * and a campaign deleted on the platform, and is never hidden.
 */
export type CampaignStatus =
  | "active"
  | "paused"
  | "in_review"
  | "needs_attention"
  | "ended";

/** One campaign on the Store's connected ad account, keyed by the platform's id. */
export type Campaign = {
  id: string;
  organizationId: string;
  storeId: string;
  platform: CampaignPlatform;
  /** The platform's campaign id — what `utm_campaign` carries on a click. */
  externalId: string;
  name: string;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  coverUrl: string | null;
  /** Tracked when true. When false, revenue is unknown — never show it as zero. */
  hasLinkTags: boolean;
  createdAt: string;
  updatedAt: string;
};

/** What Start tracking did to one ad. */
export type AdTrackingResult = {
  adId: string;
  externalId: string;
  name: string;
  /**
   * `tagged` was written just now and goes back through Meta's review;
   * `already_tagged` was left alone; `refused` Meta will not retag, and
   * `reason` says why; `not_attempted` the platform failed before its turn.
   */
  result: "tagged" | "already_tagged" | "refused" | "not_attempted";
  reason: string | null;
};

/** What Start tracking did to a campaign. */
export type TrackingOutcome = {
  campaignId: string;
  /** Tracked afterwards: every ad carries the tags. */
  tracked: boolean;
  /** Set when the platform failed part-way. Never a claim of success. */
  message: string | null;
  ads: AdTrackingResult[];
};

// ─── Ads ──────────────────────────────────────────────────────────────────────

export type AdStatus = CampaignStatus;

/**
 * The platform's review verdict on an ad, kept beside its collapsed status: a
 * pause outranks a rejection in the status, so an ad paused after Meta rejected
 * it reads Paused, and only this says it was rejected.
 */
export type AdReviewStatus = "in_review" | "approved" | "rejected" | "with_issues";

/** How an ad's creative is built, as the platform classifies it. */
export type AdFormat = "image" | "video" | "carousel";

/** One creative under a campaign, keyed by the platform's own ad id. */
export type Ad = {
  id: string;
  organizationId: string;
  storeId: string;
  campaignId: string;
  /** The platform's ad id — what `utm_content` carries on a click. */
  externalId: string;
  name: string;
  format: AdFormat | null;
  status: AdStatus;
  creativeUrl: string | null;
  hasLinkTags: boolean;
  createdAt: string;
  updatedAt: string;
};

// ─── Attributed revenue ───────────────────────────────────────────────────────

export type RevenueBucket = {
  orders: number;
  /** Smallest currency unit. The backend never formats money. */
  revenue: number;
};

/**
 * What the ad platform measured, summed over the period. Spend is in the
 * smallest currency unit; clicks are link clicks only.
 */
export type PlatformFigures = {
  spend: number;
  impressions: number;
  clicks: number;
};

/**
 * One creative's line beneath its campaign. Its revenue is the orders whose
 * credited touch carried this ad's platform id.
 */
export type AdRevenueLine = RevenueBucket &
  PlatformFigures & {
    adId: string;
    externalId: string;
    name: string;
    format: AdFormat | null;
    status: AdStatus;
    reviewStatus: AdReviewStatus | null;
    creativeUrl: string | null;
    hasLinkTags: boolean;
  };

export type CampaignRevenueLine = RevenueBucket &
  PlatformFigures & {
    campaignId: string;
    externalId: string;
    name: string;
    platform: CampaignPlatform;
    status: CampaignStatus;
    startsAt: string | null;
    endsAt: string | null;
    /** Its own cover, or else the creative of the ad that spent the most. */
    coverUrl: string | null;
    /**
     * When an ended campaign stopped, over its whole life. Null while it runs,
     * and for one that ended without ever reporting a figure.
     */
    endedAt: string | null;
    /** False means Not Tracked: revenue is unknown, not zero. */
    hasLinkTags: boolean;
    /** Every ad of the campaign; with `unassigned` they add up to this line. */
    ads: AdRevenueLine[];
    /**
     * Revenue that named this campaign and none of its ads. Its own line,
     * never spread across the ads, and never the same as unattributed.
     */
    unassigned: RevenueBucket;
  };

/**
 * Credit goes to the latest ad click — the last touch if it names a campaign,
 * otherwise the first — so there is no touch to choose.
 */
export type AttributedRevenueReport = {
  period: Period;
  /**
   * The active lookback window in days — one reason these figures differ from
   * what an ad platform reports.
   */
  lookbackDays: number;
  rangeStart: string;
  rangeEnd: string;
  campaigns: CampaignRevenueLine[];
  /** Every campaign line summed. Unattributed is not part of it. */
  blended: RevenueBucket;
  /** Its own line. Never spread across the campaigns above. */
  unattributed: RevenueBucket;
  /** Attributed plus unattributed — the period's realized revenue. */
  totals: RevenueBucket;
};

// ─── One campaign's page ──────────────────────────────────────────────────────

/** The periods a campaign's own page offers. */
export type CampaignPeriod = "7d" | "30d" | "90d" | "lifetime";

/**
 * Ratios are plain fractions (`0.25` is 25%). Each is null where it cannot be
 * stated honestly — show a dash, never `0`.
 */
export type AdPerformanceLine = AdRevenueLine & {
  /** Null at zero spend, and for an ad whose revenue cannot be read. */
  roas: number | null;
};

export type CampaignPerformanceLine = Omit<CampaignRevenueLine, "ads"> & {
  ads: AdPerformanceLine[];
  /** Revenue ÷ spend. Null at zero spend, or when Not Tracked. */
  roas: number | null;
  /** Our orders ÷ the platform's clicks. Null at zero clicks, or when Not Tracked. */
  conversionRate: number | null;
  /**
   * Revenue − cost of goods − spend, in the smallest currency unit. Null unless
   * every item sold has a cost price, and when Not Tracked.
   */
  contributionMargin: number | null;
  /** Contribution margin ÷ spend. Null whenever the margin is, or at zero spend. */
  roi: number | null;
  /** The products sold without a cost price, once each — why margin is absent. */
  uncostedProducts: { productId: string | null; name: string }[];
};

export type CampaignPerformanceReport = {
  period: CampaignPeriod;
  lookbackDays: number;
  /** Null for Lifetime, which has no start. */
  rangeStart: string | null;
  rangeEnd: string;
  campaign: CampaignPerformanceLine;
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
