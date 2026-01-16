import cron, { ScheduledTask } from 'node-cron';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('scheduler');

// Orchestrator interface
export interface SchedulerOrchestrator {
  generateDailyReport(): Promise<void>;
  runEveningAnalysis(): Promise<void>;
  generateWeeklyReport(): Promise<void>;
  syncYandexData(): Promise<void>;
  cleanupExpiredData(): Promise<void>;
}

// Database interface
export interface SchedulerDatabase {
  cleanupExpiredRawResponses(): Promise<void>;
}

let orchestrator: SchedulerOrchestrator | null = null;
let database: SchedulerDatabase | null = null;

const scheduledJobs: ScheduledTask[] = [];

/**
 * Initialize scheduler with dependencies
 */
export function initScheduler(
  orch: SchedulerOrchestrator,
  db: SchedulerDatabase
): void {
  orchestrator = orch;
  database = db;
  logger.info('Scheduler initialized');
}

/**
 * Start all scheduled jobs
 */
export function startScheduler(): void {
  if (!orchestrator || !database) {
    throw new Error('Scheduler not initialized. Call initScheduler first.');
  }

  logger.info('Starting scheduler...');

  // Morning report at 8:00 MSK
  const morningReport = cron.schedule(
    '0 8 * * *',
    async () => {
      logger.info('Running morning report job');
      try {
        await orchestrator!.generateDailyReport();
        logger.info('Morning report completed');
      } catch (error) {
        logger.error('Morning report failed', { error });
      }
    },
    { timezone: 'Europe/Moscow' }
  );
  scheduledJobs.push(morningReport);

  // Evening analysis at 20:00 MSK
  const eveningAnalysis = cron.schedule(
    '0 20 * * *',
    async () => {
      logger.info('Running evening analysis job');
      try {
        await orchestrator!.runEveningAnalysis();
        logger.info('Evening analysis completed');
      } catch (error) {
        logger.error('Evening analysis failed', { error });
      }
    },
    { timezone: 'Europe/Moscow' }
  );
  scheduledJobs.push(eveningAnalysis);

  // Weekly report on Mondays at 9:00 MSK
  const weeklyReport = cron.schedule(
    '0 9 * * 1',
    async () => {
      logger.info('Running weekly report job');
      try {
        await orchestrator!.generateWeeklyReport();
        logger.info('Weekly report completed');
      } catch (error) {
        logger.error('Weekly report failed', { error });
      }
    },
    { timezone: 'Europe/Moscow' }
  );
  scheduledJobs.push(weeklyReport);

  // Sync Yandex data every 6 hours
  const dataSync = cron.schedule(
    '0 */6 * * *',
    async () => {
      logger.info('Running data sync job');
      try {
        await orchestrator!.syncYandexData();
        logger.info('Data sync completed');
      } catch (error) {
        logger.error('Data sync failed', { error });
      }
    },
    { timezone: 'Europe/Moscow' }
  );
  scheduledJobs.push(dataSync);

  // Cleanup expired raw API responses at 3:00 MSK
  const cleanup = cron.schedule(
    '0 3 * * *',
    async () => {
      logger.info('Running cleanup job');
      try {
        await database!.cleanupExpiredRawResponses();
        logger.info('Cleanup completed');
      } catch (error) {
        logger.error('Cleanup failed', { error });
      }
    },
    { timezone: 'Europe/Moscow' }
  );
  scheduledJobs.push(cleanup);

  logger.info(`Started ${scheduledJobs.length} scheduled jobs`);
}

/**
 * Stop all scheduled jobs
 */
export function stopScheduler(): void {
  logger.info('Stopping scheduler...');

  for (const job of scheduledJobs) {
    job.stop();
  }

  scheduledJobs.length = 0;
  logger.info('Scheduler stopped');
}

/**
 * Run a specific job manually
 */
export async function runJob(
  jobName: 'morning_report' | 'evening_analysis' | 'weekly_report' | 'data_sync' | 'cleanup'
): Promise<void> {
  if (!orchestrator || !database) {
    throw new Error('Scheduler not initialized');
  }

  logger.info(`Manually running job: ${jobName}`);

  switch (jobName) {
    case 'morning_report':
      await orchestrator.generateDailyReport();
      break;
    case 'evening_analysis':
      await orchestrator.runEveningAnalysis();
      break;
    case 'weekly_report':
      await orchestrator.generateWeeklyReport();
      break;
    case 'data_sync':
      await orchestrator.syncYandexData();
      break;
    case 'cleanup':
      await database.cleanupExpiredRawResponses();
      break;
  }

  logger.info(`Job ${jobName} completed`);
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  jobCount: number;
  jobs: string[];
} {
  return {
    isRunning: scheduledJobs.length > 0,
    jobCount: scheduledJobs.length,
    jobs: [
      'morning_report (8:00 MSK)',
      'evening_analysis (20:00 MSK)',
      'weekly_report (Mon 9:00 MSK)',
      'data_sync (every 6h)',
      'cleanup (3:00 MSK)',
    ],
  };
}

export default {
  initScheduler,
  startScheduler,
  stopScheduler,
  runJob,
  getSchedulerStatus,
};
