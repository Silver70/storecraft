import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import { analyticsEvents } from '../../../shared/database/schema';
import type { TaggedVisitor } from '../utils/traffic.util';

/**
 * Who a Campaign or an Ad was seen by, as opposed to who bought from it.
 *
 * **A different and weaker source than everything beside it on the report.**
 * Orders are a record of money that changed hands; this is a record of a script
 * having run in a browser. It is blocked outright for a large minority of
 * visitors, it is never written at all by an integrator who has not embedded
 * the tracker, and the retention purge deletes it on a schedule while Orders
 * are kept forever. Every figure derived from it therefore travels marked as
 * measured, and the periods it can be read over are bounded by the purge rather
 * than by the data.
 *
 * It is read here rather than through the analytics module on purpose: this is
 * the shape the two attribution matchers consume, not the shape the analytics
 * dashboards do, and a report module depending on another report module is the
 * rule this codebase already declines to break. The bot exclusion below is the
 * one thing the two must agree on, and it is stated identically in both.
 */

/**
 * The visitor identity, in the same order of preference the glossary defines:
 * the persistent Visitor where the caller sends one, and the Session where it
 * does not.
 *
 * The fallback matters because `visitor_id` is nullable — an integrator on the
 * Phase 2 contract sends only a session id — and a null grouping key would
 * collapse every one of their visitors into a single unit, reporting one
 * visitor for a whole month of traffic. Degrading to the Session overstates
 * returning visitors instead, which is the smaller and more legible error.
 */
const VISITOR_KEY = sql<string>`coalesce(${analyticsEvents.visitorId}, ${analyticsEvents.sessionId})`;

/**
 * Human traffic only, stated exactly as the analytics module states it — a null
 * `device_type` is a Phase 2 event ingested before device enrichment and counts
 * as human, so historical figures do not collapse.
 *
 * The two definitions must not drift. A visitor counted here and excluded on
 * the analytics page (or the reverse) would give a merchant two "visitors"
 * numbers with no way to tell which is lying.
 */
const NOT_BOT = sql`(${analyticsEvents.deviceType} IS NULL OR ${analyticsEvents.deviceType} <> 'bot')`;

@Injectable()
export class TrafficRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * Every distinct `(Campaign Tag, Ad Tag, visitor)` triple the event stream
   * holds for a Store over a period.
   *
   * **Distinct triples rather than counts.** A count grouped in SQL would have
   * to be grouped on the raw tags, and the raw tags are not the Campaign:
   * matching normalizes both sides, so `Summer_Sale` and `summer-sale` are one
   * Campaign, and a visitor who arrived under both would be counted twice by
   * any query that groups before it resolves. Resolution happens in the matcher
   * — the same matcher the money goes through — so the rows have to arrive
   * unresolved.
   *
   * Events with no `utm_campaign` are dropped here rather than tallied and
   * discarded: they can never resolve to a Campaign, and they are the large
   * majority of a Store's traffic. What is left is a row per creative a visitor
   * actually clicked, which is the small end of an already small table.
   *
   * There is no limit, deliberately. A truncated read would report fewer
   * visitors than there were and say nothing about it — an understated
   * denominator that silently inflates every conversion rate above it, which is
   * the exact failure this ticket exists to prevent.
   */
  async findTaggedVisitors(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<TaggedVisitor[]> {
    return this.db
      .selectDistinct({
        utmCampaign: analyticsEvents.utmCampaign,
        utmContent: analyticsEvents.utmContent,
        visitorKey: VISITOR_KEY,
      })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.organizationId, orgId),
          eq(analyticsEvents.storeId, storeId),
          gte(analyticsEvents.occurredAt, start),
          lt(analyticsEvents.occurredAt, end),
          isNotNull(analyticsEvents.utmCampaign),
          NOT_BOT,
        ),
      );
  }
}
