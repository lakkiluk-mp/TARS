import { query, transaction } from '../client';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('campaigns-repo');

// Types
export interface Campaign {
  id: string;
  yandex_id: string;
  name: string;
  status: string;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCampaignInput {
  yandex_id: string;
  name: string;
  status?: string;
  settings?: Record<string, unknown>;
}

export interface UpdateCampaignInput {
  name?: string;
  status?: string;
  settings?: Record<string, unknown>;
}

// Repository functions
export async function findAll(): Promise<Campaign[]> {
  const result = await query<Campaign>('SELECT * FROM campaigns ORDER BY name');
  return result.rows;
}

export async function findById(id: string): Promise<Campaign | null> {
  const result = await query<Campaign>('SELECT * FROM campaigns WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function findByYandexId(yandexId: string): Promise<Campaign | null> {
  const result = await query<Campaign>('SELECT * FROM campaigns WHERE yandex_id = $1', [yandexId]);
  return result.rows[0] || null;
}

export async function create(input: CreateCampaignInput): Promise<Campaign> {
  const result = await query<Campaign>(
    `INSERT INTO campaigns (yandex_id, name, status, settings)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.yandex_id, input.name, input.status || 'active', JSON.stringify(input.settings || {})]
  );

  logger.info('Campaign created', { id: result.rows[0].id, name: input.name });
  return result.rows[0];
}

export async function update(id: string, input: UpdateCampaignInput): Promise<Campaign | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }
  if (input.settings !== undefined) {
    updates.push(`settings = $${paramIndex++}`);
    values.push(JSON.stringify(input.settings));
  }

  if (updates.length === 0) {
    return findById(id);
  }

  values.push(id);
  const result = await query<Campaign>(
    `UPDATE campaigns SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows[0]) {
    logger.info('Campaign updated', { id, updates: Object.keys(input) });
  }

  return result.rows[0] || null;
}

export async function upsertFromYandex(
  yandexId: string,
  name: string,
  status: string
): Promise<Campaign> {
  const result = await query<Campaign>(
    `INSERT INTO campaigns (yandex_id, name, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (yandex_id) DO UPDATE SET
       name = EXCLUDED.name,
       status = EXCLUDED.status
     RETURNING *`,
    [yandexId, name, status]
  );

  return result.rows[0];
}

export async function deleteById(id: string): Promise<boolean> {
  const result = await query('DELETE FROM campaigns WHERE id = $1', [id]);
  const deleted = (result.rowCount ?? 0) > 0;

  if (deleted) {
    logger.info('Campaign deleted', { id });
  }

  return deleted;
}

export async function getActiveCampaigns(): Promise<Campaign[]> {
  const result = await query<Campaign>(
    "SELECT * FROM campaigns WHERE status = 'active' ORDER BY name"
  );
  return result.rows;
}

export default {
  findAll,
  findById,
  findByYandexId,
  create,
  update,
  upsertFromYandex,
  deleteById,
  getActiveCampaigns,
};
