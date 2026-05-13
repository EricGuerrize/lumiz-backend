/**
 * Unit tests for MdrService
 * Tests MDR configuration and OCR functionality
 */

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    insert: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() =>
          Promise.resolve({
            data: { id: 'test-config-id' },
            error: null
          })
        )
      }))
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ data: null, error: null }))
    }))
  }))
}));

jest.mock('../../src/services/mdrOcrService', () => ({
  extractRates: jest.fn(() =>
    Promise.resolve({
      provider: 'stone',
      bandeiras: ['Visa', 'Mastercard'],
      tiposVenda: { debito: 1.5, credito: 2.5 },
      parcelas: {}
    })
  )
}));

jest.mock('../../src/services/cacheService', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn(),
  invalidateUser: jest.fn(),
  invalidatePhone: jest.fn()
}));

jest.mock('../../src/services/evolutionService', () => ({
  sendMessage: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/onboardingService', () => ({
  savePhaseData: jest.fn().mockResolvedValue(true),
  updateStepStatus: jest.fn().mockResolvedValue(true)
}));

require('dotenv').config();
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;
process.env.REDIS_CACHE_ENABLED = 'false';
process.env.REDIS_QUEUE_ENABLED = 'false';

const mdrService = require('../../src/services/mdrService');

describe('MdrService', () => {
  const TEST_PHONE = '5511999999999';
  const TEST_USER_ID = 'test-user-id';

  describe('saveManualConfig', () => {
    it('should save manual MDR configuration', async () => {
      const config = await mdrService.saveManualConfig({
        phone: TEST_PHONE,
        userId: TEST_USER_ID,
        bandeiras: ['Visa', 'Mastercard'],
        tiposVenda: { debito: 1.5 },
        parcelas: { '1x': 2.0 },
        provider: 'Stone'
      });

      expect(config).toBeDefined();
      expect(config.id).toBe('test-config-id');
    });

    it('should handle missing bandeiras', async () => {
      await expect(
        mdrService.saveManualConfig({
          phone: TEST_PHONE,
          userId: TEST_USER_ID,
          bandeiras: []
        })
      ).rejects.toThrow(/bandeira/i);
    });
  });

  describe('requestOcr', () => {
    it('should complete OCR inline when queue disabled', async () => {
      const result = await mdrService.requestOcr({
        phone: TEST_PHONE,
        userId: TEST_USER_ID,
        imageUrl: 'https://example.com/image.jpg',
        provider: 'Stone'
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('completed');
      expect(result.job).toBeDefined();
      expect(result.job.id).toBe('test-config-id');
    });

    it('should throw error if imageUrl is missing', async () => {
      await expect(
        mdrService.requestOcr({
          phone: TEST_PHONE,
          userId: TEST_USER_ID
        })
      ).rejects.toThrow(/imageUrl/i);
    });
  });
});
