import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('database');

// Database configuration interface
interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// Singleton database pool
let pool: Pool | null = null;

/**
 * Initialize database connection pool
 */
export function initDatabase(config: DatabaseConfig): Pool {
  if (pool) {
    logger.warn('Database pool already initialized');
    return pool;
  }

  pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('connect', () => {
    // logger.debug('New client connected to database'); // Disabled to reduce noise
  });

  pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', { error: err.message });
  });

  // logger.info('Database pool initialized', { // Disabled to reduce noise
  //   host: config.host,
  //   port: config.port,
  //   database: config.database,
  // });

  return pool;
}

/**
 * Get database pool instance
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initDatabase first.');
  }
  return pool;
}

/**
 * Execute a query
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await getPool().query<T>(text, params);
  const duration = Date.now() - start;

  // Only log slow queries or errors (errors are handled by caller/pool)
  if (duration > 1000) {
    logger.warn('Slow query detected', {
      text: text.substring(0, 200),
      duration,
      rows: result.rowCount,
    });
  }

  return result;
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<PoolClient> {
  const client = await getPool().connect();
  return client;
}

/**
 * Execute a transaction
 */
export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close database pool
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    // logger.info('Database pool closed'); // Disabled to reduce noise
  }
}

/**
 * Check database connection
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW()');
    logger.info('Database connection successful', { timestamp: result.rows[0] });
    return true;
  } catch (error) {
    logger.error('Database connection failed', { error });
    return false;
  }
}

export default {
  initDatabase,
  getPool,
  query,
  getClient,
  transaction,
  closeDatabase,
  checkConnection,
};
