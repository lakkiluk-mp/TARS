import { Worker } from 'bullmq';
import { redisConfig } from './redis';
import { QueueName, JobData, GenerateReportJobData, HandleUserQuestionJobData } from './types';
import { Orchestrator } from '../orchestrator';
import { TelegramBot } from '../telegram';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('queue-workers');

export const initWorkers = (orchestrator: Orchestrator, telegramBot: TelegramBot) => {
  // Worker for Reports
  new Worker<GenerateReportJobData>(
    QueueName.REPORTS,
    async (job) => {
      logger.info('Processing report job', { id: job.id, type: job.data.type });
      try {
        if (job.data.type === 'daily') {
          // generateDailyReport returns { text: string, recommendations: ... }
          // We pass sendToTelegram=false because we handle sending here or let orchestrator do it?
          // Actually, orchestrator.generateDailyReport(true) sends it directly.
          // But to be safe and consistent, we might want to get result and send manually.
          // Let's rely on orchestrator for now, or adapt it.
          // Looking at handlers.ts: orchestrator.generateDailyReport(false) then ctx.reply.
          // So we should do the same.

          const report = await orchestrator.generateDailyReport(false);
          await telegramBot.sendMessage(job.data.chatId, report.text, { parse_mode: 'Markdown' });

          // Send recommendations
          if (report.recommendations && report.recommendations.length > 0) {
            const { createRecommendationKeyboard } = await import('../telegram/keyboards');

            for (const rec of report.recommendations as any[]) {
              await telegramBot.sendMessage(
                job.data.chatId,
                `💡 *${rec.title}*\n\n${rec.description}`,
                {
                  parse_mode: 'Markdown',
                  reply_markup: createRecommendationKeyboard(rec.id),
                }
              );
            }
          }
        } else if (job.data.type === 'weekly') {
          const report = await orchestrator.generateWeeklyReport(false);
          await telegramBot.sendMessage(job.data.chatId, report.text, { parse_mode: 'Markdown' });
        }
      } catch (error) {
        logger.error('Failed to process report job', { error, jobId: job.id });
        await telegramBot.sendMessage(job.data.chatId, '❌ Ошибка при генерации отчета.');
        throw error;
      }
    },
    { connection: redisConfig }
  );

  // Worker for Messages and Campaigns
  new Worker<HandleUserQuestionJobData | any>( // TODO: Fix typing
    QueueName.MESSAGES,
    async (job) => {
      logger.info('Processing message job', { id: job.id, type: job.name });

      try {
        if (job.name === 'create_campaign') {
          const data = job.data as any; // Cast for now
          // generateCampaignProposal logic
          const result = await orchestrator.generateCampaignProposal(data.description, data.userId);
          // We need to send the result back.
          // Looking at handlers.ts: it sends a structured message and keyboard.
          // We need access to 'createProposalActionKeyboard'.

          // Dynamic import to avoid circular dependency if possible, or assume it's available
          const { createProposalActionKeyboard } = await import('../telegram/keyboards');

          const content = result.content;
          let message = `✅ *Предложение создано: ${result.title}*\n\n`;
          message += `📝 *Описание:* ${content.description}\n\n`;
          message += `🎯 *Стратегия:* ${content.campaignStructure?.strategy?.name || 'N/A'}\n`;
          message += `💰 *Бюджет:* ${content.campaignStructure?.strategy?.budget || 'N/A'}\n\n`;
          message += `📊 *Прогноз:* Клики: ${content.estimatedResults?.clicks}, CPA: ${content.estimatedResults?.cpa}\n\n`;

          if (content.questions && content.questions.length > 0) {
            message += `❓ *Вопросы:*\n${content.questions.map((q: string) => `• ${q}`).join('\n')}\n\n`;
          }

          message += `Контекст переключён на это предложение. Вы можете обсуждать его и вносить правки.`;

          await telegramBot.sendMessage(data.chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: createProposalActionKeyboard(result.proposalId),
          });
        } else {
          // Standard question handling
          const data = job.data as HandleUserQuestionJobData;
          const result = await orchestrator.handleUserQuestion(data.question, data.userId);

          if (typeof result === 'object' && result.needsClarification) {
            const { createCampaignClarificationKeyboard, createProposalClarificationKeyboard } =
              await import('../telegram/keyboards');

            if (result.campaigns && result.campaigns.length > 0) {
              await telegramBot.sendMessage(data.chatId, result.message, {
                parse_mode: 'Markdown',
                reply_markup: createCampaignClarificationKeyboard(result.campaigns),
              });
            } else if (result.proposals && result.proposals.length > 0) {
              await telegramBot.sendMessage(data.chatId, result.message, {
                parse_mode: 'Markdown',
                reply_markup: createProposalClarificationKeyboard(result.proposals),
              });
            } else {
              await telegramBot.sendMessage(
                data.chatId,
                '❓ Не удалось определить контекст. Используйте /campaign или /proposal для выбора.'
              );
            }
          } else {
            await telegramBot.sendMessage(data.chatId, result as string, {
              parse_mode: 'Markdown',
            });
          }
        }
      } catch (error) {
        logger.error('Failed to process message job', { error, jobId: job.id });
        await telegramBot.sendMessage(job.data.chatId, '❌ Ошибка при обработке сообщения.');
        throw error;
      }
    },
    { connection: redisConfig }
  );

  logger.info('Workers initialized');
};
