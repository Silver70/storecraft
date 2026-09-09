import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { analyticsEvents } from '../../../shared/database/schema';
import type { NewAnalyticsEvent } from '../../../shared/database/schema';
import type { TrackEventDto } from '../dto/track-events.dto';
import { parseUserAgent } from '../utils/user-agent.util';

/**
 * Per-request enrichment context, derived from the HTTP request (never the body)
 * once per batch and applied to every event in it — one beacon is one page load,
 * so the User-Agent and geo are shared across its events.
 */
export interface IngestContext {
  userAgent?: string | null;
  countryCode?: string | null;
  region?: string | null;
}

@Injectable()
export class EventIngestService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * Batch-inserts storefront events for a tenant. `organizationId` / `storeId`
   * come from the API key (never trusted from the request body). Device/geo are
   * derived server-side from the request. Returns the number of rows written.
   */
  async ingest(
    organizationId: string,
    storeId: string,
    events: TrackEventDto[],
    ctx: IngestContext = {},
  ): Promise<number> {
    if (events.length === 0) return 0;

    const ua = parseUserAgent(ctx.userAgent);

    const rows: NewAnalyticsEvent[] = events.map((e) => ({
      organizationId,
      storeId,
      visitorId: e.visitorId ?? null,
      sessionId: e.sessionId,
      eventType: e.type,
      eventName: e.eventName ?? null,
      productId: e.productId ?? null,
      variantId: e.variantId ?? null,
      path: e.path ?? null,
      referrer: e.referrer ?? null,
      utmSource: e.utmSource ?? null,
      utmMedium: e.utmMedium ?? null,
      utmCampaign: e.utmCampaign ?? null,
      utmContent: e.utmContent ?? null,
      deviceType: ua.deviceType,
      browser: ua.browser,
      os: ua.os,
      countryCode: ctx.countryCode ?? null,
      region: ctx.region ?? null,
      properties: e.properties ?? null,
      occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
    }));

    await this.db.insert(analyticsEvents).values(rows);
    return rows.length;
  }
}
