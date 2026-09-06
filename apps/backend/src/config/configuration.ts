import * as Joi from 'joi';

export const validationSchema = Joi.object({
  PORT: Joi.number().default(4000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  DATABASE_URL: Joi.string().required(),

  CUSTOMER_JWT_SECRET: Joi.string().min(64).required(),

  // Secret for self-issued admin (dashboard) JWTs. Replaces WorkOS-signed tokens.
  ADMIN_JWT_SECRET: Joi.string().min(64).required(),

  // Storefront base URL — used to build admin-shared set-password links.
  STOREFRONT_URL: Joi.string().uri().default('http://localhost:5173'),

  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),

  STORAGE_BUCKET: Joi.string().required(),
  STORAGE_ACCOUNT_ID: Joi.string().required(),
  STORAGE_ACCESS_KEY_ID: Joi.string().required(),
  STORAGE_SECRET_ACCESS_KEY: Joi.string().required(),
  STORAGE_PUBLIC_URL: Joi.string().uri().required(),

  CORS_ORIGINS: Joi.string().default(''),

  // Days of raw analytics_events to retain before the nightly purge. Daily
  // rollups are permanent regardless. Set to 0 to disable purging entirely.
  ANALYTICS_RETENTION_DAYS: Joi.number().integer().min(0).default(90),
});
