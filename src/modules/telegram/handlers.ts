import { Context } from 'telegraf';
import { createModuleLogger } from '../../utils/logger';
import {
  createMainMenuKeyboard,
  createCampaignKeyboard,
  createRecommendationKeyboard,
  createProposalKeyboard,
  createCampaignClarificationKeyboard,
  createProposalClarificationKeyboard,
  createCurrentContextKeyboard,
} from './keyboards';
import { ContextLoader } from '../context';

const logger = createModuleLogger('telegram-handlers');

// Handler context type with session
export interface BotContext extends Context {
  session?: {
    currentCampaignId?: string;
    currentConversationId?: string;
    awaitingInput?: string;
  };
}

// Clarification response type
export interface ClarificationResponse {
  needsClarification: true;
  message: string;
  campaigns?: { id: string; name: string }[];
  proposals?: { id: string; title: string }[];
}

// Orchestrator interface (will be injected)
export interface Orchestrator {
  generateDailyReport(): Promise<{ text: string; recommendations: unknown[] }>;
  generateWeeklyReport(): Promise<{ text: string; recommendations: unknown[] }>;
  getCampaigns(filter?: 'active' | 'all'): Promise<{ id: string; name: string; status?: string }[]>;
  getProposals(): Promise<{ id: string; title: string; status: string }[]>;
  handleUserQuestion(question: string, userId: string): Promise<string | ClarificationResponse>;
  executeAction(actionId: string): Promise<void>;
  getAIUsageStats(): string;
  setCurrentCampaign(userId: string, campaignId: string): Promise<void>;
  setCurrentProposal(userId: string, proposalId: string): Promise<void>;
  clearCurrentContext(userId: string): Promise<void>;
  getCurrentContext(userId: string): Promise<{
    campaign?: { id: string; name: string };
    proposal?: { id: string; title: string };
  }>;
  syncYandexData(mode?: 'full' | 'recent'): Promise<void>;
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
/proposals — список предложений
/analyze [кампания] — анализ кампании

*Контекст и диалог:*
/campaign [id] — переключиться на кампанию
/proposal [id] — переключиться на предложение
/context — показать текущий контекст
/clear — сбросить контекст

*Вопросы:*
/ask [вопрос] — задать вопрос AI
Или просто напиши сообщение — я пойму!

*Управление:*
/settings — настройки
/usage — статистика AI

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

    await ctx.reply('🎯 *Ваши кампании:*\n\nВыберите кампанию для переключения контекста:', {
      parse_mode: 'Markdown',
      reply_markup: createCampaignKeyboard(campaigns),
    });
  } catch (error) {
    logger.error('Failed to get campaigns', { error });
    await ctx.reply('❌ Не удалось получить список кампаний');
  }
}

/**
 * Handle /proposals command
 */
export async function handleProposals(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  logger.info('Proposals command received', { userId: ctx.from?.id });

  try {
    const proposals = await orchestrator.getProposals();

    if (proposals.length === 0) {
      await ctx.reply('📭 Предложения не найдены');
      return;
    }

    await ctx.reply('💡 *Предложения:*\n\nВыберите предложение для обсуждения:', {
      parse_mode: 'Markdown',
      reply_markup: createProposalKeyboard(proposals),
    });
  } catch (error) {
    logger.error('Failed to get proposals', { error });
    await ctx.reply('❌ Не удалось получить список предложений');
  }
}

/**
 * Handle /campaign [id] command - switch to campaign context
 */
export async function handleCampaignSwitch(ctx: BotContext, campaignId: string): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  const userId = ctx.from?.id?.toString() || 'unknown';

  if (!campaignId.trim()) {
    // Show campaign list for selection
    await handleCampaigns(ctx);
    return;
  }

  logger.info('Campaign switch command received', { userId, campaignId });

  try {
    await orchestrator.setCurrentCampaign(userId, campaignId);
    await ctx.reply(`✅ Контекст переключён на кампанию *${campaignId}*\n\nТеперь все вопросы будут относиться к этой кампании.`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.error('Failed to switch campaign', { error });
    await ctx.reply('❌ Не удалось переключить контекст. Проверьте ID кампании.');
  }
}

/**
 * Handle /proposal [id] command - switch to proposal context
 */
export async function handleProposalSwitch(ctx: BotContext, proposalId: string): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  const userId = ctx.from?.id?.toString() || 'unknown';

  if (!proposalId.trim()) {
    // Show proposal list for selection
    await handleProposals(ctx);
    return;
  }

  logger.info('Proposal switch command received', { userId, proposalId });

  try {
    await orchestrator.setCurrentProposal(userId, proposalId);
    await ctx.reply(`✅ Контекст переключён на предложение\n\nТеперь все вопросы будут относиться к этому предложению.`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.error('Failed to switch proposal', { error });
    await ctx.reply('❌ Не удалось переключить контекст. Проверьте ID предложения.');
  }
}

/**
 * Handle /context command - show current context
 */
export async function handleShowContext(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  const userId = ctx.from?.id?.toString() || 'unknown';

  logger.info('Show context command received', { userId });

  try {
    const context = await orchestrator.getCurrentContext(userId);

    let message = '📍 *Текущий контекст:*\n\n';

    if (context.campaign) {
      message += `🎯 Кампания: *${context.campaign.name}*\n`;
    }

    if (context.proposal) {
      message += `💡 Предложение: *${context.proposal.title}*\n`;
    }

    if (!context.campaign && !context.proposal) {
      message += '🌐 Общий контекст (без привязки к кампании)\n';
    }

    message += '\nВсе вопросы будут анализироваться в этом контексте.';

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: createCurrentContextKeyboard(context.campaign, context.proposal),
    });
  } catch (error) {
    logger.error('Failed to get context', { error });
    await ctx.reply('❌ Не удалось получить текущий контекст');
  }
}

/**
 * Handle /clear command - clear current context
 */
export async function handleClearContext(ctx: BotContext): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  const userId = ctx.from?.id?.toString() || 'unknown';

  logger.info('Clear context command received', { userId });

  try {
    await orchestrator.clearCurrentContext(userId);
    await ctx.reply('✅ Контекст сброшен\n\nТеперь вопросы будут анализироваться в общем контексте.', {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.error('Failed to clear context', { error });
    await ctx.reply('❌ Не удалось сбросить контекст');
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
    const result = await orchestrator.handleUserQuestion(question, userId);
    
    // Check if clarification is needed
    if (typeof result === 'object' && result.needsClarification) {
      // Show clarification keyboard
      if (result.campaigns && result.campaigns.length > 0) {
        await ctx.reply(result.message, {
          parse_mode: 'Markdown',
          reply_markup: createCampaignClarificationKeyboard(result.campaigns),
        });
      } else if (result.proposals && result.proposals.length > 0) {
        await ctx.reply(result.message, {
          parse_mode: 'Markdown',
          reply_markup: createProposalClarificationKeyboard(result.proposals),
        });
      } else {
        await ctx.reply('❓ Не удалось определить контекст. Используйте /campaign или /proposal для выбора.');
      }
    } else {
      // Normal answer
      await ctx.reply(result as string, { parse_mode: 'Markdown' });
    }
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
    const result = await orchestrator.handleUserQuestion(text, userId);
    
    // Check if clarification is needed
    if (typeof result === 'object' && result.needsClarification) {
      // Show clarification keyboard
      if (result.campaigns && result.campaigns.length > 0) {
        await ctx.reply(result.message, {
          parse_mode: 'Markdown',
          reply_markup: createCampaignClarificationKeyboard(result.campaigns),
        });
      } else if (result.proposals && result.proposals.length > 0) {
        await ctx.reply(result.message, {
          parse_mode: 'Markdown',
          reply_markup: createProposalClarificationKeyboard(result.proposals),
        });
      } else {
        await ctx.reply('❓ Не удалось определить контекст. Используйте /campaign или /proposal для выбора.');
      }
    } else {
      // Normal answer
      await ctx.reply(result as string, { parse_mode: 'Markdown' });
    }
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

  const userId = ctx.from?.id?.toString() || 'unknown';

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
        await handleCampaignCallback(ctx, param, userId);
        break;

      case 'proposal':
        await handleProposalCallback(ctx, param, userId);
        break;

      case 'set_campaign':
        await handleSetCampaignCallback(ctx, param, userId);
        break;

      case 'set_proposal':
        await handleSetProposalCallback(ctx, param, userId);
        break;

      case 'clear_context':
        await handleClearContextCallback(ctx, userId);
        break;

      case 'cancel_clarification':
        await ctx.answerCbQuery('Отменено');
        await ctx.editMessageText('❌ Выбор отменён');
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
      await handleProposals(ctx);
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
 * Handle campaign selection callback - switch context to campaign
 */
async function handleCampaignCallback(ctx: BotContext, campaignId: string, userId: string): Promise<void> {
  await ctx.answerCbQuery('Переключаю контекст...');

  if (!orchestrator) return;

  try {
    await orchestrator.setCurrentCampaign(userId, campaignId);
    await ctx.editMessageText(`✅ Контекст переключён на кампанию\n\nТеперь все вопросы будут относиться к этой кампании.`);
  } catch (error) {
    logger.error('Failed to switch campaign context', { error });
    await ctx.reply('❌ Не удалось переключить контекст');
  }
}

/**
 * Handle proposal selection callback - switch context to proposal
 */
async function handleProposalCallback(ctx: BotContext, proposalId: string, userId: string): Promise<void> {
  await ctx.answerCbQuery('Переключаю контекст...');

  if (!orchestrator) return;

  try {
    await orchestrator.setCurrentProposal(userId, proposalId);
    await ctx.editMessageText(`✅ Контекст переключён на предложение\n\nТеперь все вопросы будут относиться к этому предложению.`);
  } catch (error) {
    logger.error('Failed to switch proposal context', { error });
    await ctx.reply('❌ Не удалось переключить контекст');
  }
}

/**
 * Handle set campaign callback from clarification keyboard
 */
async function handleSetCampaignCallback(ctx: BotContext, campaignId: string, userId: string): Promise<void> {
  await ctx.answerCbQuery('Выбрано');

  if (!orchestrator) return;

  try {
    await orchestrator.setCurrentCampaign(userId, campaignId);
    await ctx.editMessageText(`✅ Выбрана кампания. Контекст установлен.`);
  } catch (error) {
    logger.error('Failed to set campaign', { error });
    await ctx.reply('❌ Не удалось установить кампанию');
  }
}

/**
 * Handle set proposal callback from clarification keyboard
 */
async function handleSetProposalCallback(ctx: BotContext, proposalId: string, userId: string): Promise<void> {
  await ctx.answerCbQuery('Выбрано');

  if (!orchestrator) return;

  try {
    await orchestrator.setCurrentProposal(userId, proposalId);
    await ctx.editMessageText(`✅ Выбрано предложение. Контекст установлен.`);
  } catch (error) {
    logger.error('Failed to set proposal', { error });
    await ctx.reply('❌ Не удалось установить предложение');
  }
}

/**
 * Handle clear context callback
 */
async function handleClearContextCallback(ctx: BotContext, userId: string): Promise<void> {
  await ctx.answerCbQuery('Сбрасываю контекст...');

  if (!orchestrator) return;

  try {
    await orchestrator.clearCurrentContext(userId);
    await ctx.editMessageText(`✅ Контекст сброшен\n\nТеперь вопросы будут анализироваться в общем контексте.`);
  } catch (error) {
    logger.error('Failed to clear context', { error });
    await ctx.reply('❌ Не удалось сбросить контекст');
  }
}

/**
 * Handle period selection callback
 */
async function handlePeriodCallback(ctx: BotContext, period: string): Promise<void> {
  await ctx.answerCbQuery();
  await ctx.reply(`📅 Выбран период: ${period}`);
  // TODO: Generate report for selected period
}

/**
 * Handle /load_context command - load initial context from .md files
 */
export async function handleLoadContext(ctx: BotContext, category?: string): Promise<void> {
  logger.info('Load context command received', { userId: ctx.from?.id, category });

  await ctx.reply('📥 Загружаю контекст из файлов...');

  try {
    const loader = new ContextLoader();

    let result;
    if (category && category.trim()) {
      result = await loader.loadCategory(category.trim());
    } else {
      result = await loader.loadAllContext();
    }

    let message = `✅ *Контекст загружен*\n\n`;
    message += `📄 Загружено файлов: ${result.loaded}\n`;
    message += `⏭️ Пропущено: ${result.skipped}\n`;

    if (result.files.length > 0) {
      message += `\n*Загруженные файлы:*\n`;
      for (const file of result.files) {
        message += `• ${file.category}/${file.filename}\n`;
      }
    }

    if (result.errors.length > 0) {
      message += `\n⚠️ *Ошибки:*\n`;
      for (const error of result.errors) {
        message += `• ${error}\n`;
      }
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to load context', { error });
    await ctx.reply('❌ Не удалось загрузить контекст');
  }
}

/**
 * Handle /list_context command - show available context files
 */
export async function handleListContext(ctx: BotContext): Promise<void> {
  logger.info('List context command received', { userId: ctx.from?.id });

  try {
    const loader = new ContextLoader();
    const available = loader.getAvailableFiles();

    if (available.length === 0) {
      await ctx.reply('📭 Файлы контекста не найдены\n\nСоздайте .md файлы в папке context/');
      return;
    }

    let message = '📂 *Доступные файлы контекста:*\n\n';

    for (const category of available) {
      message += `*${category.category}/*\n`;
      for (const file of category.files) {
        message += `  • ${file}\n`;
      }
      message += '\n';
    }

    message += '\nИспользуйте /load\\_context для загрузки всех файлов\n';
    message += 'или /load\\_context [категория] для загрузки конкретной категории';

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to list context', { error });
    await ctx.reply('❌ Не удалось получить список файлов');
  }
}

/**
 * Handle /clear_knowledge command - clear initial context from knowledge base
 */
export async function handleClearKnowledge(ctx: BotContext): Promise<void> {
  logger.info('Clear knowledge command received', { userId: ctx.from?.id });

  try {
    const loader = new ContextLoader();
    const count = await loader.clearInitialContext();

    await ctx.reply(`✅ Удалено ${count} записей из базы знаний`, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to clear knowledge', { error });
    await ctx.reply('❌ Не удалось очистить базу знаний');
  }
}

/**
 * Handle /sync command - sync data from Yandex.Direct
 */
export async function handleSync(ctx: BotContext, mode?: string): Promise<void> {
  if (!orchestrator) {
    await ctx.reply('⚠️ Система ещё не инициализирована');
    return;
  }

  logger.info('Sync command received', { userId: ctx.from?.id, mode });

  const syncMode = mode === 'full' ? 'full' : 'recent';
  const modeText = syncMode === 'full' ? 'полную (90 дней)' : 'быструю (7 дней)';

  await ctx.reply(`🔄 Запускаю ${modeText} синхронизацию данных...`);

  try {
    await orchestrator.syncYandexData(syncMode);
    await ctx.reply(`✅ Синхронизация завершена!`, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to sync data', { error });
    await ctx.reply('❌ Не удалось синхронизировать данные');
  }
}

export default {
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
  handleMessage,
  handleCallback,
  handleUsageStats,
  handleLoadContext,
  handleListContext,
  handleClearKnowledge,
  handleSync,
};
