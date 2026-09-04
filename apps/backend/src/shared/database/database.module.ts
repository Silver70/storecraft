import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  createDrizzleClient,
  createPgPool,
  type DrizzleClient,
} from './drizzle.factory';

export const DRIZZLE_CLIENT = 'DRIZZLE_CLIENT';
export const PG_POOL = 'PG_POOL';

export type { DrizzleClient };

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPgPool(config.getOrThrow<string>('DATABASE_URL')),
    },
    {
      provide: DRIZZLE_CLIENT,
      inject: [ConfigService, PG_POOL],
      useFactory: (config: ConfigService, pool: Pool | null) =>
        createDrizzleClient(config.getOrThrow<string>('DATABASE_URL'), pool),
    },
  ],
  exports: [DRIZZLE_CLIENT],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool | null) {}

  // The Neon HTTP driver holds no sockets, but a node-postgres pool does — and
  // an unclosed pool keeps the process (and the test runner) alive forever.
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
