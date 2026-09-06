import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PAYMENT_PROVIDER } from '../../src/modules/payment/interfaces/payment-provider.interface';
import { FakePaymentProvider } from './fake-payment-provider';

export interface TestApp {
  app: INestApplication<App>;
  payments: FakePaymentProvider;
}

/**
 * Boots the real application against the local test database, with Stripe
 * replaced by an in-memory fake. Everything else — guards, resolvers, services,
 * repositories — is the production wiring, and the request pipeline mirrors
 * main.ts so routes resolve at the same paths they do in production.
 */
export async function createTestApp(): Promise<TestApp> {
  const payments = new FakePaymentProvider();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(payments)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  app.setGlobalPrefix('api', {
    exclude: [
      '/graphql',
      { path: 'ca.js', method: RequestMethod.GET },
      { path: 'ie.js', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();
  return { app, payments };
}
