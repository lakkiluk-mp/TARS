import { query } from '../../database/client';
import { createModuleLogger } from '../../utils/logger';
import {
  GlobalContext,
  CampaignContext,
  ProposalContext,
  SessionContext,
  KnowledgeFact,
  Conversation,
  ConversationMessage,
} from './types';

const logger = createModuleLogger('context-manager');

export class ContextManager {
  /**
   * Get global context (goals, knowledge base, best practices)
   */
  async getGlobalContext(): Promise<GlobalContext> {
    logger.debug('Getting global context');

    // Get knowledge base facts
    const factsResult = await query<{
      id: string;
      fact: string;
      source: string;
      confidence: number;
      related_campaign_id: string | null;
      created_at: Date;
    }>('SELECT * FROM knowledge_base ORDER BY confidence DESC LIMIT 50');

    const knowledgeBase: KnowledgeFact[] = factsResult.rows.map((row) => ({
      id: row.id,
      fact: row.fact,
      source: row.source,
      confidence: row.confidence,
      relatedCampaignId: row.related_campaign_id || undefined,
      createdAt: row.created_at,
    }));

    return {
      goals: 'Максимизация конверсий при оптимальном CPA', // TODO: Make configurable
      knowledgeBase,
      bestPractices: [
        'Регулярно добавлять минус-слова',
        'Следить за CTR и корректировать объявления',
        'Анализировать поисковые запросы еженедельно',
      ],
    };
  }

  /**
   * Get campaign-specific context
   */
  async getCampaignContext(campaignId: string): Promise<CampaignContext | null> {
    logger.debug('Getting campaign context', { campaignId });

    // Get campaign info
    const campaignResult = await query<{
      id: string;
      yandex_id: string;
      name: string;
    }>('SELECT * FROM campaigns WHERE id = $1 OR yandex_id = $1', [campaignId]);

    if (campaignResult.rows.length === 0) {
      return null;
    }

    const campaign = campaignResult.rows[0];

    // Get recent change log
    const changesResult = await query<{
      action_type: string;
      ai_reasoning: string;
      created_at: Date;
    }>(
      `SELECT action_type, ai_reasoning, created_at 
       FROM change_log 
       WHERE campaign_id = $1 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [campaign.id]
    );

    const history = changesResult.rows
      .map((r) => `${r.created_at.toISOString().split('T')[0]}: ${r.action_type} - ${r.ai_reasoning || 'No reasoning'}`)
      .join('\n');

    // Get previous recommendations
    const recsResult = await query<{ content: string }>(
      `SELECT m.content 
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE c.campaign_id = $1 AND m.role = 'assistant'
       ORDER BY m.created_at DESC
       LIMIT 5`,
      [campaign.id]
    );

    const previousRecommendations = recsResult.rows.map((r) => r.content);

    // Get campaign-specific knowledge
    const factsResult = await query<{ fact: string }>(
      'SELECT fact FROM knowledge_base WHERE related_campaign_id = $1',
      [campaign.id]
    );

    const keyFacts = factsResult.rows.map((r) => r.fact);

    return {
      campaignId: campaign.yandex_id,
      campaignName: campaign.name,
      history,
      previousRecommendations,
      keyFacts,
    };
  }

  /**
   * Get proposal context
   */
  async getProposalContext(proposalId: string): Promise<ProposalContext | null> {
    logger.debug('Getting proposal context', { proposalId });

    const proposalResult = await query<{
      id: string;
      title: string;
      status: string;
      reasoning: string;
      conversation_id: string;
    }>('SELECT * FROM proposals WHERE id = $1', [proposalId]);

    if (proposalResult.rows.length === 0) {
      return null;
    }

    const proposal = proposalResult.rows[0];

    // Get conversation history
    const messagesResult = await query<{
      id: string;
      role: string;
      content: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT * FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at ASC`,
      [proposal.conversation_id]
    );

    const conversationHistory: ConversationMessage[] = messagesResult.rows.map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));

    return {
      proposalId: proposal.id,
      title: proposal.title,
      status: proposal.status,
      conversationHistory,
      reasoning: proposal.reasoning,
    };
  }

  /**
   * Get or create user session
   */
  async getSession(userId: string): Promise<SessionContext> {
    logger.debug('Getting session', { userId });

    const result = await query<{
      id: string;
      telegram_user_id: string;
      current_conversation_id: string | null;
      current_campaign_id: string | null;
      settings: Record<string, unknown>;
      updated_at: Date;
    }>(
      `INSERT INTO user_sessions (telegram_user_id)
       VALUES ($1)
       ON CONFLICT (telegram_user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId]
    );

    const session = result.rows[0];

    return {
      userId: session.telegram_user_id,
      currentCampaignId: session.current_campaign_id || undefined,
      currentConversationId: session.current_conversation_id || undefined,
      lastActivity: session.updated_at,
    };
  }

  /**
   * Update session context
   */
  async updateSession(
    userId: string,
    updates: Partial<{
      currentCampaignId: string | null;
      currentConversationId: string | null;
      currentProposalId: string | null;
    }>
  ): Promise<void> {
    logger.debug('Updating session', { userId, updates });

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if ('currentCampaignId' in updates) {
      setClauses.push(`current_campaign_id = $${paramIndex++}`);
      values.push(updates.currentCampaignId);
    }
    if ('currentConversationId' in updates) {
      setClauses.push(`current_conversation_id = $${paramIndex++}`);
      values.push(updates.currentConversationId);
    }

    if (setClauses.length > 0) {
      values.push(userId);
      await query(
        `UPDATE user_sessions SET ${setClauses.join(', ')} WHERE telegram_user_id = $${paramIndex}`,
        values
      );
    }
  }

  /**
   * Add knowledge fact
   */
  async addKnowledge(
    fact: string,
    source: string,
    relatedCampaignId?: string,
    confidence = 1.0
  ): Promise<void> {
    logger.info('Adding knowledge fact', { fact: fact.substring(0, 50), source });

    await query(
      `INSERT INTO knowledge_base (fact, source, confidence, related_campaign_id)
       VALUES ($1, $2, $3, $4)`,
      [fact, source, confidence, relatedCampaignId || null]
    );
  }

  /**
   * Create or get conversation
   */
  async getOrCreateConversation(
    type: 'campaign_analysis' | 'proposal' | 'general',
    campaignId?: string,
    proposalId?: string
  ): Promise<Conversation> {
    logger.debug('Getting or creating conversation', { type, campaignId, proposalId });

    // Try to find existing active conversation
    let whereClause = "type = $1 AND status = 'active'";
    const params: unknown[] = [type];

    if (campaignId) {
      whereClause += ' AND campaign_id = $2';
      params.push(campaignId);
    }
    if (proposalId) {
      whereClause += ` AND proposal_id = $${params.length + 1}`;
      params.push(proposalId);
    }

    const existingResult = await query<{
      id: string;
      type: string;
      campaign_id: string | null;
      proposal_id: string | null;
      status: string;
      summary: string | null;
      created_at: Date;
      updated_at: Date;
    }>(`SELECT * FROM conversations WHERE ${whereClause} LIMIT 1`, params);

    if (existingResult.rows.length > 0) {
      const conv = existingResult.rows[0];
      const messages = await this.getConversationMessages(conv.id);

      return {
        id: conv.id,
        type: conv.type as 'campaign_analysis' | 'proposal' | 'general',
        campaignId: conv.campaign_id || undefined,
        proposalId: conv.proposal_id || undefined,
        status: conv.status as 'active' | 'archived',
        summary: conv.summary || undefined,
        messages,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
      };
    }

    // Create new conversation
    const createResult = await query<{
      id: string;
      type: string;
      campaign_id: string | null;
      proposal_id: string | null;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO conversations (type, campaign_id, proposal_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [type, campaignId || null, proposalId || null]
    );

    const newConv = createResult.rows[0];

    return {
      id: newConv.id,
      type: newConv.type as 'campaign_analysis' | 'proposal' | 'general',
      campaignId: newConv.campaign_id || undefined,
      proposalId: newConv.proposal_id || undefined,
      status: 'active',
      messages: [],
      createdAt: newConv.created_at,
      updatedAt: newConv.updated_at,
    };
  }

  /**
   * Get conversation messages
   */
  async getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
    const result = await query<{
      id: string;
      role: string;
      content: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }

  /**
   * Add message to conversation
   */
  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<ConversationMessage> {
    logger.debug('Adding message', { conversationId, role });

    const result = await query<{
      id: string;
      role: string;
      content: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `INSERT INTO messages (conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [conversationId, role, content, JSON.stringify(metadata || {})]
    );

    const row = result.rows[0];

    return {
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  /**
   * Finalize and summarize conversation
   */
  async finalizeConversation(conversationId: string, summary: string): Promise<void> {
    logger.info('Finalizing conversation', { conversationId });

    await query(
      `UPDATE conversations SET status = 'archived', summary = $1 WHERE id = $2`,
      [summary, conversationId]
    );
  }

  /**
   * Search knowledge base
   */
  async searchKnowledge(searchQuery: string, limit = 10): Promise<KnowledgeFact[]> {
    logger.debug('Searching knowledge', { query: searchQuery });

    // Simple text search (can be enhanced with pgvector later)
    const result = await query<{
      id: string;
      fact: string;
      source: string;
      confidence: number;
      related_campaign_id: string | null;
      created_at: Date;
    }>(
      `SELECT * FROM knowledge_base 
       WHERE fact ILIKE $1 
       ORDER BY confidence DESC 
       LIMIT $2`,
      [`%${searchQuery}%`, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      fact: row.fact,
      source: row.source,
      confidence: row.confidence,
      relatedCampaignId: row.related_campaign_id || undefined,
      createdAt: row.created_at,
    }));
  }
}

export default ContextManager;
