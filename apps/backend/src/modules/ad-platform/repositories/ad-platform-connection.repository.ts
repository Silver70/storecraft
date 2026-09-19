import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { adPlatformConnections } from '../../../shared/database/schema';
import type {
  AdPlatform,
  AdPlatformConnection,
} from '../../../shared/database/schema';

export interface UpsertConnectionInput {
  externalAccountId: string;
  accountName: string | null;
  accountCurrency: string | null;
}

/**
 * Every method takes the organization and the store explicitly and filters on
 * both. A connection id from another tenant reads as "not found", never as
 * someone else's ad account.
 */
@Injectable()
export class AdPlatformConnectionRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findMany(
    orgId: string,
    storeId: string,
  ): Promise<AdPlatformConnection[]> {
    return this.db
      .select()
      .from(adPlatformConnections)
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
        ),
      )
      .orderBy(asc(adPlatformConnections.createdAt));
  }

  async findByPlatform(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<AdPlatformConnection | null> {
    const [row] = await this.db
      .select()
      .from(adPlatformConnections)
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
          eq(adPlatformConnections.platform, platform),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Records what the merchant approved, reconnecting in place if this Store has
   * connected this platform before.
   *
   * Reconnecting moves `connectedAt` and clears `disconnectedAt`, because the
   * merchant is being told when access was last granted. Nothing else about the
   * row is reset: it keeps its id, which is what figures already pulled point
   * at, so a reconnect cannot orphan a past report.
   */
  async upsertConnected(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
    input: UpsertConnectionInput,
  ): Promise<AdPlatformConnection> {
    const now = new Date();
    const [row] = await this.db
      .insert(adPlatformConnections)
      .values({
        organizationId: orgId,
        storeId,
        platform,
        externalAccountId: input.externalAccountId,
        accountName: input.accountName,
        accountCurrency: input.accountCurrency,
        status: 'connected',
        connectedAt: now,
      })
      .onConflictDoUpdate({
        target: [adPlatformConnections.storeId, adPlatformConnections.platform],
        set: {
          externalAccountId: input.externalAccountId,
          accountName: input.accountName,
          accountCurrency: input.accountCurrency,
          status: 'connected',
          connectedAt: now,
          disconnectedAt: null,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  /**
   * Stops the connection without removing it. A deleted row would take the
   * figures pointing at it with it, and revoking access must not rewrite a past
   * report.
   */
  async markDisconnected(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<AdPlatformConnection | null> {
    const now = new Date();
    const [row] = await this.db
      .update(adPlatformConnections)
      .set({ status: 'disconnected', disconnectedAt: now, updatedAt: now })
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
          eq(adPlatformConnections.platform, platform),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Whether any platform other than `excluding` still holds this Store's
   * credential open. The answer decides whether the credential is destroyed.
   */
  async hasOtherConnected(
    orgId: string,
    storeId: string,
    excluding: AdPlatform,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: adPlatformConnections.id })
      .from(adPlatformConnections)
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
          eq(adPlatformConnections.status, 'connected'),
          ne(adPlatformConnections.platform, excluding),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
