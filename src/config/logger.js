const pino = require('pino');

/**
 * Logger estruturado usando Pino
 * Substitui console.log/error/warn por logs estruturados em JSON
 */
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Sanitiza dados sensíveis
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.apiKey',
      '*.secret',
      '*.phone',
      '*.telefone',
      '*.email'
    ],
    remove: false // Mantém campo mas remove valor
  }
});

/**
 * Wrapper para facilitar migração de console.log
 */
const createLogger = (context = 'APP') => {
  return {
    debug: (message, data) => logger.debug({ context, ...data }, message),
    info: (message, data) => logger.info({ context, ...data }, message),
    warn: (message, data) => logger.warn({ context, ...data }, message),
    error: (message, error, data) => {
      if (error instanceof Error) {
        logger.error({ context, err: error, ...data }, message);
      } else {
        logger.error({ context, ...data, error }, message);
      }
    }
  };
};

module.exports = {
  logger,
  createLogger
};


