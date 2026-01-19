import IORedis from 'ioredis';
import { config } from '../../config';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('redis');

export const redisConfig = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Required by BullMQ
};

export const connection = new IORedis(redisConfig);

connection.on('connect', () => {
  logger.info('Connected to Redis', { host: config.redis.host });
});

connection.on('error', (error) => {
  logger.error('Redis connection error', { error });
});

export const getRedisConnection = () => new IORedis(redisConfig);
