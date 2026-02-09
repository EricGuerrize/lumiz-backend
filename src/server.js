const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const Sentry = require('@sentry/node');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

// Valida variáveis de ambiente na startup
const { validate } = require('./config/env');
try {
  validate();
  console.log('[SERVER] ✅ Variáveis de ambiente validadas');
} catch (error) {
  console.error('[SERVER] ❌ Erro na validação de variáveis de ambiente:', error.message);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const webhookRoutes = require('./routes/webhook');
const dashboardRoutes = require('./routes/dashboard.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const userRoutes = require('./routes/user.routes');
const setupRoutes = require('./routes/setup.routes');
const authRoutes = require('./routes/auth.routes');
const reminderService = require('./services/reminderService');
const nudgeService = require('./services/nudgeService');
const insightService = require('./services/insightService');

// Inicializa Sentry se DSN estiver configurado
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV || 'development'
  });
  console.log('[SERVER] Sentry inicializado');
}

// Cron Job para limpeza de tokens expirados (roda todo dia à meia-noite)
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Iniciando limpeza de tokens expirados...');
  try {
    const supabase = require('./db/supabase');
    const { error, count } = await supabase
      .from('setup_tokens')
      .delete({ count: 'exact' })
      .lt('expira_em', new Date().toISOString());

    if (error) throw error;
    console.log(`[CRON] Limpeza concluída. ${count || 0} tokens removidos.`);

  } catch (error) {
    console.error('[CRON] Erro ao limpar tokens:', error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
  }
});
// Garante que mdrService seja inicializado na startup para ativar BullMQ
console.log('[SERVER] Carregando mdrService...');
try {
  const mdrService = require('./services/mdrService');
  console.log('[SERVER] ✅ mdrService carregado e inicializado');
} catch (error) {
  console.error('[SERVER] ❌ Erro ao carregar mdrService:', error.message);
  console.error('[SERVER] Stack:', error.stack);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Segurança e Performance
app.use(helmet());
app.use(compression());
console.log('[SERVER] Middleware de segurança (Helmet) e compressão (Gzip) ativados');

// Configura trust proxy de forma segura
// Railway, Heroku, AWS ELB, Cloudflare usam proxies específicos
// Em vez de confiar em todos (true), confiamos apenas em proxies conhecidos
if (process.env.NODE_ENV === 'production') {
  // Em produção, confia apenas no primeiro proxy (Railway, Heroku, etc)
  // Isso previne bypass do rate limiting enquanto permite funcionar atrás de proxies legítimos
  app.set('trust proxy', 1);
  console.log('[SERVER] Trust proxy configurado: 1 (apenas primeiro proxy)');
} else {
  // Em desenvolvimento, pode confiar em todos se necessário
  app.set('trust proxy', true);
  console.log('[SERVER] Trust proxy configurado: true (desenvolvimento)');
}

// Configuração CORS para permitir o frontend
const allowedOrigins = [
  'https://lumiz-financeiro.vercel.app',
  'http://localhost:5173'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-phone']
}));

// Rate limiting - proteção contra spam/abuse
// Configuração segura que funciona mesmo com trust proxy
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requisições por IP por janela
  message: 'Muitas requisições deste IP, tente novamente em alguns minutos.',
  standardHeaders: true,
  legacyHeaders: false,
  // Garante que usa o IP correto mesmo com proxy
  keyGenerator: (req) => {
    // Tenta pegar o IP real do header X-Forwarded-For ou usa req.ip
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // Pega o primeiro IP da lista (IP real do cliente)
      const ip = forwarded.split(',')[0].trim();
      return ip;
    }
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
});

// Rate limiting mais restritivo para webhook (pode receber muitas mensagens)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // máximo 30 mensagens por minuto por IP
  message: 'Muitas mensagens recebidas, aguarde um momento.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
console.log('[SERVER] Rate limiting por IP configurado (100 req/15min por IP)');

// Rate limiting por usuário (além de IP) para rotas autenticadas
let userRateLimit;
try {
  userRateLimit = require('./middleware/userRateLimit');
  app.use('/api/dashboard', userRateLimit.middleware({ windowMs: 15 * 60 * 1000, max: 200 }));
  app.use('/api/onboarding', userRateLimit.middleware({ windowMs: 15 * 60 * 1000, max: 150 }));
  console.log('[SERVER] Rate limiting por usuário configurado (além de IP)');
} catch (error) {
  console.warn('[SERVER] ⚠️ Rate limiting por usuário não disponível:', error.message);
  console.warn('[SERVER] Continuando sem rate limiting por usuário (usando apenas por IP)');
}

// Aumenta limite para aceitar imagens grandes no webhook
const jsonLimit = '10mb';
app.use(express.json({ limit: jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonLimit }));
console.log(`[SERVER] Body parser configurado com limite de ${jsonLimit}`);

// Logger estruturado
const { logger, createLogger } = require('./config/logger');
const appLogger = createLogger('HTTP');

// Logging de requisições (estruturado)
app.use((req, res, next) => {
  appLogger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.id || null
  });
  next();
});

app.use('/api', webhookRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/user', userRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);

app.get('/health', async (req, res) => {
  const startTime = Date.now();
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    checks: {
      database: { status: 'unknown', latency: null },
      redis: { status: 'unknown', latency: null },
      evolution: { status: 'unknown', latency: null },
      cache: { status: 'unknown', latency: null }
    },
    version: require('../package.json').version
  };

  let criticalFailures = 0;

  // Verifica Supabase (crítico)
  try {
    const dbStart = Date.now();
    const supabase = require('./db/supabase');
    const { error: dbError } = await supabase.from('profiles').select('id').limit(1);
    const dbLatency = Date.now() - dbStart;
    
    if (dbError) {
      health.checks.database = { status: 'error', latency: dbLatency, error: dbError.message };
      criticalFailures++;
      health.status = 'degraded';
    } else {
      health.checks.database = { status: 'ok', latency: dbLatency };
    }
  } catch (error) {
    health.checks.database = { status: 'error', latency: null, error: error.message };
    criticalFailures++;
    health.status = 'degraded';
  }

  // Verifica Redis/Cache (opcional)
  try {
    const cacheStart = Date.now();
    const cacheService = require('./services/cacheService');
    if (cacheService.enabled) {
      await cacheService.get('health_check_test');
      const cacheLatency = Date.now() - cacheStart;
      health.checks.cache = { status: 'ok', latency: cacheLatency };
    } else {
      health.checks.cache = { status: 'not_configured', latency: null };
    }
  } catch (error) {
    health.checks.cache = { status: 'error', latency: null, error: error.message };
  }

  // Verifica BullMQ/Redis (opcional)
  try {
    const mdrService = require('./services/mdrService');
    if (mdrService.queueEnabled) {
      health.checks.redis = { status: 'ok', latency: null };
    } else {
      health.checks.redis = { status: 'not_configured', latency: null };
    }
  } catch (error) {
    health.checks.redis = { status: 'error', latency: null, error: error.message };
  }

  // Verifica Evolution API (crítico)
  try {
    const evolutionStart = Date.now();
    const evolutionService = require('./services/evolutionService');
    await Promise.race([
      evolutionService.getInstanceStatus(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]);
    const evolutionLatency = Date.now() - evolutionStart;
    health.checks.evolution = { status: 'ok', latency: evolutionLatency };
  } catch (error) {
    const evolutionLatency = error.message === 'timeout' ? 5000 : null;
    health.checks.evolution = { status: 'error', latency: evolutionLatency, error: error.message };
    criticalFailures++;
    health.status = 'degraded';
  }

  // Calcula latência total
  health.totalLatency = Date.now() - startTime;

  // Status final
  if (criticalFailures > 0) {
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Endpoint para cron job de lembretes
app.get('/api/cron/reminders', async (req, res) => {
  try {
    // Verifica secret key para segurança (opcional, mas recomendado)
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[CRON] Iniciando verificação de lembretes, nudges, insights e DDA...');
    const reminders = await reminderService.checkAndSendReminders();
    const nudges = await nudgeService.checkAndSendNudges();
    const insights = await insightService.generateDailyInsights();

    // Consulta DDA (boletos automáticos) - apenas se configurado
    let ddaResults = [];
    try {
      const ddaService = require('./services/ddaService');
      ddaResults = await ddaService.executarConsultaAutomatica();
    } catch (error) {
      console.log('[CRON] DDA não configurado ou erro:', error.message);
    }

    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      reminders_sent: reminders.length,
      nudge_sent: nudges.length,
      insights_generated: insights.length,
      dda_consultas: ddaResults.length,
      reminders,
      nudges,
      insights,
      dda_results: ddaResults
    });
  } catch (error) {
    console.error('[CRON] Erro:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    name: 'Lumiz Backend',
    version: '1.3.0',
    status: 'running',
    endpoints: {
      webhook: '/api/webhook',
      test: '/api/test',
      health: '/health',
      cron: {
        reminders: '/api/cron/reminders'
      },
      dashboard: {
        summary: '/api/dashboard/summary',
        transactions: '/api/dashboard/transactions',
        transactionsSearch: '/api/dashboard/transactions/search',
        transactionUpdate: 'PUT /api/dashboard/transactions/:id',
        transactionDelete: 'DELETE /api/dashboard/transactions/:id',
        monthlyReport: '/api/dashboard/monthly-report',
        categories: '/api/dashboard/categories',
        statsByCategory: '/api/dashboard/stats/by-category',
        timeline: '/api/dashboard/stats/timeline',
        comparison: '/api/dashboard/stats/comparison',
        averages: '/api/dashboard/stats/averages',
        kpis: '/api/dashboard/stats/kpis',
        user: '/api/dashboard/user'
      },
      auth: {
        note: 'Use Authorization: Bearer <supabase_token> or x-user-phone header'
      }
    }
  });
});

// Global error handler (must be last middleware)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║         LUMIZ BACKEND STARTED          ║
╚════════════════════════════════════════╝

Server running on port ${PORT}
Environment: ${process.env.NODE_ENV || 'development'}
Evolution API: ${process.env.EVOLUTION_API_URL}
Supabase: ${process.env.SUPABASE_URL ? 'Connected' : 'Not configured'}

Endpoints:
  - Webhook: http://localhost:${PORT}/api/webhook
  - Test: http://localhost:${PORT}/api/test
  - Health: http://localhost:${PORT}/health
  - Dashboard: http://localhost:${PORT}/api/dashboard/*
  `);
  });

  // Graceful shutdown - fecha conexões adequadamente
  const gracefulShutdown = (signal) => {
    console.log(`\n[SHUTDOWN] Recebido ${signal}, iniciando graceful shutdown...`);

    server.close(() => {
      console.log('[SHUTDOWN] Servidor HTTP fechado');

      // Fecha conexões do BullMQ/Redis se existirem
      try {
        const mdrService = require('./services/mdrService');
        if (mdrService.connection) {
          mdrService.connection.quit();
          console.log('[SHUTDOWN] Conexão Redis fechada');
        }
      } catch (error) {
        // Ignora se não houver conexão
      }

      console.log('[SHUTDOWN] Processo finalizado');
      process.exit(0);
    });

    // Força shutdown após 10 segundos
    setTimeout(() => {
      console.error('[SHUTDOWN] Forçando shutdown após timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Trata erros não capturados
  process.on('uncaughtException', (error) => {
    console.error('[FATAL] Erro não capturado:', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Promise rejeitada não tratada:', reason);
    gracefulShutdown('unhandledRejection');
  });
}

module.exports = app;
module.exports.server = server;
