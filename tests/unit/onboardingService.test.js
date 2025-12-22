/**
 * Unit tests for OnboardingService
 * Tests critical onboarding functionality
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';

const onboardingService = require('../../src/services/onboardingService');

// Mock Supabase
jest.mock('../../src/db/supabase', () => {
  const mockData = {
    onboarding_progress: [],
    profiles: []
  };

  return {
    from: jest.fn((table) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: null, error: null }))
        })),
        single: jest.fn(() => Promise.resolve({ data: null, error: null }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ 
            data: { id: 'test-id', phone: '5511999999999' }, 
            error: null 
          }))
        }))
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ 
              data: { id: 'test-id', phone: '5511999999999' }, 
              error: null 
            }))
          }))
        }))
      }))
    }))
  };
});

describe('OnboardingService', () => {
  const TEST_PHONE = '5511999999999';

  describe('ensureState', () => {
    it('should create state if it does not exist', async () => {
      const state = await onboardingService.ensureState(TEST_PHONE);
      
      expect(state).toBeDefined();
      expect(state.phone).toBe(TEST_PHONE);
      expect(state.stage).toBeDefined();
      expect(state.phase).toBe(1);
    });

    it('should throw error if phone is missing', async () => {
      await expect(onboardingService.ensureState(null)).rejects.toThrow('PHONE_REQUIRED');
      await expect(onboardingService.ensureState('')).rejects.toThrow('PHONE_REQUIRED');
    });
  });

  describe('getDefaultSteps', () => {
    it('should return default steps blueprint', () => {
      const steps = onboardingService.getDefaultSteps();
      
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0].status).toBe('completed'); // First step should be completed
    });
  });

  describe('getDefaultData', () => {
    it('should return default data structure', () => {
      const data = onboardingService.getDefaultData();
      
      expect(data).toBeDefined();
      expect(data.phase1).toBeDefined();
      expect(data.phase2).toBeDefined();
      expect(data.phase3).toBeDefined();
      expect(data.realtime).toBeDefined();
    });
  });
});

// Simple test runner if Jest is not available
if (typeof describe === 'undefined') {
  console.log('⚠️  Jest not available. Install Jest to run unit tests: npm install --save-dev jest');
  console.log('   Run tests with: npm test');
}
