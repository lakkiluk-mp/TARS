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
  ContextDetectionResult,
  BuiltContext,
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

    // Get business goals from knowledge base
    const goalsResult = await query<{ fact: string }>(
      "SELECT fact FROM knowledge_base WHERE source LIKE 'initial_context/%goals%' LIMIT 1"
    );

    const goals =
      goalsResult.rows.length > 0
        ? goalsResult.rows[0].fact
        : 'Максимизация конверсий при оптимальном CPA';

    return {
      goals,
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
      .map(
        (r) =>
          `${r.created_at.toISOString().split('T')[0]}: ${r.action_type} - ${r.ai_reasoning || 'No reasoning'}`
      )
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
    }>('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC', [
      conversationId,
    ]);

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

    await query(`UPDATE conversations SET status = 'archived', summary = $1 WHERE id = $2`, [
      summary,
      conversationId,
    ]);
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

  /**
   * Detect context from user message using AI classification result
   */
  async detectContext(
    classificationResult: { campaign?: string; proposal?: string; confidence: number },
    userId: string
  ): Promise<ContextDetectionResult> {
    logger.debug('Detecting context', { classificationResult, userId });

    const result: ContextDetectionResult = {
      confidence: classificationResult.confidence,
      needsClarification: false,
    };

    // Try to find campaign by name or ID
    if (classificationResult.campaign) {
      const campaignResult = await query<{
        id: string;
        yandex_id: string;
        name: string;
      }>(
        `SELECT id, yandex_id, name FROM campaigns
         WHERE name ILIKE $1 OR yandex_id = $2
         LIMIT 5`,
        [`%${classificationResult.campaign}%`, classificationResult.campaign]
      );

      if (campaignResult.rows.length === 1) {
        result.campaignId = campaignResult.rows[0].yandex_id;
        result.campaignName = campaignResult.rows[0].name;
      } else if (campaignResult.rows.length > 1) {
        result.needsClarification = true;
        result.suggestedCampaigns = campaignResult.rows.map((r) => ({
          id: r.yandex_id,
          name: r.name,
        }));
      }
    }

    // Try to find proposal by title
    if (classificationResult.proposal) {
      const proposalResult = await query<{
        id: string;
        title: string;
      }>(
        `SELECT id, title FROM proposals
         WHERE title ILIKE $1 AND status != 'rejected'
         LIMIT 5`,
        [`%${classificationResult.proposal}%`]
      );

      if (proposalResult.rows.length === 1) {
        result.proposalId = proposalResult.rows[0].id;
        result.proposalTitle = proposalResult.rows[0].title;
      } else if (proposalResult.rows.length > 1) {
        result.needsClarification = true;
        result.suggestedProposals = proposalResult.rows.map((r) => ({
          id: r.id,
          title: r.title,
        }));
      }
    }

    // If no context detected and confidence is low, suggest available campaigns
    if (!result.campaignId && !result.proposalId && classificationResult.confidence < 0.5) {
      const campaignsResult = await query<{
        yandex_id: string;
        name: string;
      }>('SELECT yandex_id, name FROM campaigns WHERE status = $1 LIMIT 5', ['active']);

      if (campaignsResult.rows.length > 0) {
        result.needsClarification = true;
        result.suggestedCampaigns = campaignsResult.rows.map((r) => ({
          id: r.yandex_id,
          name: r.name,
        }));
      }
    }

    return result;
  }

  /**
   * Build full context for answering a question
   */
  async buildContextForQuestion(
    userId: string,
    detectedContext?: ContextDetectionResult
  ): Promise<BuiltContext> {
    logger.debug('Building context for question', { userId, detectedContext });

    // Get session
    const session = await this.getSession(userId);

    // Get global context
    const globalContext = await this.getGlobalContext();

    // Determine which campaign/proposal to use
    const campaignId = detectedContext?.campaignId || session.currentCampaignId;
    const proposalId = detectedContext?.proposalId || session.currentProposalId;

    // Get campaign context if available
    let campaignContext: CampaignContext | undefined;
    if (campaignId) {
      const ctx = await this.getCampaignContext(campaignId);
      if (ctx) {
        campaignContext = ctx;
      }
    }

    // Get proposal context if available
    let proposalContext: ProposalContext | undefined;
    if (proposalId) {
      const ctx = await this.getProposalContext(proposalId);
      if (ctx) {
        proposalContext = ctx;
      }
    }

    // Get conversation history
    let conversationHistory: ConversationMessage[] = [];
    if (session.currentConversationId) {
      conversationHistory = await this.getConversationMessages(session.currentConversationId);
    }

    return {
      globalContext,
      campaignContext,
      proposalContext,
      conversationHistory,
      sessionContext: session,
    };
  }

  /**
   * Set current campaign for user session
   */
  async setCurrentCampaign(userId: string, campaignId: string): Promise<void> {
    logger.info('Setting current campaign', { userId, campaignId });

    // Find campaign by yandex_id
    const campaignResult = await query<{ id: string }>(
      'SELECT id FROM campaigns WHERE yandex_id = $1',
      [campaignId]
    );

    if (campaignResult.rows.length === 0) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    // Create or get conversation for this campaign
    const conversation = await this.getOrCreateConversation(
      'campaign_analysis',
      campaignResult.rows[0].id
    );

    await this.updateSession(userId, {
      currentCampaignId: campaignResult.rows[0].id,
      currentConversationId: conversation.id,
      currentProposalId: null,
    });
  }

  /**
   * Set current proposal for user session
   */
  async setCurrentProposal(userId: string, proposalId: string): Promise<void> {
    logger.info('Setting current proposal', { userId, proposalId });

    // Find proposal
    const proposalResult = await query<{ id: string; conversation_id: string }>(
      'SELECT id, conversation_id FROM proposals WHERE id = $1',
      [proposalId]
    );

    if (proposalResult.rows.length === 0) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    await this.updateSession(userId, {
      currentProposalId: proposalId,
      currentConversationId: proposalResult.rows[0].conversation_id,
      currentCampaignId: null,
    });
  }

  /**
   * Clear current context (reset to general)
   */
  async clearCurrentContext(userId: string): Promise<void> {
    logger.info('Clearing current context', { userId });

    // Create general conversation
    const conversation = await this.getOrCreateConversation('general');

    await this.updateSession(userId, {
      currentCampaignId: null,
      currentProposalId: null,
      currentConversationId: conversation.id,
    });
  }

  /**
   * Get list of active campaigns for selection
   */
  async getActiveCampaigns(): Promise<{ id: string; name: string }[]> {
    const result = await query<{ yandex_id: string; name: string }>(
      'SELECT yandex_id, name FROM campaigns WHERE status = $1 ORDER BY name',
      ['active']
    );

    return result.rows.map((r) => ({ id: r.yandex_id, name: r.name }));
  }

  /**
   * Get list of active proposals for selection
   */
  async getActiveProposals(): Promise<{ id: string; title: string; status: string }[]> {
    const result = await query<{ id: string; title: string; status: string }>(
      `SELECT id, title, status FROM proposals
       WHERE status NOT IN ('rejected', 'implemented')
       ORDER BY created_at DESC`
    );

    return result.rows;
  }
}

export default ContextManager;
