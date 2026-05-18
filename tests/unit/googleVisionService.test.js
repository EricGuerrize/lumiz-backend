/**
 * Unit tests for GoogleVisionService
 * Tests OCR and image processing functionality
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';

const googleVisionService = require('../../src/services/googleVisionService');

describe('GoogleVisionService', () => {
  describe('instance', () => {
    it('should be an initialized service instance', () => {
      expect(googleVisionService).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should expose isAvailable as a boolean', () => {
      expect(typeof googleVisionService.isAvailable).toBe('boolean');
    });
  });

  describe('processImage', () => {
    it('should throw error if service is not configured', async () => {
      if (!googleVisionService.isAvailable) {
        await expect(
          googleVisionService.processImage(Buffer.from('test'), 'image/jpeg')
        ).rejects.toThrow();
      }
    });
  });
});
