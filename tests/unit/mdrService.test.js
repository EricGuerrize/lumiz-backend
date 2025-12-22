/**
 * Unit tests for MdrService
 * Tests MDR configuration and OCR functionality
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';

const mdrService = require('../../src/services/mdrService');

// Mock dependencies
jest.mock('../../src/db/supabase', () => ({
  from: jest.fn(() => ({
    insert: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ 
          data: { id: 'test-config-id' }, 
          error: null 
        }))
      }))
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ data: null, error: null }))
    }))
  }))
}));

jest.mock('../../src/services/mdrOcrService', () => ({
  extractRates: jest.fn(() => Promise.resolve({
    bandeiras: ['Visa', 'Mastercard'],
    tipos_venda: { debito: 1.5, credito: 2.5 }
  }))
}));

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
      ).rejects.toThrow();
    });
  });

  describe('requestOcr', () => {
    it('should create OCR job', async () => {
      const result = await mdrService.requestOcr({
        phone: TEST_PHONE,
        userId: TEST_USER_ID,
        imageUrl: 'https://example.com/image.jpg',
        provider: 'Stone'
      });

      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });

    it('should throw error if imageUrl is missing', async () => {
      await expect(
        mdrService.requestOcr({
          phone: TEST_PHONE,
          userId: TEST_USER_ID
        })
      ).rejects.toThrow();
    });
  });
});

// Simple test runner if Jest is not available
if (typeof describe === 'undefined') {
  console.log('⚠️  Jest not available. Install Jest to run unit tests: npm install --save-dev jest');
  console.log('   Run tests with: npm test');
}
