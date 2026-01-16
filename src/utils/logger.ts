import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Create child loggers for specific modules
export const createModuleLogger = (moduleName: string) => {
  return logger.child({ module: moduleName });
};

// Debug file logger for Yandex API
export const logYandexRequest = (endpoint: string, request: unknown) => {
  const debugDir = path.join(logsDir, 'yandex', new Date().toISOString().split('T')[0]);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = path.join(debugDir, `request-${timestamp}.json`);
  fs.writeFileSync(
    filename,
    JSON.stringify({ endpoint, request, timestamp: new Date().toISOString() }, null, 2)
  );

  logger.debug(`Yandex API request logged to ${filename}`);
};

export const logYandexResponse = (endpoint: string, response: unknown) => {
  const debugDir = path.join(logsDir, 'yandex', new Date().toISOString().split('T')[0]);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = path.join(debugDir, `response-${timestamp}.json`);
  fs.writeFileSync(
    filename,
    JSON.stringify({ endpoint, response, timestamp: new Date().toISOString() }, null, 2)
  );

  logger.debug(`Yandex API response logged to ${filename}`);
};

// Debug file logger for AI
export const logAIPrompt = (task: string, prompt: string) => {
  const debugDir = path.join(logsDir, 'ai', new Date().toISOString().split('T')[0]);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = path.join(debugDir, `prompt-${timestamp}.txt`);
  fs.writeFileSync(filename, `Task: ${task}\n\n${prompt}`);

  logger.debug(`AI prompt logged to ${filename}`);
};

export const logAIResponse = (task: string, response: unknown) => {
  const debugDir = path.join(logsDir, 'ai', new Date().toISOString().split('T')[0]);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = path.join(debugDir, `response-${timestamp}.json`);
  fs.writeFileSync(
    filename,
    JSON.stringify({ task, response, timestamp: new Date().toISOString() }, null, 2)
  );

  logger.debug(`AI response logged to ${filename}`);
};

export default logger;
