export interface GenerateReportJobData {
  chatId: number;
  type: 'daily' | 'weekly';
}

export interface HandleUserQuestionJobData {
  type: 'user_question'; // Discriminated union member
  chatId: number;
  userId: string;
  question: string;
}

export interface SyncDataJobData {
  chatId?: number;
  mode: 'full' | 'recent';
}

export interface CreateCampaignJobData {
  type: 'create_campaign'; // Discriminated union member
  chatId: number;
  userId: string;
  description: string;
}

export type MessageJobData = HandleUserQuestionJobData | CreateCampaignJobData;

export enum QueueName {
  REPORTS = 'reports',
  MESSAGES = 'messages',
  SYSTEM = 'system',
}
