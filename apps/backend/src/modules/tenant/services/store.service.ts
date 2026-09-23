import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { stores } from '../../../shared/database/schema';
import type { Store, NewStore } from '../../../shared/database/schema';
import { generateSlug } from '../../../shared/utils/slug.util';
import {
  DEFAULT_PRODUCT_PATH_PATTERN,
  StorefrontUrlError,
  normalizeProductPathPattern,
  normalizeStorefrontUrl,
  resolveStorefrontUrl as resolveUrl,
  storefrontReadiness as readinessOf,
  type StorefrontDestination,
} from '../../../shared/utils/storefront-url.util';
import type { CreateStoreDto, UpdateStoreDto } from '../dto/create-store.dto';

@Injectable()
export class StoreService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async list(orgId: string): Promise<Store[]> {
    return this.db
      .select()
      .from(stores)
      .where(and(eq(stores.organizationId, orgId), isNull(stores.deletedAt)))
      .orderBy(asc(stores.createdAt));
  }

  async findById(id: string, orgId: string): Promise<Store | null> {
    const [row] = await this.db
      .select()
      .from(stores)
      .where(and(eq(stores.id, id), eq(stores.organizationId, orgId)))
      .limit(1);
    return row ?? null;
  }

  async findBySlug(slug: string, orgId: string): Promise<Store | null> {
    const [row] = await this.db
      .select()
      .from(stores)
      .where(and(eq(stores.slug, slug), eq(stores.organizationId, orgId)))
      .limit(1);
    return row ?? null;
  }

  async findFirstActive(orgId: string): Promise<Store | null> {
    const [row] = await this.db
      .select()
      .from(stores)
      .where(
        and(
          eq(stores.organizationId, orgId),
          eq(stores.isActive, true),
          isNull(stores.deletedAt),
        ),
      )
      .orderBy(asc(stores.createdAt))
      .limit(1);
    return row ?? null;
  }

  async create(orgId: string, dto: CreateStoreDto): Promise<Store> {
    const slug = await this.resolveUniqueSlug(orgId, dto.slug ?? dto.name);

    const values: NewStore = {
      organizationId: orgId,
      name: dto.name,
      slug,
      currency: dto.currency ?? 'USD',
      timezone: dto.timezone ?? 'UTC',
      isActive: dto.isActive ?? true,
    };

    if (dto.storefrontUrl !== undefined) {
      values.storefrontUrl = this.readStorefrontUrl(dto.storefrontUrl);
    }
    if (dto.productPathPattern !== undefined) {
      values.productPathPattern = this.readProductPathPattern(
        dto.productPathPattern,
      );
    }
    if (dto.requiresMeasurementConsent !== undefined) {
      values.requiresMeasurementConsent = dto.requiresMeasurementConsent;
    }

    const [row] = await this.db.insert(stores).values(values).returning();
    return row;
  }

  async update(id: string, orgId: string, dto: UpdateStoreDto): Promise<Store> {
    const existing = await this.findById(id, orgId);
    if (!existing) throw new NotFoundException('Store not found');

    const patch: Partial<NewStore> = { updatedAt: new Date() };

    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      patch.slug = await this.resolveUniqueSlug(orgId, dto.slug, id);
    }
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.timezone !== undefined) patch.timezone = dto.timezone;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.storefrontUrl !== undefined) {
      patch.storefrontUrl = this.readStorefrontUrl(dto.storefrontUrl);
    }
    if (dto.productPathPattern !== undefined) {
      patch.productPathPattern = this.readProductPathPattern(
        dto.productPathPattern,
      );
    }
    if (dto.requiresMeasurementConsent !== undefined) {
      patch.requiresMeasurementConsent = dto.requiresMeasurementConsent;
    }

    const [row] = await this.db
      .update(stores)
      .set(patch)
      .where(and(eq(stores.id, id), eq(stores.organizationId, orgId)))
      .returning();
    if (!row) throw new NotFoundException('Store not found after update');
    return row;
  }

  async softDelete(id: string, orgId: string): Promise<void> {
    const existing = await this.findById(id, orgId);
    if (!existing) throw new NotFoundException('Store not found');
    await this.db
      .update(stores)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(and(eq(stores.id, id), eq(stores.organizationId, orgId)));
  }

  // ─── Storefront links ───────────────────────────────────────────────────

  /**
   * The full URL a destination points at, on this Store's own storefront.
   *
   * The single entry point for anything that needs to link into a storefront —
   * an ad's destination, above all. It refuses a destination off the Store's
   * own storefront, because that is the only place our capture script reads
   * the link tags, and refuses to build anything at all while the storefront
   * URL is unset. Both surface as a 400 carrying the reason, so a merchant
   * reads it on the form rather than discovering it after the money is spent.
   */
  async resolveStorefrontUrl(
    storeId: string,
    orgId: string,
    destination: StorefrontDestination,
  ): Promise<string> {
    const store = await this.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');

    return this.orBadRequest(() => resolveUrl(store, destination));
  }

  /**
   * Where this Store's storefront lives, and whether links can be built from
   * it yet. Both settings are optional right up to the moment something needs
   * them, so the admin reads this to say what will not work while they are
   * unset rather than letting a merchant find out on a form they cannot submit.
   */
  async storefrontSettings(
    storeId: string,
    orgId: string,
  ): Promise<{
    storefrontUrl: string | null;
    productPathPattern: string;
    canBuildLinks: boolean;
    missing: string[];
  }> {
    const store = await this.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');
    return {
      storefrontUrl: store.storefrontUrl,
      productPathPattern: store.productPathPattern,
      ...readinessOf(store),
    };
  }

  /** Empty or null clears the setting; anything else must be a valid address. */
  private readStorefrontUrl(input: string | null): string | null {
    if (input === null || input.trim() === '') return null;
    return this.orBadRequest(() => normalizeStorefrontUrl(input));
  }

  /**
   * Empty restores the Starter Storefront's shape rather than storing nothing,
   * because the column is never null — a Store always has a product path.
   */
  private readProductPathPattern(input: string): string {
    if (input.trim() === '') return DEFAULT_PRODUCT_PATH_PATTERN;
    return this.orBadRequest(() => normalizeProductPathPattern(input));
  }

  private orBadRequest<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof StorefrontUrlError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * Generates a slug from `input` and increments a numeric suffix until it's
   * unique within the org. `excludeId` lets `update` skip its own row when
   * the requested slug already belongs to the store being edited.
   */
  private async resolveUniqueSlug(
    orgId: string,
    input: string,
    excludeId?: string,
  ): Promise<string> {
    const base = generateSlug(input);
    let candidate = base;
    let suffix = 1;

    while (await this.slugTaken(orgId, candidate, excludeId)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    return candidate;
  }

  private async slugTaken(
    orgId: string,
    slug: string,
    excludeId?: string,
  ): Promise<boolean> {
    const row = await this.findBySlug(slug, orgId);
    if (!row) return false;
    if (excludeId && row.id === excludeId) return false;
    return true;
  }

  async assertExists(id: string, orgId: string): Promise<Store> {
    const store = await this.findById(id, orgId);
    if (!store) throw new ConflictException('Store not found');
    return store;
  }
}
