import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import type { ExecutionContext } from '@nestjs/common';

import { validationSchema } from './config/configuration';
import { DatabaseModule } from './shared/database/database.module';
import { EventBusModule } from './shared/events/event-bus.module';
import { MoneyScalar } from './shared/graphql/scalars/money.scalar';
import { DateTimeScalar } from './shared/graphql/scalars/date-time.scalar';
import { HealthResolver } from './shared/graphql/health.resolver';
import { R2StorageService } from './shared/storage/r2-storage.service';

import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { AuditModule } from './modules/audit/audit.module';
import { ProductModule } from './modules/product/product.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CartModule } from './modules/cart/cart.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { CustomerModule } from './modules/customer/customer.module';
import { PaymentModule } from './modules/payment/payment.module';
import { OrderModule } from './modules/order/order.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { InlineEditModule } from './modules/inline-edit/inline-edit.module';
import { MarketingModule } from './modules/marketing/marketing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Tests never read .env — it points at the hosted database, and the
      // integration suite creates and deletes rows.
      envFilePath:
        process.env.NODE_ENV === 'test'
          ? ['.env.test.local', '.env.test']
          : ['.env'],
      validationSchema,
    }),
    DatabaseModule,
    EventBusModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'storefront',
        ttl: 60000,
        limit: 100,
        skipIf: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ path?: string }>();
          return req?.path?.startsWith('/api/admin') ?? false;
        },
        getTracker: (req: Record<string, unknown>) => {
          const headers = req.headers as Record<string, unknown>;
          const apiKey = headers?.['x-api-key'];
          if (typeof apiKey === 'string') return apiKey.slice(0, 8);
          return typeof req.ip === 'string' ? req.ip : 'unknown';
        },
      },
      {
        name: 'admin',
        ttl: 60000,
        limit: 300,
        skipIf: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ path?: string }>();
          return !(req?.path?.startsWith('/api/admin') ?? false);
        },
        getTracker: (req: Record<string, unknown>) => {
          const ctx = req.tenantContext as Record<string, unknown> | undefined;
          if (typeof ctx?.userId === 'string') return ctx.userId;
          return typeof req.ip === 'string' ? req.ip : 'unknown';
        },
      },
    ]),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      path: '/graphql',
      context: ({ req }: { req: Express.Request }) => ({ req }),
    }),
    AuthModule,
    TenantModule,
    AuditModule,
    ProductModule,
    InventoryModule,
    PricingModule,
    CartModule,
    ShippingModule,
    CustomerModule,
    PaymentModule,
    OrderModule,
    DashboardModule,
    AnalyticsModule,
    MarketingModule,
    InlineEditModule,
  ],
  providers: [MoneyScalar, DateTimeScalar, R2StorageService, HealthResolver],
  exports: [R2StorageService],
})
export class AppModule {}
