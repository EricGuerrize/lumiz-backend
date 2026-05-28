// IMPORTANT: Make sure to import `instrument.js` at the top of your file.
require('./instrument');

/**
 * Fase 16 — Worker de filas assíncronas.
 *
 * Processo dedicado para consumir jobs BullMQ fora do servidor HTTP.
 * Mantém o webhook do WhatsApp responsivo enquanto OCR, MDR e exports rodam
 * em background pelo Redis.
 */

require('dotenv').config();
const Sentry = require('@sentry/node');

function readFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

const { validate } = require('./config/env');

try {
  validate();
  console.log('[WORKER] ✅ Variáveis de ambiente validadas');
} catch (error) {
  console.error('[WORKER] ❌ Erro na validação de variáveis de ambiente:', error.message);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

if (!process.env.REDIS_URL) {
  console.error('[WORKER] ❌ REDIS_URL não configurada. Worker não pode iniciar.');
  process.exit(1);
}

const redisQueueEnabled = readFlag('REDIS_QUEUE_ENABLED', !!process.env.REDIS_URL);
const queueWorkerEnabled = readFlag('QUEUE_WORKER_ENABLED', true);

if (!redisQueueEnabled || !queueWorkerEnabled) {
  console.error(
    `[WORKER] ❌ Configuração inválida: REDIS_QUEUE_ENABLED=${redisQueueEnabled}, ` +
    `QUEUE_WORKER_ENABLED=${queueWorkerEnabled}`
  );
  process.exit(1);
}

console.log('[WORKER] Inicializando consumidores de fila...');

const services = [
  require('./services/mdrService'),
  require('./services/documentQueueService'),
  require('./services/pdfQueueService')
];

console.log('[WORKER] ✅ Worker iniciado: mdr-ocr, document-processing, pdf-generation');

const shutdown = async (signal) => {
  console.log(`[WORKER] Recebido ${signal}, encerrando filas...`);

  for (const service of services) {
    try {
      if (service.worker) {
        await service.worker.close();
      }
      if (service.queue) {
        await service.queue.close();
      }
      if (service.connection) {
        await service.connection.quit();
      }
    } catch (error) {
      console.warn('[WORKER] Falha ao fechar serviço de fila:', error?.message || error);
    }
  }

  try {
    const posthogService = require('./services/posthogService');
    await posthogService.shutdown();
  } catch (error) {
    console.warn('[WORKER] Falha ao desligar PostHog:', error?.message || error);
  }

  if (process.env.SENTRY_DSN) {
    await Sentry.flush(2000);
  }

  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

