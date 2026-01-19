import dotenv from 'dotenv';
dotenv.config();

import { logger } from './utils/logger';
import { initDatabase, checkConnection, closeDatabase } from './database/client';
import { YandexDirectClient } from './modules/yandex';
import { AIEngine } from './modules/ai';
import { TelegramBot } from './modules/telegram';
import { ContextManager, ContextLoader } from './modules/context';
import { Orchestrator } from './modules/orchestrator';
import { initWorkers } from './modules/queue';
import { initScheduler, startScheduler, stopScheduler } from './modules/scheduler';

// Main entry point
async function main() {
  logger.info('🚀 TARS — AI Marketing Assistant for Yandex.Direct');
  logger.info('Starting application...');

  try {
    // 1. Load configuration
    const config = {
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'tars',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'tars',
      },
      yandex: {
        clientId: process.env.YANDEX_CLIENT_ID || '',
        clientSecret: process.env.YANDEX_CLIENT_SECRET || '',
        accessToken: process.env.YANDEX_ACCESS_TOKEN || '',
        refreshToken: process.env.YANDEX_REFRESH_TOKEN || '',
      },
      ai: {
        openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
        primaryModel: process.env.AI_PRIMARY_MODEL || 'anthropic/claude-3.5-sonnet',
        fallbackModel: process.env.AI_FALLBACK_MODEL || 'openai/gpt-4o-mini',
      },
      telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN || '',
        adminId: process.env.TELEGRAM_ADMIN_ID || '',
      },
      debug: process.env.NODE_ENV !== 'production',
    };

    // Validate required config
    if (!config.telegram.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }
    if (!config.telegram.adminId) {
      throw new Error('TELEGRAM_ADMIN_ID is required');
    }

    // 2. Initialize database
    logger.info('Initializing database connection...');
    initDatabase(config.database);
    const dbConnected = await checkConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }
    logger.info('✅ Database connected');

    // 3. Initialize Yandex Direct client
    logger.info('Initializing Yandex Direct client...');
    const yandexClient = new YandexDirectClient(config.yandex, config.debug);
    logger.info('✅ Yandex Direct client initialized');

    // 4. Initialize AI Engine
    logger.info('Initializing AI Engine...');
    const aiEngine = new AIEngine(config.ai, config.debug);
    logger.info('✅ AI Engine initialized');

    // 5. Initialize Telegram Bot
    logger.info('Initializing Telegram Bot...');
    const telegramBot = new TelegramBot(config.telegram);
    logger.info('✅ Telegram Bot initialized');

    // 6. Initialize Context Manager
    logger.info('Initializing Context Manager...');
    const contextManager = new ContextManager();
    logger.info('✅ Context Manager initialized');

    // Load initial context from files
    try {
      logger.info('Loading initial context from files...');
      const contextLoader = new ContextLoader();
      const loadResult = await contextLoader.loadAllContext();
      logger.info('✅ Initial context loaded', {
        loaded: loadResult.loaded,
        skipped: loadResult.skipped,
        errors: loadResult.errors.length,
      });
      if (loadResult.errors.length > 0) {
        logger.warn('Some context files failed to load', { errors: loadResult.errors });
      }
    } catch (error) {
      logger.error('Failed to load initial context', { error });
      // Continue even if context loading fails
    }

    // 7. Initialize Orchestrator
    logger.info('Initializing Orchestrator...');
    const orchestrator = new Orchestrator(yandexClient, aiEngine, telegramBot, contextManager, {
      debugMode: config.debug,
    });
    logger.info('✅ Orchestrator initialized');

    // 7.5. Initialize Queue Workers
    logger.info('Initializing Queue Workers...');
    initWorkers(orchestrator, telegramBot);
    logger.info('✅ Queue Workers initialized');

    // 8. Initialize Scheduler
    logger.info('Initializing Scheduler...');
    initScheduler(
      {
        generateDailyReport: async () => {
          await orchestrator.generateDailyReport();
        },
        runEveningAnalysis: async () => {
          await orchestrator.runEveningAnalysis();
        },
        generateWeeklyReport: async () => {
          await orchestrator.generateWeeklyReport();
        },
        syncYandexData: async () => {
          await orchestrator.syncYandexData();
        },
        cleanupExpiredData: async () => {
          await orchestrator.cleanupExpiredData();
        },
      },
      {
        cleanupExpiredRawResponses: async () => {
          await orchestrator.cleanupExpiredData();
        },
      }
    );
    startScheduler();
    logger.info('✅ Scheduler started');

    // 9. Start Telegram Bot
    await telegramBot.start();
    logger.info('✅ Telegram Bot started');

    // 10. Send startup notification
    await telegramBot.sendToAdmin('🚀 TARS запущен и готов к работе!', { parse_mode: 'Markdown' });

    logger.info('✅ Application started successfully');

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down...`);

      try {
        stopScheduler();
        await telegramBot.stop();
        await closeDatabase();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason });
    });
  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

main();
