import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { adPlatformCredentials } from '../../../shared/database/schema';
import type { AdPlatformCredential } from '../../../shared/database/schema';

/**
 * The Store's credential row. Its `sealedSecret` is ciphertext everywhere in
 * this codebase except inside `CredentialVault`, and there is no read here that
 * returns anything a response could be built from by accident.
 */
@Injectable()
export class AdPlatformCredentialRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findByStore(
    orgId: string,
    storeId: string,
  ): Promise<AdPlatformCredential | null> {
    const [row] = await this.db
      .select()
      .from(adPlatformCredentials)
      .where(
        and(
          eq(adPlatformCredentials.organizationId, orgId),
          eq(adPlatformCredentials.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Writes the Store's credential, replacing whatever it held.
   *
   * Upsert on `store_id` rather than insert-if-absent: the unique index is the
   * authority on one-credential-per-Store, not the read that preceded the
   * write, and two admins connecting two platforms at the same moment must not
   * leave a Store holding two keys.
   */
  async upsert(
    orgId: string,
    storeId: string,
    providerRef: string,
    sealedSecret: string,
  ): Promise<AdPlatformCredential> {
    const now = new Date();
    const [row] = await this.db
      .insert(adPlatformCredentials)
      .values({
        organizationId: orgId,
        storeId,
        providerRef,
        sealedSecret,
        issuedAt: now,
      })
      .onConflictDoUpdate({
        target: adPlatformCredentials.storeId,
        set: {
          providerRef,
          sealedSecret,
          issuedAt: now,
          revokedAt: null,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  /**
   * Destroys the secret and keeps the row.
   *
   * The plaintext is gone rather than flagged: a credential nothing is entitled
   * to use is a credential nothing should be able to read, and the row that
   * remains only records that a Store once held one.
   */
  async revoke(
    orgId: string,
    storeId: string,
  ): Promise<AdPlatformCredential | null> {
    const now = new Date();
    const [row] = await this.db
      .update(adPlatformCredentials)
      .set({ sealedSecret: null, revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(adPlatformCredentials.organizationId, orgId),
          eq(adPlatformCredentials.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }
}
