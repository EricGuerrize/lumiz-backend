const { AppError } = require('../errors/errors');
const { ZodError } = require('zod');

/**
 * Global error handler middleware
 * Handles all errors and sends appropriate responses
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error for debugging
  console.error('[ERROR]', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    body: process.env.NODE_ENV === 'development' ? req.body : undefined
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message
    }));

    return res.status(400).json({
      error: {
        message: 'Validation error',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        timestamp: new Date().toISOString(),
        details: errors
      }
    });
  }

  // Handle custom AppError instances
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Handle known error patterns
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        message: err.message || 'Validation error',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        timestamp: new Date().toISOString()
      }
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      error: {
        message: 'Invalid ID format',
        code: 'INVALID_ID',
        statusCode: 400,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Handle Supabase errors
  if (err.code && err.code.startsWith('PGRST')) {
    return res.status(400).json({
      error: {
        message: err.message || 'Database error',
        code: 'DATABASE_ERROR',
        statusCode: 400,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Handle errors with status property (from controllers)
  if (err.status) {
    return res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code || 'ERROR',
        statusCode: err.status,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Default to 500 server error
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Don't leak error details in production
  const errorResponse = {
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'An error occurred. Please try again later.' 
        : message,
      code: 'INTERNAL_SERVER_ERROR',
      statusCode,
      timestamp: new Date().toISOString()
    }
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;
