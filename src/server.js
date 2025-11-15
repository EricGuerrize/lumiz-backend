const express = require('express');
const cors = require('cors');
require('dotenv').config();

const webhookRoutes = require('./routes/webhook');
const dashboardRoutes = require('./routes/dashboard.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração CORS para permitir o Lovable
app.use(cors({
  origin: [
    'https://preview--lumiz-financeiro.lovable.app',
    'https://lumiz-financeiro.lovable.app',
    'http://localhost:3000',
    'http://localhost:5173' // Vite dev server
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-user-phone']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use('/api', webhookRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Lumiz Backend',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhook: '/api/webhook',
      test: '/api/test',
      health: '/health',
      dashboard: {
        summary: '/api/dashboard/summary',
        transactions: '/api/dashboard/transactions',
        monthlyReport: '/api/dashboard/monthly-report',
        categories: '/api/dashboard/categories',
        statsByCategory: '/api/dashboard/stats/by-category',
        timeline: '/api/dashboard/stats/timeline',
        user: '/api/dashboard/user'
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

app.listen(PORT, '0.0.0.0', () => {
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

module.exports = app;
