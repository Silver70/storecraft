import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  applyCorrelatedAttribution,
  applyDeclaredAttribution,
  pickAttribution,
} from '../../../shared/attribution/attribution.util';
import {
  lookbackMs,
  resolveLookbackDays,
} from '../../../shared/attribution/lookback';
import type {
  AttributionPatch,
  AttributionSnapshot,
  DeclaredAttributionInput,
} from '../../../shared/attribution/attribution.types';
import { SessionTouchService } from '../../analytics/services/session-touch.service';
import type { Cart } from '../../../shared/database/schema';

/**
 * Owns what a cart's attribution *is* — folding declared touches into it while
 * it is open, and producing the snapshot frozen onto the order at checkout.
 *
 * The write rules live in `shared/attribution` as pure functions; this service
 * is the seam the rest of the cart module talks to, and the place the
 * event-log correlation fallback attaches to.
 */
@Injectable()
export class CartAttributionService {
  private readonly logger = new Logger(CartAttributionService.name);

  /** Read once at boot, exactly as the attributed-revenue report reads it. */
  private readonly lookbackDays: number;

  constructor(
    private readonly sessionTouches: SessionTouchService,
    config: ConfigService,
  ) {
    this.lookbackDays = resolveLookbackDays(
      config.get('ATTRIBUTION_LOOKBACK_DAYS'),
    );
  }

  /**
   * The columns to write for a declaration on a cart. `current` is null for a
   * cart being created. An empty patch means there was nothing worth storing.
   */
  buildPatch(
    current: Cart | null,
    input: DeclaredAttributionInput | null | undefined,
  ): AttributionPatch {
    return applyDeclaredAttribution(current, input);
  }

  /**
   * The attribution to stamp on the order being created from this cart.
   *
   * Declared attribution is authoritative (ADR-0001), so for a cart that was
   * told where its visitor came from this is a straight copy. A cart that was
   * told nothing but carries a session id falls back to correlating the touches
   * out of the event log for that session — partial coverage for an integrator
   * who has not implemented pass-through yet, rather than none at all. A cart
   * with neither yields an unattributed snapshot, which reports as its own
   * Unattributed bucket rather than being spread across campaigns.
   */
  async resolveForOrder(cart: Cart): Promise<AttributionSnapshot> {
    const declared = pickAttribution(cart);

    if (declared.attributionSource === 'declared' || !declared.sessionId) {
      return declared;
    }

    try {
      return await this.correlate(cart, declared, declared.sessionId);
    } catch (err) {
      // Correlation reads an event stream that may be blocked, purged, or
      // simply unavailable. Losing it costs the merchant a line in a report;
      // the order still gets the cart's own (unattributed) snapshot.
      this.logger.warn(
        `Attribution could not be correlated from the event log for cart ` +
          `${cart.id}; the order will be recorded as unattributed: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return declared;
    }
  }

  /**
   * First and Last Touch inferred from this session's tracked events, marked
   * `correlated` so the merchant can tell an inference from a declaration.
   *
   * Only touches inside the Lookback Window count — a visit from six months ago
   * did not drive today's order — and bot events are excluded by the read
   * itself. A session with no qualifying touch leaves the snapshot alone, so
   * "we looked and found nothing" is recorded as Unattributed, not as a
   * correlation.
   */
  private async correlate(
    cart: Cart,
    snapshot: AttributionSnapshot,
    sessionId: string,
  ): Promise<AttributionSnapshot> {
    const now = new Date();
    const since = new Date(now.getTime() - lookbackMs(this.lookbackDays));

    const { first, last } = await this.sessionTouches.findTouches(
      cart.organizationId,
      cart.storeId,
      sessionId,
      since,
      now,
    );

    const patch = applyCorrelatedAttribution(
      null,
      {
        firstTouch: first,
        lastTouch: last,
        // The event log knows the visitor behind this session even when the
        // cart was never told it. Adopting it is what lets the report's bot
        // check and any later cross-session read find this order.
        visitorId: snapshot.visitorId ?? first?.visitorId ?? last?.visitorId,
      },
      now,
    );

    if (patch.attributionSource !== 'correlated') return snapshot;

    return { ...snapshot, ...patch };
  }
}
