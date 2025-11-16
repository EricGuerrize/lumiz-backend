const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const userController = require('../controllers/userController');
const { authenticateFlexible } = require('../middleware/authMiddleware');

// Aplica autenticação em todas as rotas (aceita JWT ou telefone)
router.use(authenticateFlexible);

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
      nome: req.user.nome_completo,
      clinica: req.user.nome_clinica,
      phone: req.user.telefone,
      createdAt: req.user.created_at
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// GET /api/dashboard/transactions/search - Busca transações com filtros
router.get('/transactions/search', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      tipo,
      categoria,
      minValue,
      maxValue,
      limit = 50,
      offset = 0
    } = req.query;

    const filters = {
      startDate,
      endDate,
      tipo,
      categoria,
      minValue: minValue ? parseFloat(minValue) : null,
      maxValue: maxValue ? parseFloat(maxValue) : null,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const result = await transactionController.searchTransactions(req.user.id, filters);

    res.json(result);
  } catch (error) {
    console.error('Error searching transactions:', error);
    res.status(500).json({ error: 'Failed to search transactions' });
  }
});

// PUT /api/dashboard/transactions/:id - Atualizar transação
router.put('/transactions/:id', async (req, res) => {
  try {
    const transactionId = req.params.id;
    const updateData = req.body;

    const updated = await transactionController.updateTransaction(
      req.user.id,
      transactionId,
      updateData
    );

    if (!updated) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    res.json({
      message: 'Transação atualizada com sucesso',
      transaction: updated
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// DELETE /api/dashboard/transactions/:id - Excluir transação
router.delete('/transactions/:id', async (req, res) => {
  try {
    const transactionId = req.params.id;

    const deleted = await transactionController.deleteTransaction(
      req.user.id,
      transactionId
    );

    if (!deleted) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    res.json({
      message: 'Transação excluída com sucesso',
      transactionId: transactionId
    });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// GET /api/dashboard/stats/comparison - Comparativo mês atual vs anterior
router.get('/stats/comparison', async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Mês anterior
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = currentYear - 1;
    }

    const [current, previous] = await Promise.all([
      transactionController.getMonthlyReport(req.user.id, currentYear, currentMonth),
      transactionController.getMonthlyReport(req.user.id, prevYear, prevMonth)
    ]);

    const currentLucro = current.entradas - current.saidas;
    const previousLucro = previous.entradas - previous.saidas;

    // Calcula variação percentual
    const calcVariacao = (atual, anterior) => {
      if (anterior === 0) return atual > 0 ? 100 : 0;
      return ((atual - anterior) / anterior * 100).toFixed(1);
    };

    res.json({
      mesAtual: {
        periodo: current.periodo,
        receitas: current.entradas,
        custos: current.saidas,
        lucro: currentLucro,
        transacoes: current.totalTransacoes
      },
      mesAnterior: {
        periodo: previous.periodo,
        receitas: previous.entradas,
        custos: previous.saidas,
        lucro: previousLucro,
        transacoes: previous.totalTransacoes
      },
      variacao: {
        receitas: parseFloat(calcVariacao(current.entradas, previous.entradas)),
        custos: parseFloat(calcVariacao(current.saidas, previous.saidas)),
        lucro: parseFloat(calcVariacao(currentLucro, previousLucro)),
        transacoes: parseFloat(calcVariacao(current.totalTransacoes, previous.totalTransacoes))
      }
    });
  } catch (error) {
    console.error('Error getting comparison:', error);
    res.status(500).json({ error: 'Failed to get comparison' });
  }
});

// GET /api/dashboard/stats/averages - Médias e métricas avançadas
router.get('/stats/averages', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || now.getMonth() + 1;

    const report = await transactionController.getMonthlyReport(req.user.id, year, month);

    // Filtra vendas e custos
    const vendas = report.transacoes.filter(t => t.type === 'entrada');
    const custos = report.transacoes.filter(t => t.type === 'saida');

    // Calcula ticket médio
    const ticketMedioVenda = vendas.length > 0
      ? vendas.reduce((sum, t) => sum + parseFloat(t.amount), 0) / vendas.length
      : 0;

    const ticketMedioCusto = custos.length > 0
      ? custos.reduce((sum, t) => sum + parseFloat(t.amount), 0) / custos.length
      : 0;

    // Maior venda
    const maiorVenda = vendas.length > 0
      ? Math.max(...vendas.map(t => parseFloat(t.amount)))
      : 0;

    // Maior custo
    const maiorCusto = custos.length > 0
      ? Math.max(...custos.map(t => parseFloat(t.amount)))
      : 0;

    // Dias com mais vendas
    const vendasPorDia = {};
    vendas.forEach(t => {
      const dia = new Date(t.date).toLocaleDateString('pt-BR', { weekday: 'long' });
      vendasPorDia[dia] = (vendasPorDia[dia] || 0) + 1;
    });

    const melhorDia = Object.entries(vendasPorDia)
      .sort((a, b) => b[1] - a[1])[0];

    res.json({
      periodo: report.periodo,
      ticketMedio: {
        vendas: parseFloat(ticketMedioVenda.toFixed(2)),
        custos: parseFloat(ticketMedioCusto.toFixed(2))
      },
      maiorVenda: maiorVenda,
      maiorCusto: maiorCusto,
      totalVendas: vendas.length,
      totalCustos: custos.length,
      melhorDiaSemana: melhorDia ? melhorDia[0] : 'Sem dados',
      vendasPorDia: vendasPorDia
    });
  } catch (error) {
    console.error('Error getting averages:', error);
    res.status(500).json({ error: 'Failed to get averages' });
  }
});

// GET /api/dashboard/stats/kpis - KPIs principais
router.get('/stats/kpis', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || now.getMonth() + 1;

    const report = await transactionController.getMonthlyReport(req.user.id, year, month);

    const lucro = report.entradas - report.saidas;
    const margemLucro = report.entradas > 0
      ? (lucro / report.entradas * 100)
      : 0;

    // Dias no mês
    const diasNoMes = new Date(year, month, 0).getDate();
    const diaAtual = month === now.getMonth() + 1 ? now.getDate() : diasNoMes;

    // Média diária
    const mediaDiariaReceita = diaAtual > 0 ? report.entradas / diaAtual : 0;
    const mediaDiariaCusto = diaAtual > 0 ? report.saidas / diaAtual : 0;

    // Projeção para fim do mês
    const projecaoReceita = mediaDiariaReceita * diasNoMes;
    const projecaoCusto = mediaDiariaCusto * diasNoMes;
    const projecaoLucro = projecaoReceita - projecaoCusto;

    // ROI (Retorno sobre investimento)
    const roi = report.saidas > 0
      ? ((lucro / report.saidas) * 100)
      : 0;

    res.json({
      periodo: report.periodo,
      kpis: {
        receitas: report.entradas,
        custos: report.saidas,
        lucro: lucro,
        margemLucro: parseFloat(margemLucro.toFixed(1)),
        roi: parseFloat(roi.toFixed(1)),
        mediaDiariaReceita: parseFloat(mediaDiariaReceita.toFixed(2)),
        mediaDiariaCusto: parseFloat(mediaDiariaCusto.toFixed(2))
      },
      projecao: {
        receitas: parseFloat(projecaoReceita.toFixed(2)),
        custos: parseFloat(projecaoCusto.toFixed(2)),
        lucro: parseFloat(projecaoLucro.toFixed(2))
      },
      diasNoMes: diasNoMes,
      diaAtual: diaAtual
    });
  } catch (error) {
    console.error('Error getting KPIs:', error);
    res.status(500).json({ error: 'Failed to get KPIs' });
  }
});

module.exports = router;
