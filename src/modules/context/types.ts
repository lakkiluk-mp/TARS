// Context Manager Types

export interface GlobalContext {
  goals?: string;
  knowledgeBase: KnowledgeFact[];
  bestPractices?: string[];
}

export interface CampaignContext {
  campaignId: string;
  campaignName: string;
  history: string;
  previousRecommendations: string[];
  keyFacts: string[];
}

export interface ProposalContext {
  proposalId: string;
  title: string;
  status: string;
  conversationHistory: ConversationMessage[];
  reasoning: string;
}

export interface SessionContext {
  userId: string;
  currentCampaignId?: string;
  currentProposalId?: string;
  currentConversationId?: string;
  lastActivity: Date;
}

export interface UserSession {
  id: string;
  telegram_user_id: string;
  current_conversation_id: string | null;
  current_campaign_id: string | null;
  settings: Record<string, unknown>;
  updated_at: Date;
}

export interface ContextDetectionResult {
  campaignId?: string;
  campaignName?: string;
  proposalId?: string;
  proposalTitle?: string;
  confidence: number;
  needsClarification: boolean;
  suggestedCampaigns?: { id: string; name: string }[];
  suggestedProposals?: { id: string; title: string }[];
}

export interface BuiltContext {
  globalContext: GlobalContext;
  campaignContext?: CampaignContext;
  proposalContext?: ProposalContext;
  conversationHistory: ConversationMessage[];
  sessionContext: SessionContext;
}

export interface KnowledgeFact {
  id: string;
  fact: string;
  source: string;
  confidence: number;
  relatedCampaignId?: string;
  createdAt: Date;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  type: 'campaign_analysis' | 'proposal' | 'general';
  campaignId?: string;
  proposalId?: string;
  status: 'active' | 'archived';
  summary?: string;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}
