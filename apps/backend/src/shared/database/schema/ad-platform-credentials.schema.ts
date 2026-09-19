import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';

export const AD_PLATFORM_CREDENTIAL_LIMITS = {
  providerRef: 255,
} as const;

/**
 * The credential one Store holds with the ad-data provider, and the provider's
 * own reference for that Store.
 *
 * **One row per Store, never per Organization.** An Organization with a US
 * store and a UK store must not reach one ad account through one key: Campaigns
 * and currency are both Store-scoped, and the provider's posting surface accepts
 * whatever account id the holder of a key can name, regardless of which Store
 * the key was issued for. That is the inverse of the guarantee
 * `TenantScopedRepository` holds everywhere else, so the narrowest credential
 * the provider will issue is the one we ask for. It is defence in depth and not
 * throughput — a scoped key buys no extra rate limit.
 *
 * `sealedSecret` is ciphertext (see `secret-box.util`), nullable because a
 * revoked credential's plaintext is destroyed rather than kept. Nothing reads
 * this column except the one call that is about to hand the secret to the
 * provider: it is never selected into a response type, never logged, and never
 * reaches the frontend.
 */
export const adPlatformCredentials = pgTable('ad_platform_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /**
   * Unique, and that uniqueness is the per-Store rule made structural — a
   * second credential for a Store cannot be written by a service that forgets.
   */
  storeId: uuid('store_id')
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: 'cascade' }),
  /** The provider's own handle for this Store's scope. Not a secret. */
  providerRef: varchar('provider_ref', {
    length: AD_PLATFORM_CREDENTIAL_LIMITS.providerRef,
  }).notNull(),
  /** Sealed. Null once revoked — the row outlives the secret it held. */
  sealedSecret: text('sealed_secret'),
  issuedAt: timestamp('issued_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type AdPlatformCredential = typeof adPlatformCredentials.$inferSelect;
export type NewAdPlatformCredential = typeof adPlatformCredentials.$inferInsert;
