import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Configuration schema
const configSchema = z.object({
  // Database
  database: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(5432),
    user: z.string().default('tars'),
    password: z.string(),
    name: z.string().default('tars'),
  }),

  // Redis
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
  }),

  // Yandex Direct
  yandex: z.object({
    clientId: z.string(),
    clientSecret: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
  }),

  // OpenRouter AI
  ai: z.object({
    openRouterApiKey: z.string(),
    primaryModel: z.string().default('anthropic/claude-3.5-sonnet'),
    fallbackModel: z.string().default('openai/gpt-4o-mini'),
  }),

  // Telegram
  telegram: z.object({
    botToken: z.string(),
    adminId: z.string(),
  }),

  // App
  app: z.object({
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    timezone: z.string().default('Europe/Moscow'),
  }),

  // Debug
  debug: z.object({
    logYandexRequests: z.coerce.boolean().default(true),
    logYandexResponses: z.coerce.boolean().default(true),
    logAIPrompts: z.coerce.boolean().default(true),
    logAIResponses: z.coerce.boolean().default(true),
    saveRawResponses: z.coerce.boolean().default(true),
    dryRunActions: z.coerce.boolean().default(false),
  }),
});

// Parse and validate configuration
function loadConfig() {
  const rawConfig = {
    database: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      name: process.env.DB_NAME,
    },
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
    },
    yandex: {
      clientId: process.env.YANDEX_CLIENT_ID,
      clientSecret: process.env.YANDEX_CLIENT_SECRET,
      accessToken: process.env.YANDEX_ACCESS_TOKEN,
      refreshToken: process.env.YANDEX_REFRESH_TOKEN,
    },
    ai: {
      openRouterApiKey: process.env.OPENROUTER_API_KEY,
      primaryModel: process.env.AI_PRIMARY_MODEL,
      fallbackModel: process.env.AI_FALLBACK_MODEL,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      adminId: process.env.TELEGRAM_ADMIN_ID,
    },
    app: {
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL,
      timezone: process.env.TZ,
    },
    debug: {
      logYandexRequests: process.env.DEBUG_LOG_YANDEX_REQUESTS,
      logYandexResponses: process.env.DEBUG_LOG_YANDEX_RESPONSES,
      logAIPrompts: process.env.DEBUG_LOG_AI_PROMPTS,
      logAIResponses: process.env.DEBUG_LOG_AI_RESPONSES,
      saveRawResponses: process.env.DEBUG_SAVE_RAW_RESPONSES,
      dryRunActions: process.env.DEBUG_DRY_RUN_ACTIONS,
    },
  };

  return configSchema.parse(rawConfig);
}

export type Config = z.infer<typeof configSchema>;

// Export singleton config
export const config = loadConfig();

export default config;
