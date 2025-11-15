const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const userController = require('../controllers/userController');

// Middleware simples de autenticação por telefone
const authenticateByPhone = async (req, res, next) => {
  try {
    const phone = req.headers['x-user-phone'];

    if (!phone) {
      return res.status(401).json({ error: 'Phone number required in x-user-phone header' });
    }

    const user = await userController.findOrCreateUser(phone);
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Aplica autenticação em todas as rotas
router.use(authenticateByPhone);

// GET /api/dashboard/summary - Resumo geral (cards principais)
router.get('/summary', async (req, res) => {
  try {
    const balance = await transactionController.getBalance(req.user.id);

    const lucro = balance.entradas - balance.saidas;
    const margemPercentual = balance.entradas > 0
      ? ((lucro / balance.entradas) * 100).toFixed(1)
      : 0;

    res.json({
      receitas: balance.entradas,
      custos: balance.saidas,
      lucro: lucro,
      margemLucro: parseFloat(margemPercentual),
      saldo: balance.saldo
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// GET /api/dashboard/transactions?limit=10 - Transações recentes
router.get('/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const transactions = await transactionController.getRecentTransactions(req.user.id, limit);

    // Formata as transações para o dashboard
    const formatted = transactions.map(t => ({
      id: t.id,
      tipo: t.type,
      valor: parseFloat(t.amount),
      categoria: t.categories?.name || 'Sem categoria',
      descricao: t.description,
      data: t.date,
      emoji: t.type === 'entrada' ? '💰' : '💸'
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

// GET /api/dashboard/monthly-report?year=2025&month=11 - Relatório mensal
router.get('/monthly-report', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || now.getMonth() + 1;

    const report = await transactionController.getMonthlyReport(req.user.id, year, month);

    const lucro = report.entradas - report.saidas;
    const margemPercentual = report.entradas > 0
      ? ((lucro / report.entradas) * 100).toFixed(1)
      : 0;

    res.json({
      periodo: report.periodo,
      receitas: report.entradas,
      custos: report.saidas,
      lucro: lucro,
      margemLucro: parseFloat(margemPercentual),
      totalMovimentacoes: report.totalTransacoes,
      categorias: report.porCategoria,
      transacoes: report.transacoes.map(t => ({
        id: t.id,
        tipo: t.type,
        valor: parseFloat(t.amount),
        categoria: t.categories?.name || 'Sem categoria',
        descricao: t.description,
        data: t.date
      }))
    });
  } catch (error) {
    console.error('Error getting monthly report:', error);
    res.status(500).json({ error: 'Failed to get monthly report' });
  }
});

// GET /api/dashboard/categories - Lista de categorias do usuário
router.get('/categories', async (req, res) => {
  try {
    const categories = await userController.getUserCategories(req.user.id);

    res.json(categories);
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// GET /api/dashboard/stats/by-category - Estatísticas por categoria
router.get('/stats/by-category', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || now.getMonth() + 1;

    const report = await transactionController.getMonthlyReport(req.user.id, year, month);

    // Separa receitas e custos
    const receitas = [];
    const custos = [];

    Object.entries(report.porCategoria).forEach(([categoria, data]) => {
      const item = {
        categoria,
        valor: data.total,
        tipo: data.tipo
      };

      if (data.tipo === 'entrada') {
        receitas.push(item);
      } else {
        custos.push(item);
      }
    });

    // Ordena por valor (maior primeiro)
    receitas.sort((a, b) => b.valor - a.valor);
    custos.sort((a, b) => b.valor - a.valor);

    res.json({
      receitas: receitas.slice(0, 10), // Top 10
      custos: custos.slice(0, 10) // Top 10
    });
  } catch (error) {
    console.error('Error getting category stats:', error);
    res.status(500).json({ error: 'Failed to get category stats' });
  }
});

// GET /api/dashboard/stats/timeline - Dados para gráfico de linha temporal
router.get('/stats/timeline', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || now.getMonth() + 1;

    const report = await transactionController.getMonthlyReport(req.user.id, year, month);

    // Agrupa por dia
    const timeline = {};

    report.transacoes.forEach(t => {
      const date = t.date;
      if (!timeline[date]) {
        timeline[date] = {
          data: date,
          receitas: 0,
          custos: 0,
          lucro: 0
        };
      }

      const valor = parseFloat(t.amount);
      if (t.type === 'entrada') {
        timeline[date].receitas += valor;
      } else {
        timeline[date].custos += valor;
      }
      timeline[date].lucro = timeline[date].receitas - timeline[date].custos;
    });

    // Converte para array e ordena por data
    const timelineArray = Object.values(timeline).sort((a, b) =>
      new Date(a.data) - new Date(b.data)
    );

    res.json(timelineArray);
  } catch (error) {
    console.error('Error getting timeline:', error);
    res.status(500).json({ error: 'Failed to get timeline' });
  }
});

// GET /api/dashboard/user - Informações do usuário
router.get('/user', async (req, res) => {
  try {
    res.json({
      id: req.user.id,
      phone: req.user.phone,
      createdAt: req.user.created_at
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

module.exports = router;
