import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../../tenant/services/store.service';
import { AdPlatformConnectionRepository } from '../repositories/ad-platform-connection.repository';

/** What a storefront is told about measuring its own visitors. */
export interface MeasurementSettings {
  pixelId: string | null;
  consentRequired: boolean;
}

/**
 * The one answer to "should this storefront measure, and with whose Pixel?".
 *
 * It exists so that connecting an ad platform is the *only* action that turns
 * measurement on. The storefront holds no pixel id, no environment variable and
 * no build-time switch; it asks, on every page, and an unconnected Store is told
 * there is nothing to load. Disconnecting is therefore a disconnect and not a
 * deploy.
 *
 * Meta is the only platform with a Pixel here, which is the whole of ADR-0006's
 * scope. When a second one arrives this is where the choice between them goes.
 */
@Injectable()
export class MeasurementService {
  constructor(
    private readonly connections: AdPlatformConnectionRepository,
    private readonly stores: StoreService,
  ) {}

  async forStore(
    organizationId: string,
    storeId: string,
  ): Promise<MeasurementSettings> {
    const store = await this.stores.findById(storeId, organizationId);
    if (!store) throw new NotFoundException('Store not found');

    const connection = await this.connections.findByPlatform(
      organizationId,
      storeId,
      'meta',
    );

    return {
      // A disconnected connection keeps its pixel id — the figures it pulled
      // are still read against it — so the status decides, not the column.
      pixelId:
        connection?.status === 'connected'
          ? (connection.pixelId ?? null)
          : null,
      consentRequired: store.requiresMeasurementConsent,
    };
  }
}
