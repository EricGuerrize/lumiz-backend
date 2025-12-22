const { z } = require('zod');

/**
 * Middleware factory for Zod validation
 * Validates request body, query, and params based on the provided schema
 * 
 * @param {z.ZodSchema} schema - Zod schema with optional body, query, and params properties
 * @returns {Function} Express middleware function
 */
const validate = (schema) => {
  return async (req, res, next) => {
    try {
      // Create a validation object with the parts we want to validate
      const validationData = {};
      
      // Check if schema has shape (ZodObject) or _def (for nested objects)
      const hasBody = schema.shape?.body || schema._def?.shape?.body;
      const hasQuery = schema.shape?.query || schema._def?.shape?.query;
      const hasParams = schema.shape?.params || schema._def?.shape?.params;
      
      if (hasBody) {
        validationData.body = req.body;
      }
      if (hasQuery) {
        validationData.query = req.query;
      }
      if (hasParams) {
        validationData.params = req.params;
      }

      // If no validation parts found, skip validation (schema might be empty/optional)
      if (Object.keys(validationData).length === 0 && !schema.shape && !schema._def) {
        return next();
      }

      // Validate the data
      const validated = await schema.parseAsync(validationData);

      // Replace request data with validated data
      if (validated.body) {
        req.body = validated.body;
      }
      if (validated.query) {
        req.query = validated.query;
      }
      if (validated.params) {
        req.params = validated.params;
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Format Zod errors into a user-friendly response
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message
        }));

        return res.status(400).json({
          error: 'Validation error',
          details: errors
        });
      }

      // If it's not a Zod error, pass it to the error handler
      next(error);
    }
  };
};

module.exports = { validate };
