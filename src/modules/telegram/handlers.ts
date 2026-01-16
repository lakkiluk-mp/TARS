import { Context } from 'telegraf';
import { createModuleLogger } from '../../utils/logger';
import {
  createMainMenuKeyboard,
  createCampaignKeyboard,
  createRecommendationKeyboard,
} from './keyboards';

const logger = createModuleLogger('telegram-handlers');

// Handler context type with session
export interface BotContext extends Context {
  session?: {
    currentCampaignId?: string;
    currentConversationId?: string;
    awaitingInput?: string;
  };
}

// Orchestrator interface (will be injected)
export interface Orchestrator {
  generateDailyReport(): Promise<{ text: string; recommendations: unknown[] }>;
  generateWeeklyReport(): Promise<{ text: string; recommendations: unknown[] }>;
  getCampaigns(): Promise<{ id: string; name: string }[]>;
  handleUserQuestion(question: string, userId: string): Promise<string>;
  executeAction(actionId: string): Promise<void>;
  getAIUsageStats(): string;
}

let orchestrator: Orchestrator | null = null;

/**
 * Set orchestrator instance
 */
export function setOrchestrator(orch: Orchestrator): void {
  orchestrator = orch;
}

/**
 * Check if user is authorized
 */
export function isAuthorized(ctx: BotContext, adminId: string): boolean {
  const userId = ctx.from?.id?.toString();
  return userId === adminId;
}

/**
 * Handle /start command
 */
export async function handleStart(ctx: BotContext): Promise<void> {
  logger.info('Start command received', { userId: ctx.from?.id });

  const welcomeMessage = `🤖 *TARS — AI-Маркетолог для Яндекс.Директ*

Привет! Я помогу тебе управлять рекламными кампаниями в Яндекс.Директ.

*Что я умею:*
• 📊 Ежедневные и недельные отчёты
• 🔍 Анализ кампаний и рекомендации
• 💬 Отвечать на вопросы о рекламе
• ⚡ Выполнять действия (после твоего одобрения)

*Команды:*
/report — отчёт за вчера
/week — недельный отчёт
/campaigns — список кампаний
/ask [вопрос] — задать вопрос
/help — справка

Выбери действие:`;

  await ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: createMainMenuKeyboard(),
  });
}

/**
 * Handle /help command
 */
export async function handleHelp(ctx: BotContext): Promise<void> {
  const helpMessage = `📚 *Справка по командам TARS*

*Основные команды:*
/start — начало работы
/report — отчёт за вчера
/week — недельный отчёт
/campaigns — список кампаний
/analyze [кампания] — анализ кампании

*Вопросы и диалог:*
/ask [вопрос] — задать вопрос AI
Или просто напиши сообщение — я пойму!

*Управление:*
/settings — настройки
/debug — режим отладки (для разработки)

*Примеры вопросов:*
• "Почему упал CTR в кампании X?"
• "Какие ключевые слова добавить?"
• "Сравни результаты за неделю"

*Кнопки в рекомендациях:*
✅ Согласен — выполнить действие
❌ Нет — отклонить
💬 Почему? — объяснение
✏️ Изменить — скорректировать`;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
}

/**
 * Handle /report command
 */
export async function handleReport(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  logger.info('Report command received', { userId: ctx.from?.id });

  await ctx.reply('⏳ Генерирую отчёт за вчера...');

  try {
    const report = await orchestrator.generateDailyReport();

    await ctx.reply(report.text, { parse_mode: 'Markdown' });

    // Send recommendations with action buttons
    for (const rec of report.recommendations as { id: string; title: string; description: string }[]) {
      await ctx.reply(`💡 *${rec.title}*\n\n${rec.description}`, {
        parse_mode: 'Markdown',
        reply_markup: createRecommendationKeyboard(rec.id),
      });
    }
  } catch (error) {
    logger.error('Failed to generate report', { error });
    await ctx.reply('❌ Не удалось сгенерировать отчёт. Попробуйте позже.');
  }
}

/**
 * Handle /week command
 */
export async function handleWeekReport(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  logger.info('Week report command received', { userId: ctx.from?.id });

  await ctx.reply('⏳ Генерирую недельный отчёт...');

  try {
    const report = await orchestrator.generateWeeklyReport();
    await ctx.reply(report.text, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to generate weekly report', { error });
    await ctx.reply('❌ Не удалось сгенерировать отчёт. Попробуйте позже.');
  }
}

/**
 * Handle /campaigns command
 */
export async function handleCampaigns(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  logger.info('Campaigns command received', { userId: ctx.from?.id });

  try {
    const campaigns = await orchestrator.getCampaigns();

    if (campaigns.length === 0) {
      await ctx.reply('📭 Кампании не найдены');
      return;
    }

    await ctx.reply('🎯 *Ваши кампании:*\n\nВыберите кампанию для анализа:', {
      parse_mode: 'Markdown',
      reply_markup: createCampaignKeyboard(campaigns),
    });
  } catch (error) {
    logger.error('Failed to get campaigns', { error });
    await ctx.reply('❌ Не удалось получить список кампаний');
  }
}

/**
 * Handle /ask command
 */
export async function handleAsk(ctx: BotContext, question: string): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  if (!question.trim()) {
    await ctx.reply('❓ Напишите ваш вопрос после команды /ask\n\nПример: /ask Почему упал CTR?');
    return;
  }

  logger.info('Ask command received', { userId: ctx.from?.id, question });

  await ctx.reply('🤔 Думаю...');

  try {
    const userId = ctx.from?.id?.toString() || 'unknown';
    const answer = await orchestrator.handleUserQuestion(question, userId);
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to answer question', { error });
    await ctx.reply('❌ Не удалось обработать вопрос. Попробуйте переформулировать.');
  }
}

/**
 * Handle text messages (questions without /ask)
 */
export async function handleMessage(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  const text = (ctx.message as { text?: string })?.text;
  if (!text) return;

  logger.info('Message received', { userId: ctx.from?.id, text: text.substring(0, 50) });

  await ctx.reply('🤔 Думаю...');

  try {
    const userId = ctx.from?.id?.toString() || 'unknown';
    const answer = await orchestrator.handleUserQuestion(text, userId);
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to handle message', { error });
    await ctx.reply('❌ Не удалось обработать сообщение. Попробуйте ещё раз.');
  }
}

/**
 * Handle callback queries (button clicks)
 */
export async function handleCallback(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.answerCbQuery('Система не инициализирована');
    return;
  }

  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;

  const data = callbackQuery.data;
  logger.info('Callback received', { userId: ctx.from?.id, data });

  const [action, ...params] = data.split(':');
  const param = params.join(':');

  try {
    switch (action) {
      case 'approve':
        await ctx.answerCbQuery('Выполняю...');
        await orchestrator.executeAction(param);
        await ctx.editMessageText('✅ Действие выполнено!');
        break;

      case 'reject':
        await ctx.answerCbQuery('Отклонено');
        await ctx.editMessageText('❌ Действие отклонено');
        break;

      case 'explain':
        await ctx.answerCbQuery();
        // TODO: Get explanation from AI
        await ctx.reply('💬 Объяснение будет добавлено в следующей версии');
        break;

      case 'modify':
        await ctx.answerCbQuery();
        await ctx.reply('✏️ Напишите, как изменить рекомендацию:');
        break;

      case 'menu':
        await handleMenuCallback(ctx, param);
        break;

      case 'campaign':
        await handleCampaignCallback(ctx, param);
        break;

      case 'period':
        await handlePeriodCallback(ctx, param);
        break;

      case 'back':
        await ctx.answerCbQuery();
        await ctx.editMessageText('Выберите действие:', {
          reply_markup: createMainMenuKeyboard(),
        });
        break;

      default:
        await ctx.answerCbQuery('Неизвестное действие');
    }
  } catch (error) {
    logger.error('Failed to handle callback', { error, action, param });
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

/**
 * Handle menu callbacks
 */
async function handleMenuCallback(ctx: BotContext, menu: string): Promise<void> {
  await ctx.answerCbQuery();

  switch (menu) {
    case 'report':
      await handleReport(ctx);
      break;
    case 'week':
      await handleWeekReport(ctx);
      break;
    case 'campaigns':
      await handleCampaigns(ctx);
      break;
    case 'proposals':
      await ctx.reply('💡 Предложения будут доступны в следующей версии');
      break;
    case 'settings':
      await ctx.reply('⚙️ Настройки будут доступны в следующей версии');
      break;
    case 'usage':
      await handleUsageStats(ctx);
      break;
  }
}

/**
 * Handle /usage command - show AI usage statistics
 */
export async function handleUsageStats(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  logger.info('Usage stats command received', { userId: ctx.from?.id });

  try {
    const stats = orchestrator.getAIUsageStats();
    await ctx.reply(stats, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to get usage stats', { error });
    await ctx.reply('❌ Не удалось получить статистику');
  }
}

/**
 * Handle campaign selection callback
 */
async function handleCampaignCallback(ctx: BotContext, campaignId: string): Promise<void> {
  await ctx.answerCbQuery();

  if (ctx.session) {
    ctx.session.currentCampaignId = campaignId;
  }

  await ctx.reply(`📊 Анализирую кампанию ${campaignId}...`);
  // TODO: Trigger campaign analysis
}

/**
 * Handle period selection callback
 */
async function handlePeriodCallback(ctx: BotContext, period: string): Promise<void> {
  await ctx.answerCbQuery();
  await ctx.reply(`📅 Выбран период: ${period}`);
  // TODO: Generate report for selected period
}

export default {
  setOrchestrator,
  isAuthorized,
  handleStart,
  handleHelp,
  handleReport,
  handleWeekReport,
  handleCampaigns,
  handleAsk,
  handleMessage,
  handleCallback,
};
