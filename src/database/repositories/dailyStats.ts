import { query } from '../client';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('daily-stats-repo');

// Types
export interface DailyStat {
  id: string;
  campaign_id: string;
  stat_date: Date;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  cpa: number | null;
  ctr: number | null;
  raw_json: Record<string, unknown> | null;
  created_at: Date;
}

export interface CreateDailyStatInput {
  campaign_id: string;
  stat_date: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  cpa?: number;
  ctr?: number;
  raw_json?: Record<string, unknown>;
}

// Repository functions
export async function findByCampaignAndDate(
  campaignId: string,
  date: string
): Promise<DailyStat | null> {
  const result = await query<DailyStat>(
    'SELECT * FROM daily_stats WHERE campaign_id = $1 AND stat_date = $2',
    [campaignId, date]
  );
  return result.rows[0] || null;
}

export async function findByCampaignDateRange(
  campaignId: string,
  dateFrom: string,
  dateTo: string
): Promise<DailyStat[]> {
  const result = await query<DailyStat>(
    `SELECT * FROM daily_stats 
     WHERE campaign_id = $1 AND stat_date BETWEEN $2 AND $3
     ORDER BY stat_date DESC`,
    [campaignId, dateFrom, dateTo]
  );
  return result.rows;
}

export async function findAllByDateRange(
  dateFrom: string,
  dateTo: string
): Promise<DailyStat[]> {
  const result = await query<DailyStat>(
    `SELECT * FROM daily_stats 
     WHERE stat_date BETWEEN $1 AND $2
     ORDER BY stat_date DESC, campaign_id`,
    [dateFrom, dateTo]
  );
  return result.rows;
}

export async function upsert(input: CreateDailyStatInput): Promise<DailyStat> {
  // Calculate CTR if not provided
  const ctr = input.ctr ?? (input.impressions > 0 ? (input.clicks / input.impressions) * 100 : 0);
  // Calculate CPA if not provided
  const cpa = input.cpa ?? (input.conversions > 0 ? input.cost / input.conversions : null);

  const result = await query<DailyStat>(
    `INSERT INTO daily_stats (campaign_id, stat_date, impressions, clicks, cost, conversions, cpa, ctr, raw_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (campaign_id, stat_date) DO UPDATE SET
       impressions = EXCLUDED.impressions,
       clicks = EXCLUDED.clicks,
       cost = EXCLUDED.cost,
       conversions = EXCLUDED.conversions,
       cpa = EXCLUDED.cpa,
       ctr = EXCLUDED.ctr,
       raw_json = EXCLUDED.raw_json
     RETURNING *`,
    [
      input.campaign_id,
      input.stat_date,
      input.impressions,
      input.clicks,
      input.cost,
      input.conversions,
      cpa,
      ctr,
      input.raw_json ? JSON.stringify(input.raw_json) : null,
    ]
  );

  logger.debug('Daily stat upserted', {
    campaign_id: input.campaign_id,
    date: input.stat_date,
  });

  return result.rows[0];
}

export async function bulkUpsert(stats: CreateDailyStatInput[]): Promise<number> {
  let count = 0;
  for (const stat of stats) {
    await upsert(stat);
    count++;
  }
  logger.info(`Bulk upserted ${count} daily stats`);
  return count;
}

export async function getLatestStatDate(campaignId: string): Promise<string | null> {
  const result = await query<{ stat_date: Date }>(
    'SELECT stat_date FROM daily_stats WHERE campaign_id = $1 ORDER BY stat_date DESC LIMIT 1',
    [campaignId]
  );
  if (result.rows[0]) {
    return result.rows[0].stat_date.toISOString().split('T')[0];
  }
  return null;
}

export async function getAggregatedStats(
  campaignId: string,
  dateFrom: string,
  dateTo: string
): Promise<{
  total_impressions: number;
  total_clicks: number;
  total_cost: number;
  total_conversions: number;
  avg_ctr: number;
  avg_cpa: number | null;
}> {
  const result = await query<{
    total_impressions: string;
    total_clicks: string;
    total_cost: string;
    total_conversions: string;
    avg_ctr: string;
    avg_cpa: string | null;
  }>(
    `SELECT 
       COALESCE(SUM(impressions), 0) as total_impressions,
       COALESCE(SUM(clicks), 0) as total_clicks,
       COALESCE(SUM(cost), 0) as total_cost,
       COALESCE(SUM(conversions), 0) as total_conversions,
       CASE WHEN SUM(impressions) > 0 
         THEN (SUM(clicks)::float / SUM(impressions)) * 100 
         ELSE 0 
       END as avg_ctr,
       CASE WHEN SUM(conversions) > 0 
         THEN SUM(cost) / SUM(conversions) 
         ELSE NULL 
       END as avg_cpa
     FROM daily_stats
     WHERE campaign_id = $1 AND stat_date BETWEEN $2 AND $3`,
    [campaignId, dateFrom, dateTo]
  );

  const row = result.rows[0];
  return {
    total_impressions: parseInt(row.total_impressions, 10),
    total_clicks: parseInt(row.total_clicks, 10),
    total_cost: parseFloat(row.total_cost),
    total_conversions: parseInt(row.total_conversions, 10),
    avg_ctr: parseFloat(row.avg_ctr),
    avg_cpa: row.avg_cpa ? parseFloat(row.avg_cpa) : null,
  };
}

export default {
  findByCampaignAndDate,
  findByCampaignDateRange,
  findAllByDateRange,
  upsert,
  bulkUpsert,
  getLatestStatDate,
  getAggregatedStats,
};
