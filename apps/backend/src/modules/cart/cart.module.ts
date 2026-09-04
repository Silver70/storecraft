import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentModule } from '../payment/payment.module';
import { OrderModule } from '../order/order.module';
import { CartRepository } from './repositories/cart.repository';
import { CartService } from './services/cart.service';
import { CartAttributionService } from './services/cart-attribution.service';
import { CheckoutService } from './services/checkout.service';
import { CartResolver } from './resolvers/cart.resolver';

@Module({
  imports: [
    AuthModule,
    PricingModule,
    InventoryModule,
    ShippingModule,
    PaymentModule,
    OrderModule,
  ],
  providers: [
    CartRepository,
    CartService,
    CartAttributionService,
    CheckoutService,
    CartResolver,
  ],
  exports: [CartService, CartRepository, CheckoutService],
})
export class CartModule {}
