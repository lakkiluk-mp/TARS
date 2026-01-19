import { Queue } from 'bullmq';
import { redisConfig } from './redis';
import { QueueName } from './types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('queue-manager');

export const reportsQueue = new Queue(QueueName.REPORTS, { connection: redisConfig });
export const messagesQueue = new Queue(QueueName.MESSAGES, { connection: redisConfig });
export const systemQueue = new Queue(QueueName.SYSTEM, { connection: redisConfig });

logger.info('Queues initialized', {
  queues: [QueueName.REPORTS, QueueName.MESSAGES, QueueName.SYSTEM],
});

export const queues = {
  reports: reportsQueue,
  messages: messagesQueue,
  system: systemQueue,
};
