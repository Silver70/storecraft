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

  // Admin dashboard base URL — where a merchant is returned after approving an
  // ad-platform connection on the platform's own screen.
  ADMIN_URL: Joi.string().uri().default('http://localhost:3000'),

  // This API's own public base URL. An ad platform redirects the merchant's
  // browser back to it, so it has to be the address they can reach, not the one
  // the process binds to.
  API_PUBLIC_URL: Joi.string().uri().default('http://localhost:4000'),

  // ── Ad platform integration ────────────────────────────────────────────────
  //
  // All optional, and deliberately so: a deployment that has not connected an
  // ad platform boots without them, and only a merchant who tries to connect
  // one is told what is missing. The alternative is a required secret that
  // stops an unrelated deployment from starting.

  // 32 bytes of hex (`openssl rand -hex 32`). Seals ad-platform credentials at
  // rest and, via a separate derived key, signs the note a merchant carries to
  // the platform and back. Rotating it makes existing connections unusable and
  // they must be re-approved.
  AD_PLATFORM_ENCRYPTION_KEY: Joi.string().hex().length(64).optional(),

  // Read only by the provider adapter. Neutral names on purpose: swapping the
  // vendor behind the interface should not be an operations change.
  AD_PLATFORM_API_KEY: Joi.string().optional(),
  AD_PLATFORM_LINK_DOMAIN: Joi.string().optional(),
  AD_PLATFORM_LINK_PRIVATE_KEY: Joi.string().optional(),

  // Days of raw analytics_events to retain before the nightly purge. Daily
  // rollups are permanent regardless. Set to 0 to disable purging entirely.
  ANALYTICS_RETENTION_DAYS: Joi.number().integer().min(0).default(90),
});
