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
