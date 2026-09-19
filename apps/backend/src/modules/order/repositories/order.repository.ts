import { Inject, Injectable } from '@nestjs/common';
import {
  eq,
  and,
  or,
  ilike,
  desc,
  gte,
  lte,
  asc,
  count,
  inArray,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import {
  orders,
  orderLineItems,
  orderTimeline,
  payments,
  shipments,
  refunds,
  productVariants,
  productMedia,
} from '../../../shared/database/schema';
import type {
  Order,
  NewOrder,
  NewOrderLineItem,
  NewOrderTimeline,
  Refund,
  NewRefund,
  Shipment,
  NewShipment,
  Payment,
} from '../../../shared/database/schema';
import {
  encodeCursor,
  decodeCursor,
  offsetFor,
  DEFAULT_PAGE_SIZE,
} from '../../../shared/utils/pagination.util';
import { likePattern } from '../../../shared/utils/search.util';

export interface OrderWithDetails extends Order {
  lineItems: (typeof orderLineItems.$inferSelect)[];
  timeline: (typeof orderTimeline.$inferSelect)[];
  payment: Payment | null;
  shipments: Shipment[];
}

export interface ListOrdersParams {
  orgId: string;
  storeId: string;
  status?: string;
  customerId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  /** Storefront GraphQL. Ignored when `page` is set. */
  cursor?: string;
  /** 1-based. Admin REST uses numbered pages instead of a cursor. */
  page?: number;
  limit?: number;
}

/**
 * Keyset cursor. Carries only the row id — see ProductCursor for why the
 * timestamp is re-read inside Postgres instead of round-tripped through a JS
 * Date (millisecond truncation would make a row compare as "after itself").
 */
interface OrderCursor {
  id: string;
}

export function encodeOrderCursor(o: { id: string }): string {
  return encodeCursor({ id: o.id });
}

/** A list row: the order plus the total quantity of units across its line items. */
export type OrderListItem = Order & { itemCount: number };

export interface ListOrdersResult {
  items: OrderListItem[];
  /** Set in cursor mode (storefront GraphQL); null in page mode. */
  nextCursor: string | null;
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CustomerOrderStats {
  ordersCount: number;
  totalSpent: number;
}

// Orders in these statuses count toward a customer's spend — mirrors the
// revenue definition used by the dashboard metrics (excludes pending/refunded/cancelled).
const SPEND_STATUSES: Order['status'][] = [
  'paid',
  'processing',
  'shipped',
  'delivered',
];

@Injectable()
export class OrderRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async create(data: NewOrder): Promise<Order> {
    const [row] = await this.db.insert(orders).values(data).returning();
    return row;
  }

  async createLineItems(
    items: NewOrderLineItem[],
  ): Promise<(typeof orderLineItems.$inferSelect)[]> {
    if (items.length === 0) return [];
    return this.db.insert(orderLineItems).values(items).returning();
  }

  async addTimelineEntry(
    entry: NewOrderTimeline,
  ): Promise<typeof orderTimeline.$inferSelect> {
    const [row] = await this.db.insert(orderTimeline).values(entry).returning();
    return row;
  }

  async findById(
    orderId: string,
    orgId: string,
    storeId: string,
  ): Promise<Order | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, orgId),
          eq(orders.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findByOrderNumber(
    orderNumber: string,
    orgId: string,
    storeId: string,
  ): Promise<Order | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.orderNumber, orderNumber),
          eq(orders.organizationId, orgId),
          eq(orders.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findWithDetails(
    orderId: string,
    orgId: string,
    storeId: string,
  ): Promise<OrderWithDetails | null> {
    const order = await this.findById(orderId, orgId, storeId);
    if (!order) return null;

    const [lineItemRows, timelineRows, paymentRows, shipmentRows] =
      await Promise.all([
        this.db
          .select()
          .from(orderLineItems)
          .where(eq(orderLineItems.orderId, orderId)),
        this.db
          .select()
          .from(orderTimeline)
          .where(eq(orderTimeline.orderId, orderId))
          .orderBy(asc(orderTimeline.createdAt)),
        this.db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.orderId, orderId),
              eq(payments.organizationId, orgId),
              eq(payments.storeId, storeId),
            ),
          )
          .limit(1),
        this.db
          .select()
          .from(shipments)
          .where(
            and(
              eq(shipments.orderId, orderId),
              eq(shipments.organizationId, orgId),
              eq(shipments.storeId, storeId),
            ),
          )
          .orderBy(desc(shipments.createdAt)),
      ]);

    // Fill missing line-item thumbnails from the product's current media.
    // Manual orders historically didn't snapshot image_url, so without this the
    // detail view shows blank placeholders for every item on those orders.
    const missing = lineItemRows.filter((li) => !li.imageUrl && li.variantId);
    let lineItems = lineItemRows;
    if (missing.length > 0) {
      const images = await this.resolveVariantImages(
        missing.map((li) => li.variantId as string),
        orgId,
        storeId,
      );
      lineItems = lineItemRows.map((li) =>
        !li.imageUrl && li.variantId && images.has(li.variantId)
          ? { ...li, imageUrl: images.get(li.variantId) ?? null }
          : li,
      );
    }

    return {
      ...order,
      lineItems,
      timeline: timelineRows,
      payment: paymentRows[0] ?? null,
      shipments: shipmentRows,
    };
  }

  /**
   * Current primary image URL per variant, resolved via the variant's product
   * media. Read-time fallback for line items whose image_url snapshot is null.
   * Best image = primary first, then lowest position (mirrors the storefront).
   */
  private async resolveVariantImages(
    variantIds: string[],
    orgId: string,
    storeId: string,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (variantIds.length === 0) return out;

    const rows = await this.db
      .select({
        variantId: productVariants.id,
        url: productMedia.url,
        isPrimary: productMedia.isPrimary,
        position: productMedia.position,
      })
      .from(productVariants)
      .innerJoin(
        productMedia,
        eq(productMedia.productId, productVariants.productId),
      )
      .where(
        and(
          inArray(productVariants.id, variantIds),
          eq(productVariants.organizationId, orgId),
          eq(productVariants.storeId, storeId),
          eq(productMedia.organizationId, orgId),
          eq(productMedia.storeId, storeId),
        ),
      );

    const best = new Map<
      string,
      { url: string; isPrimary: boolean; position: number }
    >();
    for (const r of rows) {
      const cur = best.get(r.variantId);
      const isBetter =
        !cur ||
        (r.isPrimary && !cur.isPrimary) ||
        (r.isPrimary === cur.isPrimary && r.position < cur.position);
      if (isBetter) {
        best.set(r.variantId, {
          url: r.url,
          isPrimary: r.isPrimary,
          position: r.position,
        });
      }
    }
    for (const [variantId, img] of best) out.set(variantId, img.url);
    return out;
  }

  async listWithFilters(params: ListOrdersParams): Promise<ListOrdersResult> {
    const { orgId, storeId, limit = DEFAULT_PAGE_SIZE } = params;
    const page = params.page ?? 1;
    const pageMode = params.page !== undefined;
    const conditions: SQL[] = [
      eq(orders.organizationId, orgId),
      eq(orders.storeId, storeId),
    ];

    if (params.status) {
      conditions.push(eq(orders.status, params.status as Order['status']));
    }
    if (params.customerId) {
      conditions.push(eq(orders.customerId, params.customerId));
    }
    if (params.search) {
      const pattern = likePattern(params.search);
      const match = or(
        ilike(orders.orderNumber, pattern),
        ilike(orders.customerName, pattern),
        ilike(orders.customerEmail, pattern),
      );
      if (match) conditions.push(match);
    }
    if (params.from) {
      conditions.push(gte(orders.createdAt, params.from));
    }
    if (params.to) {
      conditions.push(lte(orders.createdAt, params.to));
    }
    // Cursor mode only. Orders sort newest-first, so the row-value comparison
    // walks backwards. The subquery re-reads the cursor row's exact created_at
    // inside Postgres, so no timestamp precision is lost.
    if (!pageMode && params.cursor) {
      const c = decodeCursor<OrderCursor>(params.cursor);
      conditions.push(
        sql`(${orders.createdAt}, ${orders.id}) < (select o2.created_at, o2.id from orders o2 where o2.id = ${c.id})`,
      );
    }

    const where = and(...conditions);

    // Count runs alongside the page query — no extra database round trip.
    const [rows, [{ value: totalCount }]] = await Promise.all([
      this.db
        .select()
        .from(orders)
        .where(where)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(pageMode ? limit : limit + 1)
        .offset(pageMode ? offsetFor(page, limit) : 0),
      this.db.select({ value: count() }).from(orders).where(where),
    ]);

    const hasMore = !pageMode && rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeOrderCursor(lastRow) : null;

    // Total units per order, fetched in one grouped query and merged in. A
    // correlated subquery is avoided on purpose: Drizzle renders columns
    // embedded in a sql`` fragment unqualified, so the outer `orders.id` would
    // collide with the line item's own `id` and always match zero rows.
    const orderIds = pageRows.map((o) => o.id);
    const countRows = orderIds.length
      ? await this.db
          .select({
            orderId: orderLineItems.orderId,
            itemCount: sql<number>`coalesce(sum(${orderLineItems.quantity}), 0)::int`,
          })
          .from(orderLineItems)
          .where(inArray(orderLineItems.orderId, orderIds))
          .groupBy(orderLineItems.orderId)
      : [];
    const countByOrder = new Map(
      countRows.map((r) => [r.orderId, r.itemCount]),
    );

    const data: OrderListItem[] = pageRows.map((o) => ({
      ...o,
      itemCount: countByOrder.get(o.id) ?? 0,
    }));

    return {
      items: data,
      nextCursor,
      totalCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
  }

  async updateStatus(
    orderId: string,
    orgId: string,
    storeId: string,
    status: Order['status'],
  ): Promise<Order | null> {
    const [row] = await this.db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, orgId),
          eq(orders.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async updateFulfillmentStatus(
    orderId: string,
    orgId: string,
    storeId: string,
    fulfillmentStatus: Order['fulfillmentStatus'],
  ): Promise<Order | null> {
    const [row] = await this.db
      .update(orders)
      .set({ fulfillmentStatus, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, orgId),
          eq(orders.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async findPaymentByOrderId(
    orderId: string,
    orgId: string,
    storeId: string,
  ): Promise<Payment | null> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.organizationId, orgId),
          eq(payments.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createPayment(data: {
    organizationId: string;
    storeId: string;
    orderId: string;
    provider: 'stripe' | 'manual';
    status: 'pending' | 'captured';
    amount: number;
    currency: string;
  }): Promise<Payment> {
    const [row] = await this.db.insert(payments).values(data).returning();
    return row;
  }

  async updatePaymentStatus(
    paymentId: string,
    status: Payment['status'],
  ): Promise<Payment | null> {
    const [row] = await this.db
      .update(payments)
      .set({ status, updatedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .returning();
    return row ?? null;
  }

  async createShipment(data: NewShipment): Promise<Shipment> {
    const [row] = await this.db.insert(shipments).values(data).returning();
    return row;
  }

  async findShipmentsByOrder(
    orderId: string,
    orgId: string,
    storeId: string,
  ): Promise<Shipment[]> {
    return this.db
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.orderId, orderId),
          eq(shipments.organizationId, orgId),
          eq(shipments.storeId, storeId),
        ),
      )
      .orderBy(desc(shipments.createdAt));
  }

  async createRefund(data: NewRefund): Promise<Refund> {
    const [row] = await this.db.insert(refunds).values(data).returning();
    return row;
  }

  async findLineItemsByOrder(
    orderId: string,
  ): Promise<(typeof orderLineItems.$inferSelect)[]> {
    return this.db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId));
  }

  /** Orders count + total spent per customer, keyed by customerId. */
  async getCustomerStats(
    orgId: string,
    customerIds: string[],
  ): Promise<Map<string, CustomerOrderStats>> {
    if (customerIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        customerId: orders.customerId,
        ordersCount: sql<number>`count(*)::int`,
        totalSpent: sql<number>`coalesce(sum(${orders.total}), 0)::int`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, orgId),
          inArray(orders.customerId, customerIds),
          inArray(orders.status, SPEND_STATUSES),
        ),
      )
      .groupBy(orders.customerId);

    const stats = new Map<string, CustomerOrderStats>();
    for (const row of rows) {
      if (row.customerId) {
        stats.set(row.customerId, {
          ordersCount: row.ordersCount,
          totalSpent: row.totalSpent,
        });
      }
    }
    return stats;
  }

  async generateOrderNumber(orgId: string, storeId: string): Promise<string> {
    const count = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(eq(orders.organizationId, orgId), eq(orders.storeId, storeId)),
      );
    const seq = count.length + 1;
    return `ORD-${String(seq).padStart(6, '0')}`;
  }
}
