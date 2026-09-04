import { Injectable } from '@nestjs/common';
import {
  applyDeclaredAttribution,
  pickAttribution,
} from '../../../shared/attribution/attribution.util';
import type {
  AttributionPatch,
  AttributionSnapshot,
  DeclaredAttributionInput,
} from '../../../shared/attribution/attribution.types';
import type { Cart } from '../../../shared/database/schema';

/**
 * Owns what a cart's attribution *is* — folding declared touches into it while
 * it is open, and producing the snapshot frozen onto the order at checkout.
 *
 * The write rules live in `shared/attribution` as pure functions; this service
 * is the seam the rest of the cart module talks to, and the place the
 * event-log correlation fallback will attach to.
 */
@Injectable()
export class CartAttributionService {
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
   * Declared attribution is authoritative (ADR-0001), so this is a copy of what
   * the cart carries. A cart that was never told anything yields an
   * unattributed snapshot, which reports as its own Unattributed bucket rather
   * than being spread across campaigns.
   *
   * Promise-returning because resolving is about to need the event log: the
   * correlation fallback for carts that declared nothing queries it here.
   */
  resolveForOrder(cart: Cart): Promise<AttributionSnapshot> {
    return Promise.resolve(pickAttribution(cart));
  }
}
