import { createModuleLogger } from '../../utils/logger';
import {
  formatDate,
  getYesterday,
  getDaysAgo,
  getWeekStart,
  escapeMarkdown,
} from '../../utils/helpers';
import { YandexDirectClient, CampaignStats } from '../yandex';
import { AIEngine, AnalysisResponse, CampaignData, Recommendation, AnalysisContext } from '../ai';
import { TelegramBot } from '../telegram';
import { ContextManager, BuiltContext, ContextLoader } from '../context';
import {
  campaignsRepo,
  dailyStatsRepo,
  proposalsRepo,
  keywordsRepo,
  searchQueriesRepo,
} from '../../database/repositories';
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
   * @param sendToTelegram - Whether to send the report to Telegram immediately (default: true)
   */
  async generateDailyReport(
    sendToTelegram = true
  ): Promise<{ text: string; recommendations: Recommendation[] }> {
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

          // Save queries to DB
          const dbCampaign = await campaignsRepo.findByYandexId(campaign.campaignId);
          if (dbCampaign) {
            for (const q of queries) {
              await searchQueriesRepo.upsert({
                campaign_id: dbCampaign.id,
                query: q.query,
                impressions: q.impressions,
                clicks: q.clicks,
                cost: q.cost,
                query_date: q.date,
              });
            }
          }

          // Process queries for AI analysis
          // 1. Top Performing (Conversions > 0, sorted by Conversions desc, then Cost desc)
          // Since getSearchQueries from client might not return conversions yet (needs update in client.ts if report supports it),
          // we might rely on clicks/ctr for now if conversions are missing in report fields.
          // Let's check YandexDirectClient.getSearchQueries.
          // It fetches 'Query', 'CampaignId', 'Impressions', 'Clicks', 'Cost', 'Date'.
          // We need to add 'Conversions' to the report request in YandexDirectClient!

          // Assuming we update client to fetch Conversions, or we use Clicks as proxy for now.
          // Let's update client first (next step).

          campaign.searchQueries = queries
            .filter((q) => q.cost > MIN_QUERY_COST || q.clicks > MIN_QUERY_CLICKS)
            .sort((a, b) => b.cost - a.cost)
            .slice(0, MAX_QUERIES_FOR_AI);

          // Identify wasteful queries (High Cost, 0 Conversions - using Clicks/Cost as proxy if conv missing)
          // "Wasteful" = Cost > 200 RUB (example) and Clicks > 5.
          campaign.wastefulQueries = queries
            .filter((q) => q.cost > 100 && (!q.conversions || q.conversions === 0))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 5)
            .map((q) => ({
              query: q.query,
              clicks: q.clicks,
              cost: q.cost,
            }));

          // Identify top performing (High Clicks/CTR)
          campaign.topPerformingQueries = queries
            .filter((q) => q.clicks > 0)
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 5)
            .map((q) => ({
              query: q.query,
              clicks: q.clicks,
              cost: q.cost,
              conversions: q.conversions || 0,
              cpa: q.conversions && q.conversions > 0 ? q.cost / q.conversions : 0,
            }));
        } catch (e) {
          logger.warn(`Failed to fetch queries for campaign ${campaign.campaignId}`, { error: e });
        }

        // Add campaign settings if we can find them in DB
        const dbCampaign = await campaignsRepo.findByYandexId(campaign.campaignId);
        if (dbCampaign && dbCampaign.settings) {
          const settings = dbCampaign.settings as any;
          // Extract strategy and budget
          let strategy = 'Unknown';
          let budget = 0;
          let budgetMode = 'Unknown';

          if (settings.TextCampaign && settings.TextCampaign.BiddingStrategy) {
            const bs = settings.TextCampaign.BiddingStrategy;
            strategy =
              bs.Search?.BiddingStrategyType || bs.Network?.BiddingStrategyType || 'Unknown';
          }

          if (settings.DailyBudget) {
            budget = settings.DailyBudget.Amount ? settings.DailyBudget.Amount / 1000000 : 0;
            budgetMode = settings.DailyBudget.Mode;
          }

          const bidModifiers = settings.BidModifiers || [];
          const timeTargeting = settings.TimeTargeting;

          campaign.settings = {
            strategy,
            budget,
            budgetMode,
            bidModifiers, // Now we have them
            timeTargeting, // Now we have them
          };
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

      // 6. Propose actions from AI recommendations (Only if sending to Telegram automatically)
      if (sendToTelegram) {
        for (const rec of analysis.recommendations) {
          if (rec.action) {
            const campaignIds = (rec.action.campaignId || campaignData[0]?.campaignId || '').split(
              ','
            );

            for (const campaignId of campaignIds) {
              const trimmedId = campaignId.trim();
              if (!trimmedId) continue;

              if (Object.values(ActionType).includes(rec.action.type as ActionType)) {
                // Find internal campaign ID (UUID) from Yandex ID
                const dbCampaign = await campaignsRepo.findByYandexId(trimmedId);
                if (dbCampaign) {
                  await this.proposeAction(
                    dbCampaign.id, // Use UUID
                    rec.action.type as ActionType,
                    rec.action.params,
                    rec.reasoning
                  );
                } else {
                  logger.warn(`Campaign not found for action: ${trimmedId}`);
                }
              }
            }
          }
        }
      }

      // 7. Format and send report
      const reportText = this.formatDailyReport(analysis, stats);

      if (sendToTelegram) {
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
      } else {
        logger.info('Daily report generated (not sent)');
      }

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
   * @param sendToTelegram - Whether to send the report to Telegram immediately (default: true)
   */
  async generateWeeklyReport(
    sendToTelegram = true
  ): Promise<{ text: string; recommendations: Recommendation[] }> {
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

      // Save weekly learning to file
      const loader = new ContextLoader();
      await loader.saveLearning(analysis.text, 'weekly');

      // 6. Format and send
      const reportText = this.formatWeeklyReport(analysis, stats);

      if (sendToTelegram) {
        await this.telegram.sendReport(reportText);
        logger.info('Weekly report generated and sent');
      } else {
        logger.info('Weekly report generated (not sent)');
      }

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
        // Extract relevant settings to store in JSONB
        const settings: Record<string, any> = {
          StartDate: campaign.StartDate,
          EndDate: campaign.EndDate,
          DailyBudget: campaign.DailyBudget,
          Type: campaign.Type,
          TimeTargeting: campaign.TimeTargeting, // Added TimeTargeting
          // Store TextCampaign settings (Strategy, Goals, etc.) if available
          TextCampaign: campaign.TextCampaign,
        };

        // Fetch Bid Modifiers
        try {
          const bidModifiers = await this.yandex.getBidModifiers(campaign.Id.toString());
          settings.BidModifiers = bidModifiers;
        } catch (e) {
          logger.warn(`Failed to fetch bid modifiers for campaign ${campaign.Id}`, { error: e });
        }

        await campaignsRepo.upsertFromYandex(
          campaign.Id.toString(),
          campaign.Name,
          campaign.Status,
          settings
        );

        // Sync keywords for active campaigns
        // This makes sure 'keywords' table is populated
        if (campaign.Status === 'ACCEPTED' || campaign.Status === 'MODERATION') {
          try {
            const dbCampaign = await campaignsRepo.findByYandexId(campaign.Id.toString());
            if (dbCampaign) {
              const keywords = await this.yandex.getKeywords(campaign.Id.toString());
              for (const kw of keywords) {
                await keywordsRepo.upsert({
                  campaign_id: dbCampaign.id,
                  keyword: kw.Keyword,
                  match_type: 'phrase', // Default or parse from keyword text if needed
                  bid: kw.Bid ? kw.Bid / 1000000 : undefined, // Convert micros if fetched as micros, but getKeywords returns AuctionBids?
                  // Wait, getKeywords returns Bid in micros?
                  // YandexDirectClient.getKeywords maps response.
                  // Let's check YandexDirectClient.getKeywords implementation.
                  // It returns Fields: Id, Keyword, Bid, ContextBid...
                  // Bid in API v5 is usually micros.
                  // But let's check parsing. Client uses `response.data.result`.
                  // It doesn't transform values. So it is micros.
                  // Update: YandexKeyword interface says 'Bid: number'.
                  // Let's assume micros and divide by 1000000.
                  status: kw.Status,
                  stats: {
                    State: kw.State,
                    ServingStatus: kw.ServingStatus,
                  },
                });
              }
              logger.info(`Synced ${keywords.length} keywords for campaign ${campaign.Id}`);
            }
          } catch (e) {
            logger.warn(`Failed to sync keywords for campaign ${campaign.Id}`, { error: e });
          }
        }
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
   * Generate campaign proposal based on user request
   */
  async generateCampaignProposal(
    userRequest: string,
    userId: string
  ): Promise<{ proposalId: string; title: string; content: any }> {
    logger.info('Generating campaign proposal', { userId, request: userRequest.substring(0, 50) });

    try {
      // 1. Get user session to maintain continuity if needed, but for new proposal we usually start fresh context or use global
      const session = await this.context.getSession(userId);

      // 2. Get global context (goals, best practices)
      const globalContext = await this.context.getGlobalContext();

      // 3. Prepare context for AI
      // We might want to include conversation history if the user was discussing this idea previously
      let conversationHistory: any[] = [];
      if (session.currentConversationId) {
        const msgs = await this.context.getConversationMessages(session.currentConversationId);
        conversationHistory = msgs.slice(-5); // Last 5 messages for context
      }

      const aiContext: AnalysisContext = {
        goals: globalContext.goals,
        knowledgeBase: globalContext.knowledgeBase.map((f) => f.fact),
        conversationHistory: conversationHistory.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        // We don't need campaign history for a NEW campaign proposal usually
      };

      // 4. Generate proposal structure via AI
      const proposalContent = await this.ai.generateProposal(userRequest, aiContext);

      // 5. Create conversation for this proposal
      const conversation = await this.context.getOrCreateConversation('proposal');

      // 6. Save proposal to DB
      const proposal = await proposalsRepo.create({
        title: proposalContent.title || 'Новая кампания',
        status: 'draft',
        instruction_file: JSON.stringify(proposalContent, null, 2),
        reasoning: proposalContent.reasoning,
        conversation_id: conversation.id,
      });

      // 7. Update conversation with proposal ID
      await query('UPDATE conversations SET proposal_id = $1 WHERE id = $2', [
        proposal.id,
        conversation.id,
      ]);

      // 8. Add initial messages to conversation
      await this.context.addMessage(conversation.id, 'user', userRequest);
      await this.context.addMessage(
        conversation.id,
        'assistant',
        `Я подготовил предложение "${proposal.title}".\n\n${proposalContent.description}`
      );

      // 9. Update user session to focus on this proposal
      await this.context.setCurrentProposal(userId, proposal.id);

      return {
        proposalId: proposal.id,
        title: proposal.title,
        content: proposalContent,
      };
    } catch (error) {
      logger.error('Failed to generate proposal', { error });
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

    // Get campaign name for display
    let campaignName = campaignId;
    try {
      const campaign = await campaignsRepo.findById(campaignId);
      if (campaign) {
        campaignName = campaign.name;
      }
    } catch (e) {
      // Ignore
    }

    // Format data nicely
    let formattedData = '';
    if (data.keywords)
      formattedData += `Ключевые слова: ${Array.isArray(data.keywords) ? data.keywords.join(', ') : data.keywords}\n`;
    if (data.newBid) formattedData += `Новая ставка: ${data.newBid} ₽\n`;
    if (data.amount) formattedData += `Сумма: ${data.amount} ₽\n`;
    if (data.status) formattedData += `Статус: ${data.status}\n`;
    if (!formattedData) formattedData = JSON.stringify(data);

    // 2. Format message
    const message =
      `⚠️ *Требуется действие*\n\n` +
      `📌 *Кампания:* ${campaignName}\n` +
      `🔧 *Действие:* ${this.formatActionType(type)}\n` +
      `📝 *Детали:*\n${formattedData}\n` +
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
      case ActionType.UPDATE_DAILY_BUDGET:
        return 'Изменение дневного бюджета';
      case ActionType.UPDATE_WEEKLY_BUDGET:
        return 'Изменение недельного бюджета';
      case ActionType.UPDATE_AD:
        return 'Изменение объявления';
      case ActionType.SUSPEND_AD:
        return 'Остановка объявления';
      case ActionType.RESUME_AD:
        return 'Запуск объявления';
      case ActionType.ARCHIVE_AD:
        return 'Архивация объявления';
      case ActionType.UPDATE_SCHEDULE:
        return 'Изменение расписания показов';
      case ActionType.UPDATE_BID_MODIFIER:
        return 'Изменение корректировок ставок (пол/возраст/устройства)';
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
      // Get action details before execution for logging
      const action = await actionsRepo.findById(actionId);

      await this.actionManager.executeAction(actionId);
      logger.info('Action executed', { actionId });

      // Save decision to experiments log
      if (action) {
        const loader = new ContextLoader();
        await loader.saveExperiment(
          `Выполнено действие: **${action.action_type}**\n\nПараметры:\n\`\`\`json\n${JSON.stringify(action.action_data, null, 2)}\n\`\`\``,
          `Причина: ${action.ai_reasoning || 'Не указана'}\nКампания: ${action.campaign_id}`
        );
      }
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
   * Approve proposal and start implementation
   */
  async approveProposal(proposalId: string): Promise<void> {
    logger.info('Approving proposal', { proposalId });

    try {
      // 1. Get proposal
      const proposal = await proposalsRepo.getById(proposalId);
      if (!proposal) {
        throw new Error('Proposal not found');
      }

      if (proposal.status !== 'draft' && proposal.status !== 'discussing') {
        throw new Error(`Proposal is in ${proposal.status} state`);
      }

      // 2. Parse instruction file
      const instructions = JSON.parse(proposal.instruction_file || '{}');

      // 3. Create campaign via Yandex API
      // Map instructions to Yandex API calls
      // instructions.campaignStructure contains the data
      const structure = instructions.campaignStructure;

      if (!structure || !structure.strategy) {
        throw new Error('Invalid proposal structure: missing strategy');
      }

      // Determine strategy type for API
      // Mapping from our internal simplified types to Yandex types
      let strategyType:
        | 'WB_MAXIMUM_CLICKS'
        | 'WB_MAXIMUM_CONVERSION_RATE'
        | 'AVERAGE_CPA'
        | 'AVERAGE_ROI'
        | 'WEEKLY_CLICK_PACKAGE'
        | 'MANUAL_CPM' = 'WB_MAXIMUM_CLICKS';

      const stratName = structure.strategy.name?.toLowerCase() || '';
      if (stratName.includes('cpa')) strategyType = 'AVERAGE_CPA';
      else if (stratName.includes('roi')) strategyType = 'AVERAGE_ROI';
      else if (stratName.includes('conversion')) strategyType = 'WB_MAXIMUM_CONVERSION_RATE';
      else if (stratName.includes('manual')) strategyType = 'MANUAL_CPM'; // Or manual search, but Yandex API v5 often uses strategies even for manual

      // Parse budget
      const budget = parseFloat(structure.strategy.budget) || 1000; // Default 1000 rub

      const yandexCampaignId = await this.yandex.createCampaign(
        proposal.title,
        new Date().toISOString().split('T')[0], // Start today
        budget / 7, // Daily budget approx
        strategyType
      );

      // 4. Create campaign in local DB immediately
      await campaignsRepo.upsertFromYandex(
        yandexCampaignId,
        proposal.title,
        'active', // Assuming it's created as active/draft but we track it
        { generated_from_proposal: proposal.id }
      );

      // 5. Update proposal status
      await proposalsRepo.update(proposal.id, {
        status: 'implemented', // Changed from 'approved' to 'implemented' to signify it's done
      });

      // 5. Log the decision
      const loader = new ContextLoader();
      await loader.saveExperiment(
        `Утверждено предложение: **${proposal.title}**\n\nСтруктура:\n\`\`\`json\n${JSON.stringify(instructions.campaignStructure, null, 2)}\n\`\`\``,
        `Причина: ${proposal.reasoning}\nПредложение: ${proposal.id}`
      );

      logger.info('Proposal approved and processed', { proposalId, yandexCampaignId });
    } catch (error) {
      logger.error('Failed to approve proposal', { proposalId, error });
      throw error;
    }
  }

  /**
   * Reject proposal
   */
  async rejectProposal(proposalId: string): Promise<void> {
    logger.info('Rejecting proposal', { proposalId });

    try {
      await proposalsRepo.update(proposalId, {
        status: 'rejected',
      });

      logger.info('Proposal rejected', { proposalId });
    } catch (error) {
      logger.error('Failed to reject proposal', { proposalId, error });
      throw error;
    }
  }

  /**
   * Explain action
   */
  async explainAction(actionId: string): Promise<string> {
    logger.info('Explaining action', { actionId });
    const action = await actionsRepo.findById(actionId);
    if (!action) {
      return 'Действие не найдено или уже удалено.';
    }
    return action.ai_reasoning || 'К сожалению, объяснение для этого действия отсутствует.';
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
   * Clear current context for user
   */
  async clearCurrentContext(userId: string): Promise<void> {
    await this.archiveCurrentConversation(userId);
    await this.context.clearCurrentContext(userId);
  }

  /**
   * Set current campaign for user
   */
  async setCurrentCampaign(userId: string, campaignId: string): Promise<void> {
    await this.archiveCurrentConversation(userId);
    await this.context.setCurrentCampaign(userId, campaignId);
  }

  /**
   * Set current proposal for user
   */
  async setCurrentProposal(userId: string, proposalId: string): Promise<void> {
    await this.archiveCurrentConversation(userId);
    await this.context.setCurrentProposal(userId, proposalId);
  }

  /**
   * Archive and summarize current conversation if needed
   */
  private async archiveCurrentConversation(userId: string): Promise<void> {
    try {
      const session = await this.context.getSession(userId);
      if (!session.currentConversationId) return;

      const messages = await this.context.getConversationMessages(session.currentConversationId);

      // Don't summarize empty or very short conversations
      if (messages.length < 2) return;

      logger.info('Archiving and summarizing conversation', {
        conversationId: session.currentConversationId,
        messageCount: messages.length,
      });

      const summary = await this.ai.summarizeConversation(
        messages.map((m) => ({ role: m.role, content: m.content }))
      );

      // Save summary
      await this.context.finalizeConversation(session.currentConversationId, summary.summary);

      // Save extracted knowledge facts
      if (summary.keyFacts && summary.keyFacts.length > 0) {
        for (const fact of summary.keyFacts) {
          await this.context.addKnowledge(
            fact,
            `conversation/${session.currentConversationId}`,
            session.currentCampaignId
          );
        }
        logger.info(`Extracted ${summary.keyFacts.length} facts from conversation`);
      }

      // Save summary to auto-insights file
      const loader = new ContextLoader();
      await loader.saveLearning(
        `### Диалог (ID: ${session.currentConversationId.substring(0, 8)})\n\n**Тема:** ${summary.topic}\n\n**Резюме:** ${summary.summary}\n\n**Выводы:**\n${(summary.decisions || []).map((d) => `- ${d}`).join('\n')}`,
        'auto',
        `conversation/${session.currentConversationId}`
      );
    } catch (error) {
      logger.error('Failed to archive conversation', { error, userId });
      // Don't block the flow if summarization fails
    }
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
${escapeMarkdown(analysis.text)}

${analysis.insights && analysis.insights.length > 0 ? `*Инсайты:*\n${analysis.insights.map((i) => `• ${escapeMarkdown(i)}`).join('\n')}` : ''}

${analysis.recommendations && analysis.recommendations.length > 0 ? `*Рекомендации:*\n${analysis.recommendations.map((r) => `💡 *${escapeMarkdown(r.title)}*\n${escapeMarkdown(r.description)}`).join('\n\n')}` : ''}`;
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
${escapeMarkdown(analysis.text)}

${analysis.summary ? `*Резюме:*\n${escapeMarkdown(analysis.summary)}` : ''}`;
  }
}

export default Orchestrator;
