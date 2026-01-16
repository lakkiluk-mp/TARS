import { Telegraf, session } from 'telegraf';
import { createModuleLogger } from '../../utils/logger';
import {
  BotContext,
  Orchestrator,
  setOrchestrator,
  isAuthorized,
  handleStart,
  handleHelp,
  handleReport,
  handleWeekReport,
  handleCampaigns,
  handleProposals,
  handleCampaignSwitch,
  handleProposalSwitch,
  handleShowContext,
  handleClearContext,
  handleAsk,
  handleUsageStats,
  handleMessage,
  handleCallback,
  handleLoadContext,
  handleListContext,
  handleClearKnowledge,
  handleSync,
} from './handlers';

const logger = createModuleLogger('telegram-bot');

export interface TelegramBotConfig {
  token: string;
  adminId: string;
}

export class TelegramBot {
  private bot: Telegraf<BotContext>;
  private config: TelegramBotConfig;
  private isRunning = false;

  constructor(config: TelegramBotConfig) {
    this.config = config;
    this.bot = new Telegraf<BotContext>(config.token);

    this.setupMiddleware();
    this.setupCommands();
    this.setupCallbacks();
    this.setupMessages();
    this.setupErrorHandling();
  }

  /**
   * Set orchestrator for handlers
   */
  setOrchestrator(orchestrator: Orchestrator): void {
    setOrchestrator(orchestrator);
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    // Session middleware
    this.bot.use(
      session({
        defaultSession: () => ({
          currentCampaignId: undefined,
          currentConversationId: undefined,
          awaitingInput: undefined,
        }),
      })
    );

    // Auth middleware
    this.bot.use(async (ctx, next) => {
      if (!isAuthorized(ctx, this.config.adminId)) {
        logger.warn('Unauthorized access attempt', { userId: ctx.from?.id });
        await ctx.reply(
          '⛔ Доступ запрещён. Этот бот работает только для авторизованных пользователей.'
        );
        return;
      }
      return next();
    });

    // Logging middleware
    this.bot.use(async (ctx, next) => {
      const start = Date.now();
      await next();
      const duration = Date.now() - start;
      logger.debug('Request processed', {
        userId: ctx.from?.id,
        type: ctx.updateType,
        duration,
      });
    });
  }

  /**
   * Setup command handlers
   */
  private setupCommands(): void {
    this.bot.command('start', handleStart);
    this.bot.command('help', handleHelp);
    this.bot.command('report', handleReport);
    this.bot.command('week', handleWeekReport);
    this.bot.command('campaigns', handleCampaigns);
    this.bot.command('proposals', handleProposals);

    // Context management commands
    this.bot.command('campaign', async (ctx) => {
      const text = ctx.message.text;
      const campaignId = text.replace(/^\/campaign\s*/, '').trim();
      await handleCampaignSwitch(ctx, campaignId);
    });

    this.bot.command('proposal', async (ctx) => {
      const text = ctx.message.text;
      const proposalId = text.replace(/^\/proposal\s*/, '').trim();
      await handleProposalSwitch(ctx, proposalId);
    });

    this.bot.command('context', handleShowContext);
    this.bot.command('clear', handleClearContext);

    this.bot.command('ask', async (ctx) => {
      const text = ctx.message.text;
      const question = text.replace(/^\/ask\s*/, '').trim();
      await handleAsk(ctx, question);
    });

    this.bot.command('usage', handleUsageStats);

    // Context loading commands
    this.bot.command('load_context', async (ctx) => {
      const text = ctx.message.text;
      const category = text.replace(/^\/load_context\s*/, '').trim();
      await handleLoadContext(ctx, category || undefined);
    });

    this.bot.command('list_context', handleListContext);
    this.bot.command('clear_knowledge', handleClearKnowledge);

    // Sync command
    this.bot.command('sync', async (ctx) => {
      const text = ctx.message.text;
      const mode = text.replace(/^\/sync\s*/, '').trim();
      await handleSync(ctx, mode || undefined);
    });

    this.bot.command('analyze', async (ctx) => {
      const text = ctx.message.text;
      const campaignName = text.replace(/^\/analyze\s*/, '').trim();
      if (!campaignName) {
        await ctx.reply('Укажите название кампании: /analyze [название]');
        return;
      }
      await ctx.reply(`📊 Анализирую кампанию "${campaignName}"...`);
      // TODO: Implement campaign analysis
    });

    // Debug commands
    this.bot.command('debug', async (ctx) => {
      const text = ctx.message.text;
      const subcommand = text.replace(/^\/debug\s*/, '').trim();

      switch (subcommand) {
        case 'on':
          await ctx.reply('🔧 Режим отладки включён');
          break;
        case 'off':
          await ctx.reply('🔧 Режим отладки выключен');
          break;
        case 'prompt':
          await ctx.reply('📝 Последний промпт будет показан здесь');
          break;
        case 'response':
          await ctx.reply('📝 Последний ответ AI будет показан здесь');
          break;
        default:
          await ctx.reply(
            '🔧 *Команды отладки:*\n' +
              '/debug on — включить\n' +
              '/debug off — выключить\n' +
              '/debug prompt — показать промпт\n' +
              '/debug response — показать ответ AI',
            { parse_mode: 'Markdown' }
          );
      }
    });
  }

  /**
   * Setup callback query handlers
   */
  private setupCallbacks(): void {
    this.bot.on('callback_query', handleCallback);
  }

  /**
   * Setup message handlers
   */
  private setupMessages(): void {
    this.bot.on('text', handleMessage);
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.bot.catch((err, ctx) => {
      logger.error('Bot error', {
        error: err,
        userId: ctx.from?.id,
        updateType: ctx.updateType,
      });
    });
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    logger.info('Starting Telegram bot...');

    try {
      // Set bot commands menu
      await this.bot.telegram.setMyCommands([
        { command: 'start', description: '🚀 Запустить бота' },
        { command: 'report', description: '📊 Отчёт за сегодня' },
        { command: 'week', description: '📈 Отчёт за неделю' },
        { command: 'campaigns', description: '📋 Список кампаний' },
        { command: 'proposals', description: '💡 Список предложений' },
        { command: 'context', description: '📍 Текущий контекст' },
        { command: 'clear', description: '🔄 Сбросить контекст' },
        { command: 'ask', description: '❓ Задать вопрос AI' },
        { command: 'sync', description: '🔄 Синхронизация данных' },
        { command: 'load_context', description: '📥 Загрузить контекст из файлов' },
        { command: 'list_context', description: '📂 Список файлов контекста' },
        { command: 'usage', description: '📉 Статистика AI' },
        { command: 'help', description: '❔ Помощь' },
      ]);
      logger.info('Bot commands menu set');

      await this.bot.launch();
      this.isRunning = true;
      logger.info('Telegram bot started successfully');
    } catch (error) {
      logger.error('Failed to start Telegram bot', { error });
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping Telegram bot...');
    this.bot.stop('SIGTERM');
    this.isRunning = false;
    logger.info('Telegram bot stopped');
  }

  /**
   * Send message to admin
   */
  async sendToAdmin(
    message: string,
    options?: { parse_mode?: 'Markdown' | 'HTML' }
  ): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(this.config.adminId, message, options);
    } catch (error) {
      logger.error('Failed to send message to admin', { error });
    }
  }

  /**
   * Send report to admin
   */
  async sendReport(
    text: string,
    recommendations?: { id: string; title: string; description: string }[]
  ): Promise<void> {
    await this.sendToAdmin(text, { parse_mode: 'Markdown' });

    if (recommendations && recommendations.length > 0) {
      const { createRecommendationKeyboard } = await import('./keyboards');

      for (const rec of recommendations) {
        await this.bot.telegram.sendMessage(
          this.config.adminId,
          `💡 *${rec.title}*\n\n${rec.description}`,
          {
            parse_mode: 'Markdown',
            reply_markup: createRecommendationKeyboard(rec.id),
          }
        );
      }
    }
  }

  /**
   * Get bot instance (for advanced usage)
   */
  getBotInstance(): Telegraf<BotContext> {
    return this.bot;
  }
  /**
   * Send action confirmation request
   */
  async sendActionConfirmation(
    chatId: number | string,
    actionId: string,
    text: string
  ): Promise<number> {
    const { createConfirmKeyboard } = await import('./keyboards');

    const message = await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: createConfirmKeyboard(actionId),
    });

    return message.message_id;
  }
}

export default TelegramBot;
