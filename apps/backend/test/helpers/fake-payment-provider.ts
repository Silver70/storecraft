import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  CreatePaymentIntentResult,
  PaymentProvider,
  RefundResult,
  StripeWebhookEvent,
} from '../../src/modules/payment/interfaces/payment-provider.interface';

/**
 * Stands in for Stripe. Everything else in the suite is the real service
 * running against a real database; the payment provider is the one collaborator
 * that would otherwise reach a third party over the network, and it sits behind
 * the PaymentProvider interface precisely so it can be swapped.
 *
 * It records what it was asked for, so a test can assert the order total
 * reached the payment leg intact.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly createdIntents: {
    amount: number;
    currency: string;
    metadata: Record<string, string>;
  }[] = [];

  createPaymentIntent(
    amount: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<CreatePaymentIntentResult> {
    this.createdIntents.push({ amount, currency, metadata });
    const paymentIntentId = `pi_test_${randomUUID().replace(/-/g, '')}`;
    return Promise.resolve({
      paymentIntentId,
      clientSecret: `${paymentIntentId}_secret_test`,
    });
  }

  capturePayment(): Promise<void> {
    return Promise.resolve();
  }

  refundPayment(): Promise<RefundResult> {
    return Promise.resolve({
      refundId: `re_test_${randomUUID().replace(/-/g, '')}`,
    });
  }

  verifyWebhookSignature(payload: string): StripeWebhookEvent {
    return JSON.parse(payload) as StripeWebhookEvent;
  }
}
