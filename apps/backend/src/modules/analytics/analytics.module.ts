import { Module } from '@nestjs/common';
import { AnalyticsService } from './services/analytics.service';
import { AnalyticsRollupService } from './services/analytics-rollup.service';
import { EventIngestService } from './services/event-ingest.service';
import { SessionTouchService } from './services/session-touch.service';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { StorefrontEventsController } from './controllers/storefront-events.controller';
import { AnalyticsScriptController } from './controllers/analytics-script.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminAnalyticsController,
    StorefrontEventsController,
    AnalyticsScriptController,
  ],
  providers: [
    AnalyticsService,
    AnalyticsRollupService,
    EventIngestService,
    SessionTouchService,
  ],
  // SessionTouchService is exported for the cart module's attribution
  // correlation fallback — the only read of the event log from outside here.
  exports: [AnalyticsService, EventIngestService, SessionTouchService],
})
export class AnalyticsModule {}
