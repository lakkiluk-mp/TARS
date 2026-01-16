import dotenv from 'dotenv';
dotenv.config();

import { YandexDirectClient } from './src/modules/yandex/client';
import { YandexConfig } from './src/modules/yandex/types';
import database from './src/database/client';
import dailyStatsRepo from './src/database/repositories/dailyStats';

const config: YandexConfig = {
  clientId: process.env.YANDEX_CLIENT_ID || '',
  clientSecret: process.env.YANDEX_CLIENT_SECRET || '',
  accessToken: process.env.YANDEX_ACCESS_TOKEN || '',
  refreshToken: process.env.YANDEX_REFRESH_TOKEN || '',
};

async function forceSync() {
  console.log('Starting forced sync...');

  // Init DB
  database.initDatabase({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5437', 10),
    user: process.env.DB_USER || 'tars',
    password: process.env.DB_PASSWORD || 'TARS',
    database: process.env.DB_NAME || 'tars',
  });

  const client = new YandexDirectClient(config, true);

  // Sync last 7 days
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);

  const dateTo = today.toISOString().split('T')[0];
  const dateFrom = sevenDaysAgo.toISOString().split('T')[0];

  console.log(`Fetching stats from ${dateFrom} to ${dateTo}...`);

  try {
    const stats = await client.getStats(dateFrom, dateTo);
    console.log(`Fetched ${stats.length} rows. Saving to DB...`);

    let updated = 0;
    for (const stat of stats) {
      // Find campaign UUID by Yandex ID
      // For this script, we assume campaigns are already in DB.
      // If not, we'd need to fetch them.
      // Let's do a quick lookup
      const campaignRes = await database.query<{ id: string }>(
        'SELECT id FROM campaigns WHERE yandex_id = $1',
        [stat.campaignId]
      );

      if (campaignRes.rows.length > 0) {
        const campaignId = campaignRes.rows[0].id;
        await dailyStatsRepo.upsert({
          campaign_id: campaignId,
          stat_date: stat.date,
          impressions: stat.impressions,
          clicks: stat.clicks,
          cost: stat.cost,
          conversions: stat.conversions,
          ctr: stat.ctr,
          cpa: stat.conversions > 0 ? stat.cost / stat.conversions : undefined,
          revenue: stat.revenue,
          // ROI and Profit will be calculated by repo
          raw_json: stat as any,
        });
        updated++;
      } else {
        console.warn(`Campaign ${stat.campaignId} not found in DB, skipping stats.`);
      }
    }

    console.log(`Successfully updated ${updated} stats.`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await database.closeDatabase();
  }
}

forceSync();
