import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import { analyticsEvents } from '../../../shared/database/schema';

/**
 * One arrival as the event log recorded it. `analytics_events` has no
 * `utm_content` column, so a correlated touch never carries one — a small,
 * deliberate loss of detail against a declared touch.
 */
export interface SessionTouch {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
  landingPath: string | null;
  visitorId: string | null;
  occurredAt: Date;
}

/** The two ends of a session's attributed arrivals. Both null when it has none. */
export interface SessionTouchRange {
  first: SessionTouch | null;
  last: SessionTouch | null;
}

// Human traffic only, on the same terms as every other event query: a NULL
// device_type is a Phase 2 event ingested before device enrichment and counts
// as human, so historical sessions still correlate.
const NOT_BOT = sql`(${analyticsEvents.deviceType} IS NULL OR ${analyticsEvents.deviceType} <> 'bot')`;

// Evidence of coming from somewhere. An event carrying neither a UTM value nor
// a referrer is a direct arrival and is never a First or Last Touch — the same
// rule the declared path applies in `isAttributedTouch`.
const ATTRIBUTED = sql`(
  coalesce(${analyticsEvents.utmSource}, '') <> ''
  OR coalesce(${analyticsEvents.utmMedium}, '') <> ''
  OR coalesce(${analyticsEvents.utmCampaign}, '') <> ''
  OR coalesce(${analyticsEvents.referrer}, '') <> ''
)`;

const TOUCH_COLUMNS = {
  utmSource: analyticsEvents.utmSource,
  utmMedium: analyticsEvents.utmMedium,
  utmCampaign: analyticsEvents.utmCampaign,
  referrer: analyticsEvents.referrer,
  landingPath: analyticsEvents.path,
  visitorId: analyticsEvents.visitorId,
  occurredAt: analyticsEvents.occurredAt,
};

/**
 * Reads where a session came from, out of the tracked event log.
 *
 * This is the one read the correlation fallback makes: a cart that reached
 * checkout without the storefront declaring anything, but carrying a session
 * id, gets its First and Last Touch from here so an integrator who has not
 * implemented pass-through still gets partial campaign reporting.
 *
 * It lives in analytics because the event log does; the decision to *use* it —
 * and the rule that a declared touch always beats it — belongs to the cart.
 */
@Injectable()
export class SessionTouchService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * The earliest and latest attributed arrival on a session within
   * `[since, until]` — the Lookback Window, applied by the caller.
   *
   * Two one-row reads rather than a scan of the session: a chatty session can
   * hold hundreds of events and only its ends can ever become a Touch. Ties on
   * `occurred_at` (a batch of events posted with one client timestamp) break on
   * id, so the same session always yields the same pair.
   */
  async findTouches(
    orgId: string,
    storeId: string,
    sessionId: string,
    since: Date,
    until: Date,
  ): Promise<SessionTouchRange> {
    const where = and(
      eq(analyticsEvents.organizationId, orgId),
      eq(analyticsEvents.storeId, storeId),
      eq(analyticsEvents.sessionId, sessionId),
      gte(analyticsEvents.occurredAt, since),
      lte(analyticsEvents.occurredAt, until),
      NOT_BOT,
      ATTRIBUTED,
    );

    const [first, last] = await Promise.all([
      this.db
        .select(TOUCH_COLUMNS)
        .from(analyticsEvents)
        .where(where)
        .orderBy(asc(analyticsEvents.occurredAt), asc(analyticsEvents.id))
        .limit(1),
      this.db
        .select(TOUCH_COLUMNS)
        .from(analyticsEvents)
        .where(where)
        .orderBy(desc(analyticsEvents.occurredAt), desc(analyticsEvents.id))
        .limit(1),
    ]);

    return { first: first[0] ?? null, last: last[0] ?? null };
  }
}
