export interface GenerateReportJobData {
  chatId: number;
  type: 'daily' | 'weekly';
}

export interface HandleUserQuestionJobData {
  chatId: number;
  userId: string;
  question: string;
}

export interface SyncDataJobData {
  chatId?: number;
  mode: 'full' | 'recent';
}

export interface CreateCampaignJobData {
  chatId: number;
  userId: string;
  description: string;
}

export type JobData =
  | GenerateReportJobData
  | HandleUserQuestionJobData
  | SyncDataJobData
  | CreateCampaignJobData;

export enum QueueName {
  REPORTS = 'reports',
  MESSAGES = 'messages',
  SYSTEM = 'system',
}
