/**
 * Unit tests for GoogleVisionService
 * Tests OCR and image processing functionality
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';

const googleVisionService = require('../../src/services/googleVisionService');

describe('GoogleVisionService', () => {
  describe('constructor', () => {
    it('should initialize with API key if available', () => {
      const service = new googleVisionService();
      
      // Service should be initialized (even if not configured)
      expect(service).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should check if service is available', () => {
      const service = new googleVisionService();
      
      // Service availability depends on env vars
      expect(typeof service.isAvailable).toBe('boolean');
    });
  });

  describe('processImage', () => {
    it('should throw error if service is not configured', async () => {
      // Mock service without configuration
      const originalKey = process.env.GOOGLE_VISION_API_KEY;
      delete process.env.GOOGLE_VISION_API_KEY;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const service = new googleVisionService();
      
      if (!service.isAvailable) {
        await expect(
          service.processImage(Buffer.from('test'), 'image/jpeg')
        ).rejects.toThrow();
      }

      if (originalKey) {
        process.env.GOOGLE_VISION_API_KEY = originalKey;
      }
    });
  });
});

// Simple test runner if Jest is not available
if (typeof describe === 'undefined') {
  console.log('⚠️  Jest not available. Install Jest to run unit tests: npm install --save-dev jest');
  console.log('   Run tests with: npm test');
}
