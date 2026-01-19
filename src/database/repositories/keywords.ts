import { query } from '../client';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('keywords-repo');

export interface Keyword {
  id: string;
  campaign_id: string;
  keyword: string;
  match_type: string;
  bid: number | null;
  status: string;
  stats: Record<string, unknown> | null;
  updated_at: Date;
}

export interface CreateKeywordInput {
  campaign_id: string; // Internal UUID
  keyword: string;
  match_type?: string;
  bid?: number;
  status?: string;
  stats?: Record<string, unknown>;
}

/**
 * Upsert keyword (by campaign_id + keyword text)
 */
export async function upsert(input: CreateKeywordInput): Promise<Keyword> {
  // Simple deduplication by campaign_id + keyword
  // Note: Real Yandex ID for keyword might be useful, but our schema
  // currently uses UUID PK and (campaign_id, keyword) might not be unique if Yandex allows duplicates?
  // Yandex allows duplicates in different groups. Our schema links to campaign.
  // Ideally we should store Yandex Keyword ID.
  // Let's check schema:
  // CREATE TABLE keywords (
  //     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  //     campaign_id UUID REFERENCES campaigns(id),
  //     keyword TEXT NOT NULL,
  //     ...
  // );
  // It doesn't have Yandex ID column or unique constraint on (campaign_id, keyword).
  // But for sync, we probably want to avoid duplicates.
  // Let's assume we want unique (campaign_id, keyword) for simplicity or check if we can add yandex_id.
  // The current schema is minimal. I will try to find by content first.

  const existing = await query<Keyword>(
    'SELECT * FROM keywords WHERE campaign_id = $1 AND keyword = $2 LIMIT 1',
    [input.campaign_id, input.keyword]
  );

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    const result = await query<Keyword>(
      `UPDATE keywords 
       SET match_type = $1, bid = $2, status = $3, stats = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        input.match_type || 'phrase',
        input.bid || null,
        input.status || 'active',
        input.stats ? JSON.stringify(input.stats) : '{}',
        id,
      ]
    );
    return result.rows[0];
  } else {
    const result = await query<Keyword>(
      `INSERT INTO keywords (campaign_id, keyword, match_type, bid, status, stats)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.campaign_id,
        input.keyword,
        input.match_type || 'phrase',
        input.bid || null,
        input.status || 'active',
        input.stats ? JSON.stringify(input.stats) : '{}',
      ]
    );
    return result.rows[0];
  }
}

export async function findByCampaignId(campaignId: string): Promise<Keyword[]> {
  const result = await query<Keyword>(
    'SELECT * FROM keywords WHERE campaign_id = $1 ORDER BY keyword',
    [campaignId]
  );
  return result.rows;
}

export default {
  upsert,
  findByCampaignId,
};
