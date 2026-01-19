export * as campaignsRepo from './campaigns';
export * as dailyStatsRepo from './dailyStats';
export * as actionsRepo from './actions';
export * as proposalsRepo from './proposals';
export * as keywordsRepo from './keywords';
export * as searchQueriesRepo from './searchQueries';

// Re-export types
export type { Campaign, CreateCampaignInput, UpdateCampaignInput } from './campaigns';
export type { DailyStat, CreateDailyStatInput } from './dailyStats';
export type { PendingAction, CreatePendingActionInput, ActionStatus } from './actions';
export type { Proposal, CreateProposalInput, UpdateProposalInput } from './proposals';
export type { Keyword, CreateKeywordInput } from './keywords';
export type { SearchQuery, CreateSearchQueryInput } from './searchQueries';
