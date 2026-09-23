import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
} from '../../../shared/events/events';
import { PurchaseEventService } from './purchase-event.service';

/**
 * Turns a payment into a Purchase Event, promptly.
 *
 * Two events rather than one, because there are two ways an Order becomes paid
 * and both are real purchases. A shopper's Order is created pending and flipped
 * by the payment, which is `order.status_changed`. An Order a merchant keys in as
 * already paid is never flipped at all — it is created paid — and only
 * `order.created` ever mentions it. Listening to the first alone would silently
 * never report a phone sale.
 *
 * Neither handler decides anything. Both hand an Order id to the service, which
 * checks that the Order really is paid, that the Store has a connection, and that
 * the visitor agreed — because a listener that filtered first would be a second
 * copy of those rules, out of step with the scheduled pass by whichever one was
 * edited last.
 *
 * ## Why this is fire-and-forget
 *
 * `OrderService.transition` emits without awaiting, so nothing a shopper or an
 * admin is waiting on is held up by an ad platform, and nothing thrown here could
 * reach the code that took the money even if the service let something escape —
 * which it does not. The cost of that detachment is that a report can be missed
 * entirely: a restart between the payment and this handler loses it. That is paid
 * for elsewhere, by the scheduled pass finding paid Orders that have no dispatch
 * row and reporting them itself. This handler is latency, not bookkeeping.
 */
@Injectable()
export class PurchaseEventHandler {
  constructor(private readonly purchaseEvents: PurchaseEventService) {}

  @OnEvent('order.status_changed')
  async handleOrderStatusChanged(
    event: OrderStatusChangedEvent,
  ): Promise<void> {
    // Only the arrival at paid. Everything after it — processing, shipped — is the
    // same purchase, already reported or already queued.
    if (event.toStatus !== 'paid') return;

    await this.purchaseEvents.dispatchForOrder(
      event.organizationId,
      event.storeId,
      event.orderId,
    );
  }

  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    // Fires for every Order, most of which are pending and will be reported when
    // their payment lands. The service answers with silence for those; the one
    // this is here for is the Order created paid.
    await this.purchaseEvents.dispatchForOrder(
      event.organizationId,
      event.storeId,
      event.orderId,
    );
  }
}
