import { Worker, Job } from 'bullmq';
import { redisConfig } from './redis';
import { QueueName, GenerateReportJobData, MessageJobData } from './types';
import { Orchestrator } from '../orchestrator';
import { TelegramBot } from '../telegram';
import { createModuleLogger } from '../../utils/logger';
import {
  createRecommendationKeyboard,
  createProposalActionKeyboard,
  createCampaignClarificationKeyboard,
  createProposalClarificationKeyboard,
} from '../telegram/keyboards';

const logger = createModuleLogger('queue-workers');

export const initWorkers = (orchestrator: Orchestrator, telegramBot: TelegramBot) => {
  // Worker for Reports
  new Worker<GenerateReportJobData>(
    QueueName.REPORTS,
    async (job) => {
      logger.info('Processing report job', { id: job.id, type: job.data.type });
      try {
        if (job.data.type === 'daily') {
          const report = await orchestrator.generateDailyReport(false);
          await telegramBot.sendMessage(job.data.chatId, report.text, { parse_mode: 'Markdown' });

          // Send recommendations
          if (report.recommendations && report.recommendations.length > 0) {
            for (const rec of report.recommendations) {
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
  new Worker<MessageJobData>(
    QueueName.MESSAGES,
    async (job: Job<MessageJobData>) => {
      logger.info('Processing message job', { id: job.id, type: job.name });

      try {
        if (job.name === 'create_campaign') {
          // Type guard check (runtime check + casting if needed, but discrimination works better)
          // Since job.name is passed when adding job, we trust it matches the data structure for now
          // But TypeScript doesn't know relationship between job.name and job.data type automatically in generic Worker
          // So we cast to specific type
          const data = job.data as Extract<MessageJobData, { type: 'create_campaign' }>;

          // generateCampaignProposal logic
          const result = await orchestrator.generateCampaignProposal(data.description, data.userId);

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
        } else if (job.name === 'user_question' || job.name === 'user_message') {
          const data = job.data as Extract<MessageJobData, { type: 'user_question' }>;
          const result = await orchestrator.handleUserQuestion(data.question, data.userId);

          if (typeof result === 'object' && result.needsClarification) {
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
