import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PAYMENT_PROVIDER } from '../../src/modules/payment/interfaces/payment-provider.interface';
import { AD_PLATFORM_PROVIDER } from '../../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import { R2StorageService } from '../../src/shared/storage/r2-storage.service';
import { FakePaymentProvider } from './fake-payment-provider';
import { FakeAdPlatformProvider } from './fake-ad-platform-provider';
import { FakeStorageService } from './fake-storage.service';

export interface TestApp {
  app: INestApplication<App>;
  payments: FakePaymentProvider;
  storage: FakeStorageService;
  adPlatform: FakeAdPlatformProvider;
}

/**
 * Boots the real application against the local test database, with Stripe,
 * object storage and the ad platform replaced by in-memory fakes — the
 * collaborators that would otherwise reach a third party over the network.
 * Everything else — guards,
 * resolvers, services, repositories — is the production wiring, and the request
 * pipeline mirrors main.ts so routes resolve at the same paths they do in
 * production.
 */
export async function createTestApp(): Promise<TestApp> {
  const payments = new FakePaymentProvider();
  const storage = new FakeStorageService();
  const adPlatform = new FakeAdPlatformProvider();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(payments)
    .overrideProvider(R2StorageService)
    .useValue(storage)
    .overrideProvider(AD_PLATFORM_PROVIDER)
    .useValue(adPlatform)
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
  return { app, payments, storage, adPlatform };
}
