import { query } from '../client';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('search-queries-repo');

export interface SearchQuery {
  id: string;
  campaign_id: string;
  query: string;
  impressions: number;
  clicks: number;
  cost: number;
  query_date: Date;
}

export interface CreateSearchQueryInput {
  campaign_id: string;
  query: string;
  impressions: number;
  clicks: number;
  cost: number;
  query_date: string;
}

/**
 * Upsert search query
 */
export async function upsert(input: CreateSearchQueryInput): Promise<SearchQuery> {
  // We assume (campaign_id, query, query_date) is unique or we just append?
  // Schema doesn't enforce uniqueness. But usually we want to update stats for same day/query.
  // Let's check for existing record.

  const existing = await query<SearchQuery>(
    'SELECT * FROM search_queries WHERE campaign_id = $1 AND query = $2 AND query_date = $3 LIMIT 1',
    [input.campaign_id, input.query, input.query_date]
  );

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    const result = await query<SearchQuery>(
      `UPDATE search_queries 
       SET impressions = $1, clicks = $2, cost = $3
       WHERE id = $4
       RETURNING *`,
      [input.impressions, input.clicks, input.cost, id]
    );
    return result.rows[0];
  } else {
    const result = await query<SearchQuery>(
      `INSERT INTO search_queries (campaign_id, query, impressions, clicks, cost, query_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.campaign_id,
        input.query,
        input.impressions,
        input.clicks,
        input.cost,
        input.query_date,
      ]
    );
    return result.rows[0];
  }
}

export async function findByCampaignId(campaignId: string, limit = 100): Promise<SearchQuery[]> {
  const result = await query<SearchQuery>(
    'SELECT * FROM search_queries WHERE campaign_id = $1 ORDER BY cost DESC LIMIT $2',
    [campaignId, limit]
  );
  return result.rows;
}

export default {
  upsert,
  findByCampaignId,
};
