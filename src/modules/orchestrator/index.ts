import { createModuleLogger } from '../../utils/logger';
import { formatDate, getYesterday, getDaysAgo, getWeekStart } from '../../utils/helpers';
import { YandexDirectClient, CampaignStats } from '../yandex';
import { AIEngine, AnalysisResponse, CampaignData, Recommendation } from '../ai';
import { TelegramBot } from '../telegram';
import { campaignsRepo, dailyStatsRepo } from '../../database/repositories';
import { query } from '../../database/client';

const logger = createModuleLogger('orchestrator');

export interface OrchestratorConfig {
  debugMode?: boolean;
}

export class Orchestrator {
  private yandex: YandexDirectClient;
  private ai: AIEngine;
  private telegram: TelegramBot;
  private config: OrchestratorConfig;

  constructor(
    yandex: YandexDirectClient,
    ai: AIEngine,
    telegram: TelegramBot,
    config: OrchestratorConfig = {}
  ) {
    this.yandex = yandex;
    this.ai = ai;
    this.telegram = telegram;
    this.config = config;

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

      // 5. Get analysis from AI
      const analysis = await this.ai.analyze({
        data: campaignData,
        context: {
          goals: 'Максимизация конверсий при оптимальном CPA',
        },
        task: 'daily_report',
      });

      // 6. Format and send report
      const reportText = this.formatDailyReport(analysis, stats);

      await this.telegram.sendReport(reportText, analysis.recommendations as { id: string; title: string; description: string }[]);

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
   */
  async syncYandexData(): Promise<void> {
    logger.info('Syncing Yandex data...');

    try {
      // 1. Sync campaigns
      const campaigns = await this.yandex.getCampaigns();

      for (const campaign of campaigns) {
        await campaignsRepo.upsertFromYandex(
          campaign.Id.toString(),
          campaign.Name,
          campaign.Status
        );
      }

      logger.info(`Synced ${campaigns.length} campaigns`);

      // 2. Sync recent stats (last 7 days)
      const weekAgo = formatDate(getDaysAgo(7));
      const today = formatDate(new Date());
      const stats = await this.yandex.getStats(weekAgo, today);

      await this.saveStats(stats);

      logger.info(`Synced ${stats.length} stat records`);
    } catch (error) {
      logger.error('Data sync failed', { error });
      throw error;
    }
  }

  /**
   * Handle user question
   */
  async handleUserQuestion(question: string, userId: string): Promise<string> {
    logger.info('Handling user question', { userId, question: question.substring(0, 50) });

    try {
      // 1. Classify the question
      const classification = await this.ai.classify(question);

      // 2. Get relevant data
      let campaignData: CampaignData[] = [];

      if (classification.campaign) {
        // Get specific campaign data
        const campaign = await campaignsRepo.findByYandexId(classification.campaign);
        if (campaign) {
          const weekAgo = formatDate(getDaysAgo(7));
          const today = formatDate(new Date());
          const stats = await dailyStatsRepo.findByCampaignDateRange(campaign.id, weekAgo, today);

          campaignData = [
            {
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
            },
          ];
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

      // 3. Get answer from AI
      const response = await this.ai.answerQuestion(question, campaignData, {});

      return response.answer;
    } catch (error) {
      logger.error('Failed to handle question', { error });
      throw error;
    }
  }

  /**
   * Execute approved action
   */
  async executeAction(actionId: string): Promise<void> {
    logger.info('Executing action', { actionId });

    // TODO: Implement action execution
    // 1. Get action from database
    // 2. Execute via Yandex API
    // 3. Log result

    logger.info('Action executed', { actionId });
  }

  /**
   * Get campaigns list
   */
  async getCampaigns(): Promise<{ id: string; name: string }[]> {
    const campaigns = await campaignsRepo.findAll();
    return campaigns.map((c) => ({
      id: c.yandex_id,
      name: c.name,
    }));
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
    previousStats: { campaign_id: string; impressions: number; clicks: number; cost: number; conversions: number; ctr: number | null }[]
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
                cpa: prevTotals.conversions > 0 ? prevTotals.cost / prevTotals.conversions : undefined,
              }
            : undefined,
      });
    }

    return result;
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
