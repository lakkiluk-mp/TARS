import fs from 'fs';
import path from 'path';
import { initDatabase, query, closeDatabase } from './client';
import { createModuleLogger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const logger = createModuleLogger('migrate');

async function runMigrations() {
  logger.info('Starting database migrations...');

  // Initialize database connection
  initDatabase({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'tars',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tars',
  });

  try {
    // Create migrations tracking table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get list of migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    logger.info(`Found ${files.length} migration files`);

    // Get already executed migrations
    const executed = await query<{ name: string }>('SELECT name FROM migrations');
    const executedNames = new Set(executed.rows.map((r) => r.name));

    // Run pending migrations
    for (const file of files) {
      if (executedNames.has(file)) {
        logger.debug(`Skipping already executed migration: ${file}`);
        continue;
      }

      logger.info(`Running migration: ${file}`);

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await query(sql);
        await query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        logger.info(`✅ Migration completed: ${file}`);
      } catch (error) {
        logger.error(`❌ Migration failed: ${file}`, { error });
        throw error;
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration process failed', { error });
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

// Run if called directly
runMigrations();
