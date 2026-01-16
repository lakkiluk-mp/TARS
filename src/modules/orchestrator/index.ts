import { createModuleLogger } from '../../utils/logger';
import { formatDate, getYesterday, getDaysAgo, getWeekStart } from '../../utils/helpers';
import { YandexDirectClient, CampaignStats } from '../yandex';
import { AIEngine, AnalysisResponse, CampaignData, Recommendation, AnalysisContext } from '../ai';
import { TelegramBot } from '../telegram';
import { ContextManager, BuiltContext } from '../context';
import { campaignsRepo, dailyStatsRepo } from '../../database/repositories';
import { query } from '../../database/client';

const logger = createModuleLogger('orchestrator');

const MIN_QUERY_COST = 50; // Minimum cost to consider a query significant
const MIN_QUERY_CLICKS = 2; // Minimum clicks to consider a query significant
const MAX_QUERIES_FOR_AI = 10; // Limit queries sent to AI to save tokens

export interface OrchestratorConfig {
  debugMode?: boolean;
}

import { ActionManager } from '../actions/manager';
import { ActionType } from '../actions/types';
import { actionsRepo } from '../../database/repositories';

// ... existing imports ...

export class Orchestrator {
  private yandex: YandexDirectClient;
  private ai: AIEngine;
  private telegram: TelegramBot;
  private context: ContextManager;
  private actionManager: ActionManager; // New
  private config: OrchestratorConfig;

  constructor(
    yandex: YandexDirectClient,
    ai: AIEngine,
    telegram: TelegramBot,
    context: ContextManager,
    config: OrchestratorConfig = {}
  ) {
    this.yandex = yandex;
    this.ai = ai;
    this.telegram = telegram;
    this.context = context;
    this.config = config;
    this.actionManager = new ActionManager(yandex); // Initialize

    // Set orchestrator in telegram handlers
    telegram.setOrchestrator(this);
  }

  /**
   * Generate daily report
   */
  async generateDailyReport(): Promise<{ text: string; recommendations: Recommendation[] }> {
    logger.info('Generating daily report...');

    try {
      // 1. Fetch yesterday's stats from Yandex
      const yesterday = formatDate(getYesterday());
      const stats = await this.yandex.getStats(yesterday, yesterday);

      // 2. Save stats to database
      await this.saveStats(stats);

      // 3. Get previous day stats for comparison
      const twoDaysAgo = formatDate(getDaysAgo(2));
      const previousStats = await dailyStatsRepo.findAllByDateRange(twoDaysAgo, twoDaysAgo);

      // 4. Prepare data for AI
      const campaignData = await this.prepareCampaignData(stats, previousStats);

      // Enhance with search queries for better context (Negative Keywords)
      for (const campaign of campaignData) {
        try {
          // Get queries for the last 3 days to spot trends
          const queries = await this.yandex.getSearchQueries(
            campaign.campaignId,
            formatDate(getDaysAgo(3)),
            formatDate(getYesterday())
          );

          // Filter high cost queries (e.g. > 50 rub) or high clicks (> 2)
          // This is a naive filter, AI will do the real filtering
          campaign.searchQueries = queries
            .filter((q) => q.cost > MIN_QUERY_COST || q.clicks > MIN_QUERY_CLICKS)
            .sort((a, b) => b.cost - a.cost)
            .slice(0, MAX_QUERIES_FOR_AI); // Limit to top 10 to save tokens
        } catch (e) {
          logger.warn(`Failed to fetch queries for campaign ${campaign.campaignId}`, { error: e });
        }
      }

      // 5. Get analysis from AI
      const analysis = await this.ai.analyze({
        data: campaignData,
        context: {
          goals: 'Максимизация конверсий при оптимальном CPA',
        },
        task: 'daily_report',
      });

      // 6. Propose actions from AI recommendations
      for (const rec of analysis.recommendations) {
        if (rec.action) {
          // Map AI action type to internal ActionType
          // AI types: update_bid, add_negative_keyword, suspend_campaign, resume_campaign
          // Internal ActionTypes match these strings mostly, but let's be safe
          if (Object.values(ActionType).includes(rec.action.type as ActionType)) {
            await this.proposeAction(
              rec.action.campaignId || campaignData[0]?.campaignId || '', // Fallback to first campaign if not specified
              rec.action.type as ActionType,
              rec.action.params,
              rec.reasoning
            );
          }
        }
      }

      // 7. Format and send report
      const reportText = this.formatDailyReport(analysis, stats);

      await this.telegram.sendReport(
        reportText,
        // Only send recommendations that DON'T have direct actions attached
        // (because actions are sent as separate confirmation cards)
        // OR send all, but maybe modify the report format.
        // For now, let's send text recommendations as list in the report,
        // and actions as separate cards via proposeAction above.
        analysis.recommendations
          .filter((r) => !r.action)
          .map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
          }))
      );

      logger.info('Daily report generated and sent');

      return {
        text: reportText,
        recommendations: analysis.recommendations,
      };
    } catch (error) {
      logger.error('Failed to generate daily report', { error });
      throw error;
    }
  }

  /**
   * Generate weekly report
   */
  async generateWeeklyReport(): Promise<{ text: string; recommendations: Recommendation[] }> {
    logger.info('Generating weekly report...');

    try {
      // 1. Fetch week's stats
      const weekStart = formatDate(getWeekStart());
      const yesterday = formatDate(getYesterday());
      const stats = await this.yandex.getStats(weekStart, yesterday);

      // 2. Save stats
      await this.saveStats(stats);

      // 3. Get previous week stats
      const prevWeekStart = formatDate(getDaysAgo(14));
      const prevWeekEnd = formatDate(getDaysAgo(8));
      const previousStats = await dailyStatsRepo.findAllByDateRange(prevWeekStart, prevWeekEnd);

      // 4. Prepare data
      const campaignData = await this.prepareCampaignData(stats, previousStats);

      // 5. Get analysis
      const analysis = await this.ai.analyze({
        data: campaignData,
        context: {
          goals: 'Максимизация конверсий при оптимальном CPA',
        },
        task: 'weekly_report',
      });

      // 6. Format and send
      const reportText = this.formatWeeklyReport(analysis, stats);

      await this.telegram.sendReport(reportText);

      logger.info('Weekly report generated and sent');

      return {
        text: reportText,
        recommendations: analysis.recommendations,
      };
    } catch (error) {
      logger.error('Failed to generate weekly report', { error });
      throw error;
    }
  }

  /**
   * Run evening analysis
   */
  async runEveningAnalysis(): Promise<void> {
    logger.info('Running evening analysis...');

    try {
      // Get today's stats so far
      const today = formatDate(new Date());
      const stats = await this.yandex.getStats(today, today);

      // Quick analysis
      const campaignData = await this.prepareCampaignData(stats, []);

      const analysis = await this.ai.analyze({
        data: campaignData,
        context: {},
        task: 'daily_report',
      });

      // Send brief update if there are important insights
      if (analysis.recommendations.length > 0) {
        const message = `🌙 *Вечерний анализ*\n\n${analysis.text}`;
        await this.telegram.sendToAdmin(message, { parse_mode: 'Markdown' });
      }

      logger.info('Evening analysis completed');
    } catch (error) {
      logger.error('Evening analysis failed', { error });
    }
  }

  /**
   * Sync Yandex data
   * @param mode - 'full' for 90 days history, 'recent' for 7 days (default)
   */
  async syncYandexData(mode: 'full' | 'recent' = 'recent'): Promise<void> {
    const historyDays = mode === 'full' ? 90 : 7;
    logger.info(`Syncing Yandex data (mode: ${mode}, days: ${historyDays})...`);

    try {
      // 1. Sync ALL campaigns (including inactive)
      const campaigns = await this.yandex.getCampaigns('all');

      for (const campaign of campaigns) {
        await campaignsRepo.upsertFromYandex(
          campaign.Id.toString(),
          campaign.Name,
          campaign.Status
        );
      }

      logger.info(`Synced ${campaigns.length} campaigns (all statuses)`);

      // 2. Sync stats for the specified period
      const startDate = formatDate(getDaysAgo(historyDays));
      const today = formatDate(new Date());
      const stats = await this.yandex.getStats(startDate, today);

      await this.saveStats(stats);

      logger.info(`Synced ${stats.length} stat records for ${historyDays} days`);
    } catch (error) {
      logger.error('Data sync failed', { error });
      throw error;
    }
  }

  /**
   * Handle user question with context
   * Returns either an answer string or a clarification request object
   */
  async handleUserQuestion(
    question: string,
    userId: string
  ): Promise<
    | string
    | {
        needsClarification: true;
        message: string;
        campaigns?: { id: string; name: string }[];
        proposals?: { id: string; title: string }[];
      }
  > {
    logger.info('Handling user question', { userId, question: question.substring(0, 50) });

    try {
      // 1. Classify the question
      const classification = await this.ai.classify(question);

      // 2. Detect context from classification
      const detectedContext = await this.context.detectContext(classification, userId);

      // 3. Check if clarification is needed
      if (detectedContext.needsClarification) {
        logger.info('Context clarification needed', { detectedContext });

        return {
          needsClarification: true,
          message: 'Уточните, о какой кампании или предложении идёт речь:',
          campaigns: detectedContext.suggestedCampaigns,
          proposals: detectedContext.suggestedProposals,
        };
      }

      // 4. Build full context
      const builtContext = await this.context.buildContextForQuestion(userId, detectedContext);

      // 4. Get or create conversation
      const conversation = await this.context.getOrCreateConversation(
        builtContext.campaignContext ? 'campaign_analysis' : 'general',
        builtContext.campaignContext?.campaignId
      );

      // 5. Save user message
      await this.context.addMessage(conversation.id, 'user', question);

      // 6. Get relevant campaign data
      const campaignData = await this.prepareContextData(builtContext, classification.campaign);

      // 7. Build AI context from built context
      const aiContext: AnalysisContext = {
        goals: builtContext.globalContext.goals,
        knowledgeBase: builtContext.globalContext.knowledgeBase.map((f) => f.fact),
        campaignHistory: builtContext.campaignContext?.history,
        previousRecommendations: builtContext.campaignContext?.previousRecommendations,
        conversationHistory: builtContext.conversationHistory.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };

      // 8. Get answer from AI
      const response = await this.ai.answerQuestion(question, campaignData, aiContext);

      // 9. Save assistant response
      await this.context.addMessage(conversation.id, 'assistant', response.answer);

      // 10. Update session with current conversation
      await this.context.updateSession(userId, {
        currentConversationId: conversation.id,
      });

      return response.answer;
    } catch (error) {
      logger.error('Failed to handle question', { error });
      throw error;
    }
  }

  /**
   * Create and propose an action
   */
  async proposeAction(
    campaignId: string,
    type: ActionType,
    data: any,
    reasoning: string
  ): Promise<void> {
    // 1. Create pending action
    const action = await this.actionManager.createAction(campaignId, type, data, reasoning);

    // 2. Format message
    const message =
      `⚠️ *Требуется действие*\n\n` +
      `📌 *Кампания:* ${campaignId}\n` + // Better to show name, but ID is faster for now
      `🔧 *Действие:* ${this.formatActionType(type)}\n` +
      `📝 *Детали:* ${JSON.stringify(data)}\n\n` +
      `🤖 *Причина:* ${reasoning}`;

    // 3. Send to Telegram
    // Assuming we send to admin. Ideally we should know which user context triggered this.
    // For MVP, sending to admin ID from config (telegram module handles this via ID)
    // But orchestrator doesn't know admin ID directly.
    // We'll trust telegram bot to send to configured admin.
    const chatId = process.env.TELEGRAM_ADMIN_ID;
    if (chatId) {
      const messageId = await this.telegram.sendActionConfirmation(chatId, action.id, message);

      // Update action with message ID for future reference
      await actionsRepo.updateMessageId(action.id, messageId);
    } else {
      logger.warn('No admin ID found to send action confirmation');
    }
  }

  private formatActionType(type: string): string {
    switch (type) {
      case ActionType.UPDATE_BID:
        return 'Изменение ставки';
      case ActionType.ADD_NEGATIVE_KEYWORD:
        return 'Добавление минус-слов';
      case ActionType.SUSPEND_CAMPAIGN:
        return 'Остановка кампании';
      case ActionType.RESUME_CAMPAIGN:
        return 'Запуск кампании';
      default:
        return type;
    }
  }

  /**
   * Execute approved action
   */
  async executeAction(actionId: string): Promise<void> {
    logger.info('Executing action', { actionId });

    try {
      await this.actionManager.executeAction(actionId);
      logger.info('Action executed', { actionId });
    } catch (error) {
      logger.error('Failed to execute action', { actionId, error });
      throw error;
    }
  }

  /**
   * Reject action
   */
  async rejectAction(actionId: string): Promise<void> {
    logger.info('Rejecting action', { actionId });
    await this.actionManager.rejectAction(actionId);
  }

  /**
   * Get campaigns list
   * @param filter - 'active' for active only, 'all' for all campaigns (default: 'all')
   */
  async getCampaigns(
    filter: 'active' | 'all' = 'all'
  ): Promise<{ id: string; name: string; status?: string }[]> {
    const campaigns =
      filter === 'active'
        ? await campaignsRepo.getActiveCampaigns()
        : await campaignsRepo.findAll();
    return campaigns.map((c) => ({
      id: c.yandex_id,
      name: c.name,
      status: c.status,
    }));
  }

  /**
   * Get proposals list
   */
  async getProposals(): Promise<{ id: string; title: string; status: string }[]> {
    return this.context.getActiveProposals();
  }

  /**
   * Set current campaign for user
   */
  async setCurrentCampaign(userId: string, campaignId: string): Promise<void> {
    await this.context.setCurrentCampaign(userId, campaignId);
  }

  /**
   * Set current proposal for user
   */
  async setCurrentProposal(userId: string, proposalId: string): Promise<void> {
    await this.context.setCurrentProposal(userId, proposalId);
  }

  /**
   * Clear current context for user
   */
  async clearCurrentContext(userId: string): Promise<void> {
    await this.context.clearCurrentContext(userId);
  }

  /**
   * Get current context for user
   */
  async getCurrentContext(userId: string): Promise<{
    campaign?: { id: string; name: string };
    proposal?: { id: string; title: string };
  }> {
    const session = await this.context.getSession(userId);
    const result: {
      campaign?: { id: string; name: string };
      proposal?: { id: string; title: string };
    } = {};

    if (session.currentCampaignId) {
      const campaignContext = await this.context.getCampaignContext(session.currentCampaignId);
      if (campaignContext) {
        result.campaign = {
          id: campaignContext.campaignId,
          name: campaignContext.campaignName,
        };
      }
    }

    if (session.currentProposalId) {
      const proposalContext = await this.context.getProposalContext(session.currentProposalId);
      if (proposalContext) {
        result.proposal = {
          id: proposalContext.proposalId,
          title: proposalContext.title,
        };
      }
    }

    return result;
  }

  /**
   * Get AI usage statistics formatted for display
   */
  getAIUsageStats(): string {
    return this.ai.formatUsageStats();
  }

  /**
   * Cleanup expired data
   */
  async cleanupExpiredData(): Promise<void> {
    logger.info('Cleaning up expired data...');

    await query('DELETE FROM raw_api_responses WHERE expires_at < NOW()');

    logger.info('Cleanup completed');
  }

  /**
   * Save stats to database
   */
  private async saveStats(stats: CampaignStats[]): Promise<void> {
    for (const stat of stats) {
      // Ensure campaign exists
      const campaign = await campaignsRepo.upsertFromYandex(
        stat.campaignId,
        stat.campaignName,
        'active'
      );

      // Save daily stat
      await dailyStatsRepo.upsert({
        campaign_id: campaign.id,
        stat_date: stat.date,
        impressions: stat.impressions,
        clicks: stat.clicks,
        cost: stat.cost,
        conversions: stat.conversions,
        ctr: stat.ctr,
      });
    }
  }

  /**
   * Prepare campaign data for AI analysis
   */
  private async prepareCampaignData(
    currentStats: CampaignStats[],
    previousStats: {
      campaign_id: string;
      impressions: number;
      clicks: number;
      cost: number;
      conversions: number;
      ctr: number | null;
    }[]
  ): Promise<CampaignData[]> {
    // Group stats by campaign
    const campaignMap = new Map<string, CampaignStats[]>();

    for (const stat of currentStats) {
      const existing = campaignMap.get(stat.campaignId) || [];
      existing.push(stat);
      campaignMap.set(stat.campaignId, existing);
    }

    // Build campaign data
    const result: CampaignData[] = [];

    for (const [campaignId, stats] of campaignMap) {
      const campaign = await campaignsRepo.findByYandexId(campaignId);

      // Find previous period stats for this campaign
      const prevStats = previousStats.filter((s) => s.campaign_id === campaign?.id);
      const prevTotals = prevStats.reduce(
        (acc, s) => ({
          impressions: acc.impressions + s.impressions,
          clicks: acc.clicks + s.clicks,
          cost: acc.cost + Number(s.cost),
          conversions: acc.conversions + s.conversions,
          ctr: 0,
        }),
        { impressions: 0, clicks: 0, cost: 0, conversions: 0, ctr: 0 }
      );

      if (prevTotals.impressions > 0) {
        prevTotals.ctr = (prevTotals.clicks / prevTotals.impressions) * 100;
      }

      result.push({
        campaignId,
        campaignName: stats[0]?.campaignName || campaign?.name || 'Unknown',
        stats: stats.map((s) => ({
          date: s.date,
          impressions: s.impressions,
          clicks: s.clicks,
          cost: s.cost,
          conversions: s.conversions,
          ctr: s.ctr,
          cpa: s.conversions > 0 ? s.cost / s.conversions : undefined,
        })),
        previousPeriodStats:
          prevTotals.impressions > 0
            ? {
                impressions: prevTotals.impressions,
                clicks: prevTotals.clicks,
                cost: prevTotals.cost,
                conversions: prevTotals.conversions,
                ctr: prevTotals.ctr,
                cpa:
                  prevTotals.conversions > 0 ? prevTotals.cost / prevTotals.conversions : undefined,
              }
            : undefined,
      });
    }

    return result;
  }

  /**
   * Prepare campaign data for user question context
   */
  private async prepareContextData(
    builtContext: BuiltContext,
    classificationCampaign?: string
  ): Promise<CampaignData[]> {
    const campaignData: CampaignData[] = [];

    if (builtContext.campaignContext) {
      // Get specific campaign data
      const campaign = await campaignsRepo.findByYandexId(builtContext.campaignContext.campaignId);
      if (campaign) {
        const weekAgo = formatDate(getDaysAgo(7));
        const today = formatDate(new Date());
        const stats = await dailyStatsRepo.findByCampaignDateRange(campaign.id, weekAgo, today);

        campaignData.push({
          campaignId: campaign.yandex_id,
          campaignName: campaign.name,
          stats: stats.map((s) => ({
            date: formatDate(s.stat_date),
            impressions: s.impressions,
            clicks: s.clicks,
            cost: Number(s.cost),
            conversions: s.conversions,
            ctr: Number(s.ctr) || 0,
            cpa: s.cpa ? Number(s.cpa) : undefined,
          })),
        });
      }
    } else if (classificationCampaign) {
      // Try to find campaign from classification
      const campaign = await campaignsRepo.findByYandexId(classificationCampaign);
      if (campaign) {
        const weekAgo = formatDate(getDaysAgo(7));
        const today = formatDate(new Date());
        const stats = await dailyStatsRepo.findByCampaignDateRange(campaign.id, weekAgo, today);

        campaignData.push({
          campaignId: campaign.yandex_id,
          campaignName: campaign.name,
          stats: stats.map((s) => ({
            date: formatDate(s.stat_date),
            impressions: s.impressions,
            clicks: s.clicks,
            cost: Number(s.cost),
            conversions: s.conversions,
            ctr: Number(s.ctr) || 0,
            cpa: s.cpa ? Number(s.cpa) : undefined,
          })),
        });
      }
    } else {
      // Get all campaigns data
      const campaigns = await campaignsRepo.getActiveCampaigns();
      const weekAgo = formatDate(getDaysAgo(7));
      const today = formatDate(new Date());

      for (const campaign of campaigns) {
        const stats = await dailyStatsRepo.findByCampaignDateRange(campaign.id, weekAgo, today);

        campaignData.push({
          campaignId: campaign.yandex_id,
          campaignName: campaign.name,
          stats: stats.map((s) => ({
            date: formatDate(s.stat_date),
            impressions: s.impressions,
            clicks: s.clicks,
            cost: Number(s.cost),
            conversions: s.conversions,
            ctr: Number(s.ctr) || 0,
            cpa: s.cpa ? Number(s.cpa) : undefined,
          })),
        });
      }
    }

    return campaignData;
  }

  /**
   * Format daily report text
   */
  private formatDailyReport(analysis: AnalysisResponse, stats: CampaignStats[]): string {
    const totals = stats.reduce(
      (acc, s) => ({
        impressions: acc.impressions + s.impressions,
        clicks: acc.clicks + s.clicks,
        cost: acc.cost + s.cost,
        conversions: acc.conversions + s.conversions,
      }),
      { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    );

    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const cpa = totals.conversions > 0 ? totals.cost / totals.conversions : 0;

    return `📊 *Отчёт за вчера*

*Общие показатели:*
• Показы: ${totals.impressions.toLocaleString('ru-RU')}
• Клики: ${totals.clicks.toLocaleString('ru-RU')}
• CTR: ${ctr.toFixed(2)}%
• Расход: ${totals.cost.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}
• Конверсии: ${totals.conversions}
• CPA: ${cpa > 0 ? cpa.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' }) : 'N/A'}

*Анализ:*
${analysis.text}

${analysis.insights && analysis.insights.length > 0 ? `*Инсайты:*\n${analysis.insights.map((i) => `• ${i}`).join('\n')}` : ''}`;
  }

  /**
   * Format weekly report text
   */
  private formatWeeklyReport(analysis: AnalysisResponse, stats: CampaignStats[]): string {
    const totals = stats.reduce(
      (acc, s) => ({
        impressions: acc.impressions + s.impressions,
        clicks: acc.clicks + s.clicks,
        cost: acc.cost + s.cost,
        conversions: acc.conversions + s.conversions,
      }),
      { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    );

    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const cpa = totals.conversions > 0 ? totals.cost / totals.conversions : 0;

    return `📈 *Недельный отчёт*

*Итоги недели:*
• Показы: ${totals.impressions.toLocaleString('ru-RU')}
• Клики: ${totals.clicks.toLocaleString('ru-RU')}
• CTR: ${ctr.toFixed(2)}%
• Расход: ${totals.cost.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}
• Конверсии: ${totals.conversions}
• CPA: ${cpa > 0 ? cpa.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' }) : 'N/A'}

*Анализ:*
${analysis.text}

${analysis.summary ? `*Резюме:*\n${analysis.summary}` : ''}`;
  }
}

export default Orchestrator;
