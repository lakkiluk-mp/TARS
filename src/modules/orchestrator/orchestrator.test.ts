import { Orchestrator } from './index';
import { campaignsRepo, dailyStatsRepo, actionsRepo } from '../../database/repositories';
// We don't import ActionManager class directly for mocking if we use jest.mock with factory properly
// but we need the mocked constructor to check instances.
import { ActionManager } from '../actions/manager';

// Create a persistent mock object
const mockActionManagerInstance = {
  createAction: jest.fn(),
  executeAction: jest.fn(),
  rejectAction: jest.fn(),
};

// Mock ActionManager class
jest.mock('../actions/manager', () => {
  return {
    ActionManager: jest.fn().mockImplementation(() => mockActionManagerInstance),
  };
});

// Mock dependencies
jest.mock('../../database/repositories', () => ({
  campaignsRepo: {
    findByYandexId: jest.fn(),
    upsertFromYandex: jest.fn(),
    getActiveCampaigns: jest.fn(),
  },
  dailyStatsRepo: {
    upsert: jest.fn(),
    findAllByDateRange: jest.fn(),
    findByCampaignDateRange: jest.fn(),
  },
  proposalsRepo: {},
  keywordsRepo: {},
  searchQueriesRepo: {
    upsert: jest.fn(),
  },
  actionsRepo: {
    findById: jest.fn(),
    updateMessageId: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  createModuleLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  // Mock external services
  const mockYandex = {
    getStats: jest.fn(),
    getSearchQueries: jest.fn(),
  } as any;

  const mockAI = {
    analyze: jest.fn(),
  } as any;

  const mockTelegram = {
    setOrchestrator: jest.fn(),
    sendReport: jest.fn(),
    sendActionConfirmation: jest.fn(),
  } as any;

  const mockContext = {} as any;

  beforeEach(() => {
    orchestrator = new Orchestrator(mockYandex, mockAI, mockTelegram, mockContext);
    jest.clearAllMocks();
  });

  describe('prepareCampaignData', () => {
    it('should calculate stats correctly', async () => {
      // Setup data
      const currentStats = [
        {
          campaignId: '123',
          campaignName: 'Test Campaign',
          date: '2023-10-01',
          impressions: 1000,
          clicks: 50,
          cost: 500,
          conversions: 5,
          ctr: 5,
          avgCpc: 10,
        },
      ];

      const previousStats = [
        {
          campaign_id: 'internal-123',
          impressions: 2000,
          clicks: 80,
          cost: 700,
          conversions: 8,
          ctr: 4,
        },
      ];

      // Mock Repo Responses
      (campaignsRepo.findByYandexId as jest.Mock).mockResolvedValue({
        id: 'internal-123',
        yandex_id: '123',
        name: 'Test Campaign',
      });

      // Call private method
      const result = await (orchestrator as any).prepareCampaignData(currentStats, previousStats);

      // Verify
      expect(result).toHaveLength(1);
      expect(result[0].campaignId).toBe('123');
      expect(result[0].stats[0].cpa).toBe(100); // 500 / 5
      expect(result[0].previousPeriodStats).toBeDefined();
      expect(result[0].previousPeriodStats?.impressions).toBe(2000);
      expect(result[0].previousPeriodStats?.ctr).toBe(4); // (80 / 2000) * 100
    });

    it('should handle zero conversions (avoid division by zero)', async () => {
      const currentStats = [
        {
          campaignId: '123',
          campaignName: 'Test Campaign',
          date: '2023-10-01',
          impressions: 1000,
          clicks: 50,
          cost: 500,
          conversions: 0,
          ctr: 5,
          avgCpc: 10,
        },
      ];

      (campaignsRepo.findByYandexId as jest.Mock).mockResolvedValue({
        id: 'internal-123',
        yandex_id: '123',
        name: 'Test Campaign',
      });

      const result = await (orchestrator as any).prepareCampaignData(currentStats, []);

      expect(result[0].stats[0].cpa).toBeUndefined();
    });
  });

  describe('executeAction', () => {
    it('should execute valid action', async () => {
      const actionId = 'action-123';
      const mockAction = {
        id: actionId,
        created_at: new Date(), // Fresh action
        campaign_id: 'camp-123',
        action_type: 'UPDATE_BID',
      };

      (actionsRepo.findById as jest.Mock).mockResolvedValue(mockAction);

      await orchestrator.executeAction(actionId);

      // Check if actionManager.executeAction was called
      expect(mockActionManagerInstance.executeAction).toHaveBeenCalledWith(actionId);
    });

    it('should reject expired action (>24h)', async () => {
      const actionId = 'action-old';
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 2); // 2 days ago

      const mockAction = {
        id: actionId,
        created_at: yesterday,
        campaign_id: 'camp-123',
        action_type: 'UPDATE_BID',
      };

      (actionsRepo.findById as jest.Mock).mockResolvedValue(mockAction);

      // Expect it to throw error
      await expect(orchestrator.executeAction(actionId)).rejects.toThrow(
        'Срок действия этого предложения истёк'
      );

      // Check if rejectAction was called
      expect(mockActionManagerInstance.rejectAction).toHaveBeenCalledWith(actionId);
      expect(mockActionManagerInstance.executeAction).not.toHaveBeenCalled();
    });
  });

  describe('generateDailyReport', () => {
    it('should generate report and save stats', async () => {
      // Mock Yandex stats
      mockYandex.getStats.mockResolvedValue([
        {
          campaignId: '123',
          campaignName: 'Test',
          date: '2023-10-01',
          impressions: 100,
          clicks: 10,
          cost: 100,
          conversions: 1,
        },
      ]);

      // Mock DB responses
      (campaignsRepo.upsertFromYandex as jest.Mock).mockResolvedValue({ id: 'db-123' });
      (dailyStatsRepo.findAllByDateRange as jest.Mock).mockResolvedValue([]);
      (campaignsRepo.findByYandexId as jest.Mock).mockResolvedValue({ id: 'db-123', name: 'Test' });

      // Mock AI response with description for markdown escaping
      mockAI.analyze.mockResolvedValue({
        text: 'Report text',
        recommendations: [{ id: 'rec1', title: 'Rec 1', description: 'Desc 1' }],
        proposedActions: [],
        insights: [],
      });

      const result = await orchestrator.generateDailyReport(true);

      // Verify Yandex call
      expect(mockYandex.getStats).toHaveBeenCalled();

      // Verify DB save
      expect(dailyStatsRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          campaign_id: 'db-123',
          clicks: 10,
        })
      );

      // Verify AI call
      expect(mockAI.analyze).toHaveBeenCalled();

      // Verify Telegram sending
      expect(mockTelegram.sendReport).toHaveBeenCalledWith(
        expect.stringContaining('Report text'),
        expect.any(Array)
      );

      // Verify result return
      expect(result.text).toContain('Report text');
    });
  });
});
