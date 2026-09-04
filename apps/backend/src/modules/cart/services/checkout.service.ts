import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CartRepository } from '../repositories/cart.repository';
import { CartService } from './cart.service';
import { CartAttributionService } from './cart-attribution.service';
import { PricingEngineService } from '../../pricing/services/pricing-engine.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { ShippingService } from '../../shipping/services/shipping.service';
import { PaymentService } from '../../payment/services/payment.service';
import { OrderRepository } from '../../order/repositories/order.repository';
import { OrderCreatedEvent } from '../../../shared/events/events';
import { add, subtract } from '../../../shared/utils/money.util';
import { emptyAttribution } from '../../../shared/attribution/attribution.util';
import { requireStoreContext } from '../../../shared/tenant/tenant.util';
import type { AddressInputDto } from '../dto/checkout.dto';
import type { CheckoutInput } from '../models/checkout-input.model';
import type { TenantContext } from '../../../shared/tenant/tenant-context';
import type { CheckoutResultType } from '../models/checkout.model';
import type { AttributionSnapshot } from '../../../shared/attribution/attribution.types';
import type { Cart } from '../../../shared/database/schema';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly cartRepo: CartRepository,
    private readonly cartService: CartService,
    private readonly pricingEngine: PricingEngineService,
    private readonly inventoryService: InventoryService,
    private readonly shippingService: ShippingService,
    private readonly paymentService: PaymentService,
    private readonly orderRepo: OrderRepository,
    private readonly attribution: CartAttributionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async checkout(
    cartId: string,
    dto: CheckoutInput,
    tenantCtx: TenantContext,
  ): Promise<CheckoutResultType> {
    const { organizationId: orgId, storeId } = requireStoreContext(tenantCtx);

    // 1. Load and validate cart
    const existing = await this.cartRepo.findById(cartId, orgId, storeId);
    if (!existing) throw new NotFoundException('Cart not found');
    if (existing.status !== 'active') {
      throw new ConflictException('Cart is no longer active');
    }

    // Re-resolve contract prices to lock fresh pricing right before reserving
    // inventory; the order line-item snapshots below capture these values.
    const cart = await this.cartService.recalculate(cartId, orgId, storeId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Resolve shipping address
    const shippingAddress = this.resolveAddress(dto);

    // 2. Reserve inventory for all items (all-or-nothing)
    const reservationIds: string[] = [];
    try {
      for (const item of cart.items) {
        const reservation = await this.inventoryService.reserve(
          item.variantId,
          item.quantity,
          orgId,
          storeId,
          cartId,
        );
        reservationIds.push(reservation.id);
      }
    } catch (err) {
      // Roll back successful reservations before re-throwing
      for (const resId of reservationIds) {
        await this.inventoryService
          .release(resId, orgId, storeId)
          .catch(() => undefined);
      }
      throw err;
    }

    // 3. Apply discounts + calculate tax
    const discountResult = await this.pricingEngine.applyDiscounts(
      cart.items,
      cart.couponCode ?? null,
      orgId,
      storeId,
    );

    const pricedItems = cart.items.map((item, idx) => ({
      variantId: item.variantId,
      lineTotal:
        discountResult.items[idx]?.discountedLineTotal ?? item.totalPrice,
    }));

    const taxResult = await this.pricingEngine.calculateTax(
      pricedItems,
      {
        countryCode: shippingAddress.countryCode,
        stateCode: shippingAddress.state ?? null,
      },
      orgId,
      storeId,
    );

    // 4. Get shipping price
    const shippingAmount = discountResult.isFreeShipping
      ? 0
      : await this.shippingService.getMethodPrice(
          dto.shippingMethodId,
          orgId,
          storeId,
        );

    // 5. Compute final totals
    const subtotal = cart.items.reduce(
      (sum, item) => add(sum, item.quantity * item.unitPrice),
      0,
    );
    const discountAmount = discountResult.totalDiscountAmount;
    const taxAmount = taxResult.taxAmount;
    const total = Math.max(
      0,
      add(subtract(subtotal, discountAmount), add(taxAmount, shippingAmount)),
    );

    // 6. Create order + line items
    const orderNumber = await this.orderRepo.generateOrderNumber(
      orgId,
      storeId,
    );
    const customerEmail = dto.email.trim();
    if (!customerEmail) {
      throw new BadRequestException('A contact email is required to check out');
    }
    const customerName = this.buildCustomerName(shippingAddress);

    // Freeze the cart's attribution onto the order. From here it is a snapshot
    // of purchase-time conditions, exactly like the line items below: the same
    // visitor arriving later through a different campaign never rewrites it.
    const attribution = await this.resolveAttribution(cart);

    const order = await this.orderRepo.create({
      organizationId: orgId,
      storeId,
      orderNumber,
      customerId: tenantCtx.customerId ?? null,
      customerEmail,
      customerName,
      status: 'pending',
      fulfillmentStatus: 'unfulfilled',
      subtotal,
      discountAmount,
      taxAmount,
      shippingAmount,
      total,
      currency: cart.currency,
      couponCode: cart.couponCode ?? null,
      shippingAddress: {
        firstName: shippingAddress.firstName,
        lastName: shippingAddress.lastName,
        company: shippingAddress.company,
        line1: shippingAddress.line1,
        line2: shippingAddress.line2,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.postalCode,
        countryCode: shippingAddress.countryCode,
        phone: shippingAddress.phone,
      },
      shippingMethodId: dto.shippingMethodId,
      source: 'storefront',
      ...attribution,
    });

    // 7. Create order line item snapshots. Capture the product name + primary
    // image as they are at purchase time so the order is immutable against later
    // catalog edits (per the line-item snapshot rule).
    const productSnapshots = await this.cartRepo.getProductSnapshots(
      [...new Set(cart.items.map((item) => item.variant.productId))],
      orgId,
      storeId,
    );

    const lineItemData = cart.items.map((item, idx) => {
      const snapshot = productSnapshots.get(item.variant.productId);
      return {
        organizationId: orgId,
        storeId,
        orderId: order.id,
        variantId: item.variantId,
        productName: snapshot?.name ?? item.variant.name ?? item.variant.sku,
        variantName: item.variant.name,
        sku: item.variant.sku,
        imageUrl: snapshot?.imageUrl ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.quantity * item.unitPrice,
        discountAmount: discountResult.items[idx]?.discountAmount ?? 0,
      };
    });

    await this.orderRepo.createLineItems(lineItemData);

    // 8. Associate reservations with the new order so convertReservations() can find them
    await this.inventoryService.associateReservationsWithOrder(
      reservationIds,
      order.id,
    );

    // 9. Create payment intent
    const payment = await this.paymentService.createPaymentRecord(
      order.id,
      total,
      cart.currency,
      orgId,
      storeId,
    );

    // 10. Convert cart to converted
    await this.cartService.markConverted(cartId, orgId, storeId);

    // 11. Emit order created event
    this.eventEmitter.emit(
      'order.created',
      new OrderCreatedEvent(
        order.id,
        orgId,
        storeId,
        tenantCtx.customerId ?? null,
      ),
    );

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentClientSecret: payment.clientSecret ?? '',
      total: order.total,
      currency: order.currency,
    };
  }

  /**
   * The attribution to stamp on the order, and never a reason not to have one.
   * Attribution is a reporting concern; a failure to resolve it costs the
   * merchant a line in a report, not the sale. Anything that goes wrong is
   * logged and the order is created as Unattributed.
   */
  private async resolveAttribution(cart: Cart): Promise<AttributionSnapshot> {
    try {
      return await this.attribution.resolveForOrder(cart);
    } catch (err) {
      this.logger.error(
        `Attribution could not be resolved for cart ${cart.id}; ` +
          'the order will be recorded as unattributed',
        err instanceof Error ? err.stack : String(err),
      );
      return emptyAttribution();
    }
  }

  private resolveAddress(dto: CheckoutInput): AddressInputDto {
    if (dto.shippingAddress) {
      return dto.shippingAddress;
    }
    throw new BadRequestException(
      'Shipping address is required (provide shippingAddress or shippingAddressId)',
    );
  }

  private buildCustomerName(address: AddressInputDto): string {
    return `${address.firstName} ${address.lastName}`.trim();
  }
}
