const express = require('express');
const cors = require('cors');
require('dotenv').config();

const webhookRoutes = require('./routes/webhook');
const dashboardRoutes = require('./routes/dashboard.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const reminderService = require('./services/reminderService');
const nudgeService = require('./services/nudgeService');
const insightService = require('./services/insightService');
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use('/api', webhookRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/onboarding', onboardingRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// Endpoint para cron job de lembretes
app.get('/api/cron/reminders', async (req, res) => {
  try {
    // Verifica secret key para segurança (opcional, mas recomendado)
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[CRON] Iniciando verificação de lembretes e nudges...');
    const reminders = await reminderService.checkAndSendReminders();
    const nudges = await nudgeService.checkAndSendNudges();
    const insights = await insightService.generateDailyInsights();

    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      reminders_sent: reminders.length,
      nudge_sent: nudges.length,
      insights_generated: insights.length,
      reminders,
      nudges,
      insights
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

app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

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
}

module.exports = app;
module.exports.server = server;
