import { query } from '../client';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('actions-repo');

export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface PendingAction {
  id: string;
  campaign_id: string;
  action_type: string;
  action_data: Record<string, any>;
  ai_reasoning: string;
  status: ActionStatus;
  telegram_message_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePendingActionInput {
  campaign_id: string;
  action_type: string;
  action_data: Record<string, any>;
  ai_reasoning: string;
  telegram_message_id?: number;
}

/**
 * Create a new pending action
 */
export async function create(input: CreatePendingActionInput): Promise<PendingAction> {
  const result = await query<PendingAction>(
    `INSERT INTO pending_actions (
       campaign_id, action_type, action_data, ai_reasoning, telegram_message_id
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.campaign_id,
      input.action_type,
      JSON.stringify(input.action_data),
      input.ai_reasoning,
      input.telegram_message_id || null,
    ]
  );

  logger.info(`Created pending action ${input.action_type} for campaign ${input.campaign_id}`);
  return result.rows[0];
}

/**
 * Get pending action by ID
 */
export async function findById(id: string): Promise<PendingAction | null> {
  const result = await query<PendingAction>('SELECT * FROM pending_actions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Get all pending actions for a campaign
 */
export async function findPendingByCampaign(campaignId: string): Promise<PendingAction[]> {
  const result = await query<PendingAction>(
    `SELECT * FROM pending_actions 
     WHERE campaign_id = $1 AND status = 'pending'
     ORDER BY created_at DESC`,
    [campaignId]
  );
  return result.rows;
}

/**
 * Update action status
 */
export async function updateStatus(
  id: string,
  status: ActionStatus
): Promise<PendingAction | null> {
  const result = await query<PendingAction>(
    `UPDATE pending_actions 
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, id]
  );

  if (result.rows[0]) {
    logger.info(`Updated action ${id} status to ${status}`);
    return result.rows[0];
  }
  return null;
}

/**
 * Update action telegram message ID
 */
export async function updateMessageId(
  id: string,
  messageId: number
): Promise<PendingAction | null> {
  const result = await query<PendingAction>(
    `UPDATE pending_actions 
     SET telegram_message_id = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [messageId, id]
  );

  if (result.rows[0]) {
    logger.info(`Updated action ${id} message ID to ${messageId}`);
    return result.rows[0];
  }
  return null;
}

export default {
  create,
  findById,
  findPendingByCampaign,
  updateStatus,
  updateMessageId,
};
