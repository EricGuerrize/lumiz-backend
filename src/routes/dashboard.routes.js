const express = require('express');
const multer = require('multer');
const router = express.Router();
const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');
const cashflowService = require('../services/cashflowService');
const simulatorService = require('../services/simulatorService');
const pricingIntelligenceService = require('../services/pricingIntelligenceService');
const emergencyModeService = require('../services/emergencyModeService');
const exportService = require('../services/exportService');
const estoqueService = require('../services/estoqueService');
const dashboardEstoqueService = require('../services/dashboardEstoqueService');
const outlookService = require('../services/outlookService');
const healthScoreService = require('../services/healthScoreService');
const inadimplenciaService = require('../services/inadimplenciaService');
const sazonalidadeService = require('../services/sazonalidadeService');
const procedimentoCustoService = require('../services/procedimentoCustoService');
const metaCaminhoService = require('../services/metaCaminhoService');
const colaboradorService = require('../services/colaboradorService');
const clientePerfilService = require('../services/clientePerfilService');
const margemAlertaService = require('../services/margemAlertaService');
const emailReportService = require('../services/emailReportService');
const excelService = require('../services/excelService');
const estoqueImportService = require('../services/estoqueImportService');
const importTemplateService = require('../services/importTemplateService');
const outboundMessageService = require('../services/outboundMessageService');
const excelImportWhatsappCopy = require('../copy/excelImportWhatsappCopy');
const estoqueImportWhatsappCopy = require('../copy/estoqueImportWhatsappCopy');
const supplierDocumentService = require('../services/supplierDocumentService');
const contasReceberService = require('../services/contasReceberService');
const alterRecebiveisService = require('../services/alter/alterRecebiveisService');
const antecipacaoService = require('../services/alter/antecipacaoService');
const alterAdapter = require('../services/alter/alterAdapter');
const coberturaFornecedorService = require('../services/alter/coberturaFornecedorService');
const pagarComRecebivelService = require('../services/alter/pagarComRecebivelService');
const { requireFeature } = require('../services/featureFlagService');
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const {
  monthlyReportSchema,
  searchTransactionsSchema,
  updateTransactionSchema,
  deleteTransactionSchema
} = require('../validators/dashboard.validators');
const {
  heavyDashboardReadLimiter,
  dashboardExportLimiter,
} = require('../middleware/dashboardRouteRateLimits');
const nfValidadeService = require('../services/nfValidadeService');
const auditLogService = require('../services/auditLogService');
const analyticsService = require('../services/analyticsService');
const { requireMFA } = require('../middleware/mfaMiddleware');

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number.parseInt(process.env.EXCEL_IMPORT_MAX_FILE_BYTES || String(5 * 1024 * 1024), 10),
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
      'application/octet-stream',
    ]);
    const allowedExt = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (allowedExt || allowedMimeTypes.has(file.mimetype)) return cb(null, true);
    return cb(new Error('INVALID_EXCEL_FILE'));
  },
});

const estoqueSpreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number.parseInt(process.env.EXCEL_IMPORT_MAX_FILE_BYTES || String(5 * 1024 * 1024), 10),
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (estoqueImportService.isSpreadsheetFile(file.mimetype, file.originalname)) return cb(null, true);
    return cb(new Error('INVALID_SPREADSHEET_FILE'));
  },
});

// Dashboard contém dados financeiros sensíveis: exige JWT Supabase.
router.use(authenticateToken);

// GET /api/dashboard/summary - Resumo geral (cards principais)
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.id;
    const balance = await transactionController.getBalance(userId);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

    const { data: proRows, error: proErr } = await supabase
      .from('contas_pagar')
      .select('valor')
      .eq('user_id', userId)
      .eq('is_pro_labore', true)
      .gte('data_vencimento', monthStart)
      .lte('data_vencimento', monthEnd);
    if (proErr) throw proErr;
    const proLaboreMensal = (proRows || []).reduce(
      (sum, row) => sum + (parseFloat(row.valor) || 0),
      0
    );

    const lucro = balance.entradas - balance.saidas;
    const margemPercentual = balance.entradas > 0
      ? ((lucro / balance.entradas) * 100).toFixed(1)
      : 0;

    res.json({
      receitas: balance.entradas,
      custos: balance.saidas,
      pro_labore_mensal: parseFloat(proLaboreMensal.toFixed(2)),
      pro_labore_ratio_receita:
        balance.entradas > 0
          ? parseFloat(((proLaboreMensal / balance.entradas) * 100).toFixed(1))
          : 0,
      lucro: lucro,
      margemLucro: parseFloat(margemPercentual),
      saldo: balance.saldo,
      initialBalance: parseFloat(req.user.initial_balance || 0)
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
router.get('/monthly-report', heavyDashboardReadLimiter, validate(monthlyReportSchema), async (req, res) => {
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
    const userId = req.user.id;
    const phone = req.user.telefone;

    // Debug: verifica se há transações para este usuário
    // (Legacy transactions query removed)
    const transactions = [];

    const { data: contasPagar, error: contasError } = await supabase
      .from('contas_pagar')
      .select('id, valor, descricao, data_vencimento')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    res.json({
      id: userId,
      nome: req.user.nome_completo,
      clinica: req.user.nome_clinica,
      phone: phone,
      createdAt: req.user.created_at,
      debug: {
        totalTransactions: transactions?.length || 0,
        recentTransactions: transactions || [],
        totalContasPagar: contasPagar?.length || 0,
        recentContasPagar: contasPagar || []
      }
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// GET /api/dashboard/clientes/perfil-pagamento
router.get('/clientes/perfil-pagamento', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const result = await clientePerfilService.getPerfilPagamento(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting clientes perfil pagamento:', error);
    res.status(500).json({ error: 'Failed to get clientes perfil pagamento' });
  }
});

// GET /api/dashboard/colaboradores
router.get('/colaboradores', async (req, res) => {
  try {
    const data = await colaboradorService.list(req.user.id);
    res.json({ items: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/dashboard/colaboradores
router.post('/colaboradores', async (req, res) => {
  try {
    const data = await colaboradorService.create(req.user.id, req.body || {});
    res.status(201).json(data);
  } catch (error) {
    const code = String(error.message || '').includes('obrigatório') ? 400 : 500;
    res.status(code).json({ error: error.message });
  }
});

// PUT /api/dashboard/colaboradores/:id
router.put('/colaboradores/:id', async (req, res) => {
  try {
    const data = await colaboradorService.update(req.user.id, req.params.id, req.body || {});
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/dashboard/colaboradores/:id
router.delete('/colaboradores/:id', async (req, res) => {
  try {
    const out = await colaboradorService.remove(req.user.id, req.params.id);
    res.json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/dashboard/colaboradores/:id/comissoes?month=YYYY-MM
router.get('/colaboradores/:id/comissoes', async (req, res) => {
  try {
    const out = await colaboradorService.getComissoesByMonth(
      req.user.id,
      req.params.id,
      req.query.month
    );
    res.json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/dashboard/transactions/search - Busca transações com filtros
router.get('/transactions/search', heavyDashboardReadLimiter, validate(searchTransactionsSchema), async (req, res) => {
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
router.put('/transactions/:id', requireMFA, validate(updateTransactionSchema), async (req, res) => {
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

    auditLogService.log({
      userId: req.user.id,
      action: 'transaction_updated',
      entityType: 'transaction',
      entityId: transactionId,
      newValue: { input: updateData, output: updated },
      req
    });

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
router.delete('/transactions/:id', requireMFA, validate(deleteTransactionSchema), async (req, res) => {
  try {
    const transactionId = req.params.id;

    const deleted = await transactionController.deleteTransaction(
      req.user.id,
      transactionId
    );

    if (!deleted) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    auditLogService.log({
      userId: req.user.id,
      action: 'transaction_deleted',
      entityType: 'transaction',
      entityId: transactionId,
      req
    });

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

// PATCH /api/dashboard/profile/initial-balance - Atualizar saldo inicial
router.patch('/profile/initial-balance', async (req, res) => {
  try {
    const { initial_balance } = req.body;

    if (typeof initial_balance !== 'number' || isNaN(initial_balance)) {
      return res.status(400).json({ error: 'initial_balance deve ser um número' });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ initial_balance })
      .eq('id', req.user.id);

    if (error) throw error;

    res.json({ message: 'Saldo inicial atualizado com sucesso', initial_balance });
  } catch (error) {
    console.error('Error updating initial balance:', error);
    res.status(500).json({ error: 'Failed to update initial balance' });
  }
});

// GET /api/dashboard/contas-a-pagar - Contas a pagar ordenadas por prioridade/urgência
router.get('/contas-a-pagar', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const { status, days_ahead, limit, offset } = req.query;
    const result = await cashflowService.getContasPagarPriority(req.user.id, {
      status: status || 'pendente',
      daysAhead: parseInt(days_ahead) || 60,
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (error) {
    console.error('Error getting contas a pagar priority:', error);
    res.status(500).json({ error: 'Failed to get contas a pagar' });
  }
});

// GET /api/dashboard/prolabore - Contas marcadas como pró-labore
router.get('/prolabore', async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('contas_pagar')
      .select('id, descricao, valor, data_vencimento, status_pagamento, categoria, is_pro_labore')
      .eq('user_id', userId)
      .eq('is_pro_labore', true)
      .order('data_vencimento', { ascending: false });
    if (error) throw error;
    const totalMensal = (data || []).reduce(
      (s, c) => s + (parseFloat(c.valor) || 0),
      0
    );
    res.json({ items: data || [], totalMensal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/dashboard/prolabore/:id - Marcar/desmarcar conta como pró-labore
router.patch('/prolabore/:id', requireMFA, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { is_pro_labore } = req.body || {};
    const { data, error } = await supabase
      .from('contas_pagar')
      .update({ is_pro_labore: Boolean(is_pro_labore) })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;

    auditLogService.log({
      userId,
      action: 'prolabore_updated',
      entityType: 'conta_pagar',
      entityId: id,
      newValue: { is_pro_labore: Boolean(is_pro_labore) },
      req
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/cashflow/projection - Projeção de fluxo de caixa dia a dia
router.get('/cashflow/projection', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const result = await cashflowService.getCashflowProjection(req.user.id, days);
    res.json(result);
  } catch (error) {
    console.error('Error getting cashflow projection:', error);
    res.status(500).json({ error: 'Failed to get cashflow projection' });
  }
});

// GET /api/dashboard/calendar - Calendário financeiro preditivo
router.get('/calendar', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const now = new Date();
    const startDate = req.query.start_date || now.toISOString().split('T')[0];
    const defaultEnd = new Date(now);
    defaultEnd.setDate(defaultEnd.getDate() + 30);
    const endDate = req.query.end_date || defaultEnd.toISOString().split('T')[0];
    const result = await cashflowService.getFinancialCalendar(req.user.id, startDate, endDate);
    res.json(result);
  } catch (error) {
    console.error('Error getting financial calendar:', error);
    res.status(500).json({ error: 'Failed to get financial calendar' });
  }
});

function optionalQueryFloat(q, keys) {
  for (const k of keys) {
    if (q[k] != null && String(q[k]).length) {
      const n = parseFloat(q[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

// GET /api/dashboard/simulator/scenario - Simulador what-if
// Query canônico: extra_revenue, cut_expense_pct, new_fixed_cost, month, year
// Aliases (doc / PT): receita_extra, corte_custos_pct, custos_fixos
// Cenários nomeados (PDF §8): scenario=extra_staff|price_hike|second_room
//   + opcionais: staff_monthly_cost, price_hike_pct (ou pct), rent_extra
router.get('/simulator/scenario', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const q = req.query;
    const firstNum = (keys) => {
      for (const k of keys) {
        if (q[k] != null && String(q[k]).length) {
          const n = parseFloat(q[k]);
          if (!Number.isNaN(n)) return n;
        }
      }
      return 0;
    };
    const month = q.month ? Math.min(Math.max(parseInt(q.month, 10), 1), 12) : undefined;
    const year = q.year ? Math.min(Math.max(parseInt(q.year, 10), 2000), 2100) : undefined;

    analyticsService.track('simulator_run', {
      userId: req.user.id,
      source: 'dashboard',
      properties: {
        scenario: q.scenario || q.cenario || 'custom',
        projection_months: q.projection_months || q.projectionMonths || 1,
        month: month || null,
        year: year || null,
      }
    }).catch(() => {});

    const projRaw = q.projection_months ?? q.projectionMonths;
    let projectionMonths =
      projRaw != null && String(projRaw).length ? parseInt(projRaw, 10) : 1;
    if (!Number.isInteger(projectionMonths)) projectionMonths = 1;
    projectionMonths = Math.min(Math.max(projectionMonths, 1), 12);

    const scenarioRaw = q.scenario ?? q.cenario;
    if (scenarioRaw != null && String(scenarioRaw).length) {
      const sid = String(scenarioRaw).toLowerCase();
      const allowed = ['extra_staff', 'price_hike', 'second_room'];
      if (!allowed.includes(sid)) {
        return res.status(400).json({ error: `scenario inválido. Use: ${allowed.join(', ')}` });
      }
      const presetOpts = {
        month,
        year,
        staffMonthlyCost: optionalQueryFloat(q, ['staff_monthly_cost', 'staffMonthlyCost', 'custo_funcionario_mensal']),
        priceHikePct: optionalQueryFloat(q, ['price_hike_pct', 'priceHikePct', 'pct', 'aumento_precos_pct']),
        rentExtra: optionalQueryFloat(q, ['rent_extra', 'rentExtra', 'aluguel_extra']),
      };
      if (projectionMonths > 1) {
        const result = await simulatorService.runScenarioPresetMultiMonth(
          req.user.id,
          sid,
          presetOpts,
          projectionMonths
        );
        return res.json(result);
      }
      const result = await simulatorService.runScenarioPreset(req.user.id, sid, presetOpts);
      return res.json(result);
    }

    const extraRevenue = Math.min(Math.max(firstNum(['extra_revenue', 'receita_extra']), 0), 1_000_000);
    const cutExpensePct = Math.min(Math.max(firstNum(['cut_expense_pct', 'corte_custos_pct']), 0), 100);
    const newFixedCost = Math.min(Math.max(firstNum(['new_fixed_cost', 'custos_fixos']), 0), 1_000_000);
    if (projectionMonths > 1) {
      const result = await simulatorService.runScenarioMultiMonth(
        req.user.id,
        { extraRevenue, cutExpensePct, newFixedCost, month, year },
        projectionMonths
      );
      return res.json(result);
    }
    const result = await simulatorService.runScenario(req.user.id, {
      extraRevenue,
      cutExpensePct,
      newFixedCost,
      month,
      year,
    });
    res.json(result);
  } catch (error) {
    console.error('Error running simulator:', error);
    res.status(500).json({ error: 'Failed to run scenario' });
  }
});

// GET /api/dashboard/simulator/scenarios — três presets num único payload (mesmos overrides opcionais do /scenario)
router.get('/simulator/scenarios', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const q = req.query;
    const month = q.month ? Math.min(Math.max(parseInt(q.month, 10), 1), 12) : undefined;
    const year = q.year ? Math.min(Math.max(parseInt(q.year, 10), 2000), 2100) : undefined;

    analyticsService.track('simulator_run', {
      userId: req.user.id,
      source: 'dashboard',
      properties: {
        scenario: 'all_presets',
        month: month || null,
        year: year || null,
      }
    }).catch(() => {});

    const result = await simulatorService.runAllPresets(req.user.id, {
      month,
      year,
      staffMonthlyCost: optionalQueryFloat(q, ['staff_monthly_cost', 'staffMonthlyCost', 'custo_funcionario_mensal']),
      priceHikePct: optionalQueryFloat(q, ['price_hike_pct', 'priceHikePct', 'pct', 'aumento_precos_pct']),
      rentExtra: optionalQueryFloat(q, ['rent_extra', 'rentExtra', 'aluguel_extra']),
    });
    res.json(result);
  } catch (error) {
    console.error('Error running simulator presets:', error);
    res.status(500).json({ error: 'Failed to run scenarios' });
  }
});

async function pricingInsightsHandler(req, res) {
  try {
    const months = Math.min(parseInt(req.query.months, 10) || 3, 12);
    const result = await pricingIntelligenceService.analyze(req.user.id, { months });
    res.json(result);
  } catch (error) {
    console.error('Error getting pricing insights:', error);
    res.status(500).json({ error: 'Failed to get pricing insights' });
  }
}

// GET /api/dashboard/insights/pricing - Análise de precificação
router.get('/insights/pricing', heavyDashboardReadLimiter, pricingInsightsHandler);

// GET /api/dashboard/pricing/insights - mesmo handler (alias para doc / clientes legados)
router.get('/pricing/insights', heavyDashboardReadLimiter, pricingInsightsHandler);

// GET /api/dashboard/emergency/status - Status de caixa de emergência
router.get('/emergency/status', async (req, res) => {
  try {
    const result = await emergencyModeService.getStatus(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting emergency status:', error);
    res.status(500).json({ error: 'Failed to get emergency status' });
  }
});

// GET /api/dashboard/estoque — status de estoque por procedimento
router.get('/estoque', async (req, res) => {
  try {
    const result = await dashboardEstoqueService.getEstoqueStatus(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting estoque:', error);
    res.status(500).json({ error: 'Failed to get estoque' });
  }
});

// GET /api/dashboard/estoque/alertas — apenas baixo | crítico
router.get('/estoque/alertas', async (req, res) => {
  try {
    const result = await dashboardEstoqueService.getAlertasBaixoEstoque(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting estoque alertas:', error);
    res.status(500).json({ error: 'Failed to get estoque alertas' });
  }
});

// GET /api/dashboard/estoque/sugestoes?saldo_disponivel=
router.get('/estoque/sugestoes', async (req, res) => {
  try {
    const raw = req.query.saldo_disponivel ?? req.query.saldoDisponivel;
    let saldo;
    if (raw != null && String(raw).length) {
      saldo = parseFloat(raw);
      if (!Number.isFinite(saldo)) {
        return res.status(400).json({ error: 'saldo_disponivel inválido' });
      }
    }
    const result = await dashboardEstoqueService.sugerirReposicao(req.user.id, saldo);
    res.json(result);
  } catch (error) {
    console.error('Error getting estoque sugestoes:', error);
    res.status(500).json({ error: 'Failed to get sugestoes' });
  }
});

// GET /api/dashboard/estoque/compras-por-fornecedor?months=12
router.get('/estoque/compras-por-fornecedor', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const raw = Number.parseInt(req.query.months, 10);
    const months = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 36) : 12;
    const result = await estoqueService.getComprasPorFornecedor(req.user.id, months);
    res.json(result);
  } catch (error) {
    console.error('Error getting compras por fornecedor:', error);
    res.status(500).json({ error: 'Failed to get compras por fornecedor' });
  }
});

// POST /api/dashboard/estoque/entrada
router.post('/estoque/entrada', async (req, res) => {
  try {
    const body = req.body || {};
    const pid = body.procedimento_id || body.procedimentoId;
    const q = body.quantidade != null ? Number(body.quantidade) : NaN;
    if (!pid || !Number.isFinite(q) || q <= 0) {
      return res.status(400).json({ error: 'procedimento_id e quantidade (> 0) são obrigatórios' });
    }
    const cu = body.custo_unitario ?? body.custoUnitario;
    if (cu != null && cu !== '') {
      const n = Number(cu);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'custo_unitario deve ser >= 0' });
      }
    }
    const result = await estoqueService.registrarEntrada(req.user.id, {
      procedimento_id: pid,
      quantidade: q,
      observacoes: body.observacoes ?? body.observacao,
      fornecedor_id: body.fornecedor_id ?? body.fornecedorId,
      custo_unitario: body.custo_unitario ?? body.custoUnitario,
      data: body.data,
    });

    auditLogService.log({
      userId: req.user.id,
      action: 'estoque_entrada',
      entityType: 'estoque',
      entityId: pid,
      newValue: {
        procedimento_id: pid,
        quantidade: q,
        custo_unitario: body.custo_unitario ?? body.custoUnitario ?? null,
        fornecedor_id: body.fornecedor_id ?? body.fornecedorId ?? null,
        data: body.data ?? null,
        result
      },
      req
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error registering entrada estoque:', error);
    if (String(error.message || '').includes('não encontrado')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to register entrada' });
  }
});

// GET /api/dashboard/export/report - Exportar relatório (PDF, CSV ou OFX)
// Fase 13 — OFX 2.0 para envio ao contador (Conta Azul, Sage, Domínio, etc.).
router.get('/export/report', dashboardExportLimiter, async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    const monthStr = req.query.month; // YYYY-MM
    const periodSlug = monthStr || 'atual';

    analyticsService.track('report_exported', {
      userId: req.user.id,
      source: 'dashboard',
      properties: { format, month: monthStr || null }
    }).catch(() => {});

    if (format === 'pdf') {
      const pdfBuffer = await exportService.exportPDF(req.user.id, monthStr);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="relatorio-${periodSlug}.pdf"`);
      return res.send(pdfBuffer);
    }

    if (format === 'ofx') {
      const ofx = await exportService.exportOFX(req.user.id, monthStr);
      res.setHeader('Content-Type', 'application/x-ofx; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="extrato-${periodSlug}.ofx"`);
      return res.send(ofx);
    }

    const csv = await exportService.exportCSV(req.user.id, monthStr);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${periodSlug}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// POST /api/dashboard/import/excel/preview
router.post('/import/excel/preview', dashboardExportLimiter, excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Arquivo Excel é obrigatório no campo file' });
    }

    const result = await excelService.importFromExcel(req.user.id, req.file.buffer, {
      filename: req.file.originalname,
    });
    return res.json(result);
  } catch (error) {
    console.error('Error previewing Excel import:', error);
    if (error.message === 'INVALID_EXCEL_FILE' || error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'Arquivo inválido. Envie .xlsx, .xls ou .csv com até 5MB.',
      });
    }
    return res.status(500).json({ error: 'Failed to preview Excel import' });
  }
});

// POST /api/dashboard/import/excel/confirm
router.post('/import/excel/confirm', dashboardExportLimiter, async (req, res) => {
  try {
    const importToken = req.body?.import_token;
    if (!importToken) {
      return res.status(400).json({ error: 'import_token é obrigatório' });
    }

    const result = await excelService.confirmImport(req.user.id, importToken);

    analyticsService.track('excel_imported', {
      userId: req.user.id,
      source: 'dashboard',
      properties: {
        valid_rows: result?.summary?.valid_row_count ?? null,
        receitas_count: result?.summary?.receitas_count ?? null,
        despesas_count: result?.summary?.despesas_count ?? null,
        receitas_total: result?.summary?.receitas_total ?? null,
        despesas_total: result?.summary?.despesas_total ?? null,
        batch_id: result?.batchId || null,
      }
    }).catch(() => {});

    if (req.user.telefone) {
      outboundMessageService
        .sendText(req.user.telefone, excelImportWhatsappCopy.importConfirmed(result.summary))
        .catch((notifyError) => console.warn('[EXCEL_IMPORT] Falha ao notificar WhatsApp:', notifyError.message));
    }
    return res.json(result);
  } catch (error) {
    console.error('Error confirming Excel import:', error);
    if (error.code === 'IMPORT_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    }
    if (error.code === 'IMPORT_NOT_PREVIEW') {
      return res.status(409).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to confirm Excel import' });
  }
});

// GET /api/dashboard/import/excel/history
router.get('/import/excel/history', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const history = await excelService.getImportHistory(req.user.id, req.query.limit);
    return res.json({ data: history });
  } catch (error) {
    console.error('Error listing Excel imports:', error);
    return res.status(500).json({ error: 'Failed to list Excel imports' });
  }
});

// DELETE /api/dashboard/import/excel/:batchId
router.delete('/import/excel/:batchId', dashboardExportLimiter, async (req, res) => {
  try {
    const result = await excelService.undoImport(req.user.id, req.params.batchId);
    return res.json(result);
  } catch (error) {
    console.error('Error undoing Excel import:', error);
    if (error.code === 'IMPORT_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to undo Excel import' });
  }
});

// POST /api/dashboard/import/estoque/preview
router.post('/import/estoque/preview', dashboardExportLimiter, estoqueSpreadsheetUpload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Arquivo CSV/XLSX é obrigatório no campo file' });
    }

    const result = await estoqueImportService.previewFromBuffer(req.user.id, req.file.buffer, {
      filename: req.file.originalname,
    });
    return res.json(result);
  } catch (error) {
    console.error('Error previewing estoque import:', error);
    if (error.message === 'INVALID_SPREADSHEET_FILE' || error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'Arquivo inválido. Envie .xlsx, .xls ou .csv com até 5MB.',
      });
    }
    return res.status(500).json({ error: 'Failed to preview estoque import' });
  }
});

// POST /api/dashboard/import/estoque/confirm
router.post('/import/estoque/confirm', dashboardExportLimiter, async (req, res) => {
  try {
    const importToken = req.body?.import_token;
    if (!importToken) {
      return res.status(400).json({ error: 'import_token é obrigatório' });
    }

    const result = await estoqueImportService.confirmImport(req.user.id, importToken);

    analyticsService.track('estoque_imported', {
      userId: req.user.id,
      source: 'dashboard',
      properties: {
        valid_rows: result?.summary?.valid_rows ?? null,
        applied_count: result?.summary?.applied_count ?? null,
        failed_count: result?.summary?.failed_count ?? null,
        batch_id: result?.batch_id || null,
      },
    }).catch(() => {});

    if (req.user.telefone) {
      outboundMessageService
        .sendText(req.user.telefone, estoqueImportWhatsappCopy.importConfirmed(result))
        .catch((notifyError) => console.warn('[ESTOQUE_IMPORT] Falha ao notificar WhatsApp:', notifyError.message));
    }
    return res.json(result);
  } catch (error) {
    console.error('Error confirming estoque import:', error);
    if (error.code === 'IMPORT_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    }
    if (error.code === 'IMPORT_NOT_PREVIEW') {
      return res.status(409).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to confirm estoque import' });
  }
});

// GET /api/dashboard/import/estoque/history
router.get('/import/estoque/history', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const history = await estoqueImportService.getImportHistory(req.user.id, req.query.limit);
    return res.json({ data: history });
  } catch (error) {
    console.error('Error listing estoque imports:', error);
    return res.status(500).json({ error: 'Failed to list estoque imports' });
  }
});

// DELETE /api/dashboard/import/estoque/:batchId
router.delete('/import/estoque/:batchId', dashboardExportLimiter, async (req, res) => {
  try {
    const result = await estoqueImportService.undoImport(req.user.id, req.params.batchId);
    return res.json(result);
  } catch (error) {
    console.error('Error undoing estoque import:', error);
    if (error.code === 'IMPORT_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to undo estoque import' });
  }
});

function sendTemplate(res, buffer, contentType, filename) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
}

router.get('/import/templates/estoque.csv', (req, res) => {
  const buffer = importTemplateService.getEstoqueTemplateCsv();
  return sendTemplate(res, buffer, 'text/csv; charset=utf-8', 'template-estoque.csv');
});

router.get('/import/templates/estoque.xlsx', (req, res) => {
  const buffer = importTemplateService.getEstoqueTemplateXlsx();
  return sendTemplate(
    res,
    buffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'template-estoque.xlsx'
  );
});

router.get('/import/templates/financeiro.csv', (req, res) => {
  const buffer = importTemplateService.getFinanceiroTemplateCsv();
  return sendTemplate(res, buffer, 'text/csv; charset=utf-8', 'template-financeiro.csv');
});

router.get('/import/templates/financeiro.xlsx', (req, res) => {
  const buffer = importTemplateService.getFinanceiroTemplateXlsx();
  return sendTemplate(
    res,
    buffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'template-financeiro.xlsx'
  );
});

// GET /api/dashboard/goals/monthly?year=2026&month=5
router.get('/goals/monthly', async (req, res) => {
  try {
    const year = Number.parseInt(req.query.year, 10);
    const month = Number.parseInt(req.query.month, 10);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year e month são obrigatórios (month: 1..12)' });
    }

    const { data, error } = await supabase
      .from('monthly_goals')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (error) throw error;

    res.json(
      data || {
        year,
        month,
        meta_receita: 0,
        meta_reserva: null,
        meta_lucro: null,
      }
    );
  } catch (error) {
    console.error('Error getting monthly goal:', error);
    res.status(500).json({ error: 'Failed to get monthly goal' });
  }
});

function parseOptionalGoalNumber(body, key, existingVal) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, key)) {
    return existingVal;
  }
  const raw = body[key];
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`invalid_${key}`);
    err.code = 'VALIDATION';
    throw err;
  }
  return n;
}

// PUT /api/dashboard/goals/monthly — POST espelha o mesmo handler (clientes legados / curl)
async function upsertMonthlyGoal(req, res) {
  try {
    const body = req.body || {};
    const { year, month, meta_receita } = body;
    const parsedYear = Number.parseInt(year, 10);
    const parsedMonth = Number.parseInt(month, 10);
    const parsedMeta = Number(meta_receita);

    if (!Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
      return res.status(400).json({ error: 'year e month são obrigatórios (month: 1..12)' });
    }
    if (!Number.isFinite(parsedMeta) || parsedMeta < 0) {
      return res.status(400).json({ error: 'meta_receita deve ser número >= 0' });
    }

    const { data: existing } = await supabase
      .from('monthly_goals')
      .select('meta_reserva, meta_lucro')
      .eq('user_id', req.user.id)
      .eq('year', parsedYear)
      .eq('month', parsedMonth)
      .maybeSingle();

    let meta_reserva = null;
    let meta_lucro = null;
    if (existing?.meta_reserva != null && existing.meta_reserva !== '') {
      const pr = parseFloat(existing.meta_reserva);
      if (Number.isFinite(pr)) meta_reserva = pr;
    }
    if (existing?.meta_lucro != null && existing.meta_lucro !== '') {
      const pl = parseFloat(existing.meta_lucro);
      if (Number.isFinite(pl)) meta_lucro = pl;
    }
    try {
      meta_reserva = parseOptionalGoalNumber(body, 'meta_reserva', meta_reserva);
      meta_lucro = parseOptionalGoalNumber(body, 'meta_lucro', meta_lucro);
    } catch (e) {
      if (e.code === 'VALIDATION') {
        return res.status(400).json({ error: 'meta_reserva e meta_lucro devem ser null, omitidas ou número >= 0' });
      }
      throw e;
    }

    const payload = {
      user_id: req.user.id,
      year: parsedYear,
      month: parsedMonth,
      meta_receita: parsedMeta,
      meta_reserva,
      meta_lucro,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('monthly_goals')
      .upsert(payload, { onConflict: 'user_id,year,month' })
      .select()
      .single();

    if (error) throw error;

    auditLogService.log({
      userId: req.user.id,
      action: 'goal_updated',
      entityType: 'monthly_goal',
      entityId: `goal:${parsedYear}:${parsedMonth}`,
      oldValue: existing || null,
      newValue: data,
      req
    });

    analyticsService.track('goal_set', {
      userId: req.user.id,
      source: 'dashboard',
      properties: {
        year: parsedYear,
        month: parsedMonth,
        meta_receita: parsedMeta,
        has_meta_reserva: meta_reserva != null,
        has_meta_lucro: meta_lucro != null,
        is_first_set: !existing,
      }
    }).catch(() => {});

    res.json(data);
  } catch (error) {
    console.error('Error updating monthly goal:', error);
    res.status(500).json({ error: 'Failed to update monthly goal' });
  }
}

router.put('/goals/monthly', upsertMonthlyGoal);
router.post('/goals/monthly', upsertMonthlyGoal);

// GET /api/dashboard/health/score
router.get('/health/score', async (req, res) => {
  try {
    const result = await healthScoreService.getScore(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting health score:', error);
    res.status(500).json({ error: 'Failed to get health score' });
  }
});

// GET /api/dashboard/inadimplencia/overview
router.get('/inadimplencia/overview', async (req, res) => {
  try {
    const result = await inadimplenciaService.getOverview(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting inadimplencia overview:', error);
    res.status(500).json({ error: 'Failed to get inadimplencia overview' });
  }
});

// GET /api/dashboard/inadimplencia/cliente/:clienteId
router.get('/inadimplencia/cliente/:clienteId', async (req, res) => {
  try {
    const { clienteId } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(clienteId)) {
      return res.status(400).json({ error: 'clienteId inválido' });
    }

    const result = await inadimplenciaService.getDetalheCliente(req.user.id, clienteId);
    res.json(result);
  } catch (error) {
    console.error('Error getting inadimplencia cliente:', error);
    res.status(500).json({ error: 'Failed to get inadimplencia cliente' });
  }
});

// GET /api/dashboard/insights/outlook?months=6 — visão multi-mês receita (atendimentos) vs custos (ledger)
router.get('/insights/outlook', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const raw = Number.parseInt(req.query.months, 10);
    const months = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 24) : 6;
    const result = await outlookService.getOutlook(req.user.id, months);
    res.json(result);
  } catch (error) {
    console.error('Error getting outlook:', error);
    res.status(500).json({ error: 'Failed to get outlook' });
  }
});

// GET /api/dashboard/insights/sazonalidade?months=12
router.get('/insights/sazonalidade', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const rawMonths = Number.parseInt(req.query.months, 10);
    const months = Number.isInteger(rawMonths) ? Math.min(Math.max(rawMonths, 2), 24) : 12;
    const result = await sazonalidadeService.getSazonalidade(req.user.id, months);
    res.json(result);
  } catch (error) {
    console.error('Error getting sazonalidade insights:', error);
    res.status(500).json({ error: 'Failed to get sazonalidade insights' });
  }
});

// GET /api/dashboard/insights/custo-procedimentos?months=3
router.get('/insights/custo-procedimentos', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const raw = req.query.months != null ? Number.parseInt(req.query.months, 10) : 3;
    if (!Number.isInteger(raw) || raw < 1 || raw > 12) {
      return res.status(400).json({ error: 'months deve ser inteiro entre 1 e 12' });
    }
    const result = await procedimentoCustoService.getCustoRealProcedimentos(req.user.id, raw);
    res.json(result);
  } catch (error) {
    console.error('Error getting custo procedimentos:', error);
    res.status(500).json({ error: 'Failed to get custo procedimentos' });
  }
});

// GET /api/dashboard/insights/simular-desconto?procedimento_id=&desconto_pct=
router.get('/insights/simular-desconto', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const pid = req.query.procedimento_id || req.query.procedimentoId;
    const rawPct = req.query.desconto_pct ?? req.query.descontoPct;
    if (!pid || !/^[0-9a-f-]{36}$/i.test(String(pid))) {
      return res.status(400).json({ error: 'procedimento_id (UUID) é obrigatório' });
    }
    const pct = Number.parseFloat(rawPct);
    if (!Number.isFinite(pct) || pct < 1 || pct > 99) {
      return res.status(400).json({ error: 'desconto_pct deve ser entre 1 e 99' });
    }
    const result = await procedimentoCustoService.simularImpactoDesconto(
      req.user.id,
      pid,
      pct
    );
    res.json(result);
  } catch (error) {
    console.error('Error simular desconto:', error);
    if (String(error.message || '').includes('não encontrado')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to simular desconto' });
  }
});

// GET /api/dashboard/insights/margem-comparativa?months=3
router.get('/insights/margem-comparativa', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const raw = req.query.months != null ? Number.parseInt(req.query.months, 10) : 3;
    const meses = Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : 3;
    const result = await margemAlertaService.getMargemComparativaPorProcedimento(req.user.id, meses);
    res.json(result);
  } catch (error) {
    console.error('Error getting margem comparativa:', error);
    res.status(500).json({ error: 'Failed to get margem comparativa' });
  }
});

// GET /api/dashboard/goals/caminho
router.get('/goals/caminho', async (req, res) => {
  try {
    const result = await metaCaminhoService.calcularCaminhoMeta(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting goals caminho:', error);
    res.status(500).json({ error: 'Failed to get meta caminho' });
  }
});

// GET /api/dashboard/emergency/detalhes
router.get('/emergency/detalhes', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const result = await emergencyModeService.getEmergenciaDetalhada(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting emergency detalhes:', error);
    res.status(500).json({ error: 'Failed to get emergency detalhes' });
  }
});

// GET /api/dashboard/emergency/history?limit=50
router.get('/emergency/history', async (req, res) => {
  try {
    const lim = parseInt(req.query.limit, 10);
    const result = await emergencyModeService.getAlertHistory(req.user.id, lim);
    res.json(result);
  } catch (error) {
    console.error('Error getting emergency history:', error);
    res.status(500).json({ error: 'Failed to get emergency history' });
  }
});

// GET /api/dashboard/preferences — opt-ins do usuário autenticado
router.get('/preferences', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('reporte_mensal_whatsapp, alertas_whatsapp_ativos')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    res.json({
      reporte_mensal_whatsapp: Boolean(data?.reporte_mensal_whatsapp),
      alertas_whatsapp_ativos: Boolean(data?.alertas_whatsapp_ativos),
    });
  } catch (error) {
    console.error('Error getting preferences:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// PUT /api/dashboard/preferences — opt-ins (ex.: relatório mensal WhatsApp)
router.put('/preferences', async (req, res) => {
  try {
    const { reporte_mensal_whatsapp, alertas_whatsapp_ativos } = req.body || {};
    const payload = {};

    if (typeof reporte_mensal_whatsapp === 'boolean') {
      payload.reporte_mensal_whatsapp = reporte_mensal_whatsapp;
    }
    if (typeof alertas_whatsapp_ativos === 'boolean') {
      payload.alertas_whatsapp_ativos = alertas_whatsapp_ativos;
    }

    if (!Object.keys(payload).length) {
      return res
        .status(400)
        .json({
          error: 'Body deve incluir ao menos um boolean: reporte_mensal_whatsapp ou alertas_whatsapp_ativos'
        });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', req.user.id)
      .select('id, reporte_mensal_whatsapp, alertas_whatsapp_ativos')
      .single();

    if (error) throw error;
    res.json({
      id: data.id,
      reporte_mensal_whatsapp: Boolean(data?.reporte_mensal_whatsapp),
      alertas_whatsapp_ativos: Boolean(data?.alertas_whatsapp_ativos),
    });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// GET /api/dashboard/nf-validade?days=90 — validades / lembretes (PDF §2b mínimo)
router.get('/nf-validade', async (req, res) => {
  try {
    const days = req.query.days != null ? parseInt(req.query.days, 10) : 90;
    const result = await nfValidadeService.listarProximos(req.user.id, days);
    res.json(result);
  } catch (error) {
    console.error('Error listing nf-validade:', error);
    res.status(500).json({ error: 'Failed to list nf-validade' });
  }
});

// POST /api/dashboard/nf-validade — body: { descricao, data_validade, origem? }
router.post('/nf-validade', async (req, res) => {
  try {
    const row = await nfValidadeService.criar(req.user.id, req.body || {});
    res.status(201).json(row);
  } catch (error) {
    console.error('Error creating nf-validade:', error);
    const msg = String(error.message || '');
    if (msg.includes('obrigat')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: 'Failed to create nf-validade' });
  }
});

// DELETE /api/dashboard/nf-validade/:id
router.delete('/nf-validade/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const result = await nfValidadeService.remover(req.user.id, id);
    res.json(result);
  } catch (error) {
    console.error('Error deleting nf-validade:', error);
    res.status(500).json({ error: 'Failed to delete nf-validade' });
  }
});

// GET /api/dashboard/estoque/alertas-excesso — acima de estoque_maximo
router.get('/estoque/alertas-excesso', async (req, res) => {
  try {
    const result = await dashboardEstoqueService.getAlertasEstoqueExcesso(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting estoque alertas excesso:', error);
    res.status(500).json({ error: 'Failed to get estoque alertas excesso' });
  }
});

// POST /api/dashboard/reports/send-email?month=YYYY-MM
router.post('/reports/send-email', async (req, res) => {
  try {
    const month = req.query.month;
    if (month != null && month !== '' && !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: 'month deve estar no formato YYYY-MM' });
    }
    const result = await emailReportService.sendMonthlyReportEmail(req.user.id, month);
    res.json(result);
  } catch (error) {
    console.error('Error sending monthly email report:', error);
    res.status(500).json({ error: 'Failed to send monthly email report' });
  }
});

// ============================================================================
// Onda 2 — Supplier Documents (NF, Boleto, Comprovante via OCR)
// ============================================================================

// GET /api/dashboard/supplier-documents?status=pending&limit=50
router.get('/supplier-documents', async (req, res) => {
  try {
    const userId = req.user.id;
    const status = String(req.query.status || '').trim() || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    let query = supabase
      .from('supplier_documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json({
      data: data || [],
      meta: {
        is_empty: !data || data.length === 0,
        hint: !data || data.length === 0
          ? 'Envie uma NF ou boleto pelo WhatsApp para começar a popular esta lista.'
          : null
      }
    });
  } catch (error) {
    console.error('Error listing supplier documents:', error);
    res.status(500).json({ error: 'Failed to list supplier documents' });
  }
});

// POST /api/dashboard/supplier-documents/process
// body: { file_base64, mime_type, source_phone? }
// Roda extract → linkOrCreateFornecedor → persist + cria contas_pagar + tenta entrada de estoque.
router.post('/supplier-documents/process', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const { file_base64, mime_type, source_phone, dry_run } = req.body || {};
    if (!file_base64 || typeof file_base64 !== 'string') {
      return res.status(400).json({ error: 'file_base64 obrigatório' });
    }
    if (!mime_type || typeof mime_type !== 'string') {
      return res.status(400).json({ error: 'mime_type obrigatório (image/jpeg, image/png, application/pdf)' });
    }

    const cleanBase64 = file_base64.includes(',') ? file_base64.split(',')[1] : file_base64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    const fileHash = supplierDocumentService.computeFileHash(buffer);

    const parsed = await supplierDocumentService.extract(buffer, mime_type);

    if (dry_run === true) {
      return res.json({ parsed, fileHash });
    }

    const fornecedor = await supplierDocumentService.linkOrCreateFornecedor(req.user.id, parsed);
    const supplierDoc = await supplierDocumentService.persist(req.user.id, parsed, {
      fileHash,
      sourcePhone: source_phone || null,
      fornecedorId: fornecedor.id
    });
    const contas = await supplierDocumentService.createContasPagarFromDocument(
      req.user.id,
      parsed,
      fornecedor.id,
      { supplierDocumentId: supplierDoc.id }
    );
    auditLogService.log({
      userId: req.user.id,
      action: 'supplier_doc_processed',
      entityType: 'supplier_document',
      entityId: supplierDoc?.id || null,
      newValue: {
        fornecedor_id: fornecedor?.id || null,
        contas_criadas: Array.isArray(contas) ? contas.length : 0,
        estoque_aplicado: false,
        estoque_observacao: 'Atualizacao automatica de estoque desativada; revisar em etapa manual.',
        file_hash: fileHash,
        source_phone: source_phone || null
      },
      req
    });

    res.status(201).json({
      parsed,
      fornecedor,
      supplier_document: supplierDoc,
      contas_pagar: contas,
      estoque: {
        applied: false,
        message: 'Atualizacao automatica de estoque desativada; use o fluxo manual quando necessario.'
      }
    });
  } catch (error) {
    console.error('Error processing supplier document:', error);
    res.status(500).json({ error: error.message || 'Failed to process supplier document' });
  }
});

// GET /api/dashboard/supplier-documents/:id
router.get('/supplier-documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
    const { data, error } = await supabase
      .from('supplier_documents')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Documento não encontrado' });
    res.json(data);
  } catch (error) {
    console.error('Error getting supplier document:', error);
    res.status(500).json({ error: 'Failed to get supplier document' });
  }
});

// POST /api/dashboard/supplier-documents/:id/link-fornecedor body: { fornecedor_id }
router.post('/supplier-documents/:id/link-fornecedor', async (req, res) => {
  try {
    const { id } = req.params;
    const { fornecedor_id } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
    if (!fornecedor_id || !/^[0-9a-f-]{36}$/i.test(fornecedor_id)) {
      return res.status(400).json({ error: 'fornecedor_id inválido' });
    }

    const { data: forn, error: fe } = await supabase
      .from('fornecedores')
      .select('id')
      .eq('id', fornecedor_id)
      .eq('user_id', req.user.id)
      .single();
    if (fe || !forn) return res.status(404).json({ error: 'Fornecedor não encontrado' });

    const { data: doc, error: docError } = await supabase
      .from('supplier_documents')
      .update({ fornecedor_id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('*')
      .single();
    if (docError) throw docError;

    auditLogService.log({
      userId: req.user.id,
      action: 'supplier_doc_linked',
      entityType: 'supplier_document',
      entityId: id,
      newValue: { fornecedor_id },
      req
    });

    res.json(doc);
  } catch (error) {
    console.error('Error linking supplier document to fornecedor:', error);
    res.status(500).json({ error: 'Failed to link supplier document' });
  }
});

// POST /api/dashboard/supplier-documents/:id/match-itens body: { matches: [{descricao, procedimento_id, quantidade}] }
router.post('/supplier-documents/:id/match-itens', async (req, res) => {
  try {
    const { id } = req.params;
    const { matches } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({ error: 'matches deve ser um array não-vazio' });
    }

    const { data: doc, error: docError } = await supabase
      .from('supplier_documents')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (docError || !doc) return res.status(404).json({ error: 'Documento não encontrado' });

    const aplicados = [];
    const erros = [];
    for (const m of matches) {
      try {
        const movimento = await estoqueService.registrarEntrada(req.user.id, {
          procedimentoId: m.procedimento_id,
          quantidade: Number(m.quantidade) || 0,
          custoUnitario: m.valor_unitario ?? null,
          fornecedorId: doc.fornecedor_id || null,
          observacoes: `Match manual via supplier_doc ${id}`
        });
        aplicados.push({ descricao: m.descricao, procedimento_id: m.procedimento_id, movimento });
      } catch (e) {
        erros.push({ ...m, erro: e?.message || String(e) });
      }
    }

    auditLogService.log({
      userId: req.user.id,
      action: 'supplier_doc_matched',
      entityType: 'supplier_document',
      entityId: id,
      newValue: {
        aplicados_count: aplicados.length,
        erros_count: erros.length,
        matches_input: matches.map(m => ({
          descricao: m.descricao,
          procedimento_id: m.procedimento_id,
          quantidade: m.quantidade
        }))
      },
      req
    });

    res.json({ aplicados, erros });
  } catch (error) {
    console.error('Error applying matches:', error);
    res.status(500).json({ error: 'Failed to apply matches' });
  }
});

// GET /api/dashboard/fornecedores
router.get('/fornecedores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('fornecedores')
      .select('*')
      .eq('user_id', req.user.id)
      .order('nome', { ascending: true });
    if (error) throw error;
    res.json({
      data: data || [],
      meta: {
        is_empty: !data || data.length === 0,
        hint: !data || data.length === 0
          ? 'Cadastre fornecedores manualmente ou envie NFs pelo WhatsApp para popular automaticamente.'
          : null
      }
    });
  } catch (error) {
    console.error('Error listing fornecedores:', error);
    res.status(500).json({ error: 'Failed to list fornecedores' });
  }
});

// POST /api/dashboard/fornecedores
router.post('/fornecedores', async (req, res) => {
  try {
    const { nome, cnpj, email, whatsapp, contato, prazo_medio_dias } = req.body || {};
    if (!nome || String(nome).trim().length === 0) {
      return res.status(400).json({ error: 'nome obrigatório' });
    }
    const payload = {
      user_id: req.user.id,
      nome: String(nome).trim(),
      cnpj: cnpj ? String(cnpj).replace(/\D+/g, '') : null,
      email: email || null,
      whatsapp: whatsapp || null,
      contato: contato || null,
      prazo_medio_dias: prazo_medio_dias != null ? parseInt(prazo_medio_dias, 10) : null
    };
    if (payload.cnpj && payload.cnpj.length !== 14) {
      return res.status(400).json({ error: 'cnpj deve ter 14 dígitos' });
    }
    const { data, error } = await supabase
      .from('fornecedores')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      if (String(error.message || '').includes('uq_fornecedores_user_cnpj')) {
        return res.status(409).json({ error: 'Já existe fornecedor com esse CNPJ.' });
      }
      throw error;
    }
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating fornecedor:', error);
    res.status(500).json({ error: 'Failed to create fornecedor' });
  }
});

// PUT /api/dashboard/fornecedores/:id
router.put('/fornecedores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
    const { nome, cnpj, email, whatsapp, contato, prazo_medio_dias } = req.body || {};
    const updates = {};
    if (nome !== undefined) updates.nome = String(nome).trim();
    if (cnpj !== undefined) updates.cnpj = cnpj ? String(cnpj).replace(/\D+/g, '') : null;
    if (email !== undefined) updates.email = email || null;
    if (whatsapp !== undefined) updates.whatsapp = whatsapp || null;
    if (contato !== undefined) updates.contato = contato || null;
    if (prazo_medio_dias !== undefined) updates.prazo_medio_dias = prazo_medio_dias != null ? parseInt(prazo_medio_dias, 10) : null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'nenhum campo para atualizar' });
    }
    const { data, error } = await supabase
      .from('fornecedores')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    res.json(data);
  } catch (error) {
    console.error('Error updating fornecedor:', error);
    res.status(500).json({ error: 'Failed to update fornecedor' });
  }
});

// DELETE /api/dashboard/fornecedores/:id
router.delete('/fornecedores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
    const { error } = await supabase
      .from('fornecedores')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting fornecedor:', error);
    res.status(500).json({ error: 'Failed to delete fornecedor' });
  }
});

// GET /api/dashboard/contas-a-receber?from=YYYY-MM-DD&to=YYYY-MM-DD
// Onda 2.C — agrega parcelas em aberto com aging buckets + mix por forma de pagamento.
router.get('/contas-a-receber', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const { from, to } = req.query;
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(String(from))) {
      return res.status(400).json({ error: 'from deve ser YYYY-MM-DD' });
    }
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
      return res.status(400).json({ error: 'to deve ser YYYY-MM-DD' });
    }
    const result = await contasReceberService.getOverview(req.user.id, {
      from: from || null,
      to: to || null
    });
    res.json(result);
  } catch (error) {
    console.error('Error getting contas a receber overview:', error);
    res.status(500).json({ error: 'Failed to get contas a receber' });
  }
});

// ====================================================================
// Onda 3.C — Alter endpoints (todos atrás de feature flag alter_enabled)
// ====================================================================

const alterGuard = requireFeature('alter_enabled');

// GET /api/dashboard/alter/recebiveis
router.get('/alter/recebiveis', alterGuard, heavyDashboardReadLimiter, async (req, res) => {
  try {
    const { status, adquirente, from, to } = req.query;
    const data = await alterRecebiveisService.list(req.user.id, {
      status: status || null,
      adquirente: adquirente || null,
      from: from || null,
      to: to || null
    });
    const posicao = await alterRecebiveisService.getPosicao(req.user.id);
    res.json({
      data,
      posicao,
      meta: {
        is_empty: data.length === 0,
        hint: data.length === 0
          ? 'Sem recebíveis no cartão ainda. Conforme registrar vendas parceladas, aparecem aqui.'
          : null
      }
    });
  } catch (error) {
    console.error('Error listing alter recebiveis:', error);
    res.status(500).json({ error: 'Failed to list recebiveis' });
  }
});

// GET /api/dashboard/alter/recebiveis/aging
router.get('/alter/recebiveis/aging', alterGuard, heavyDashboardReadLimiter, async (req, res) => {
  try {
    const result = await alterRecebiveisService.getAging(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting alter aging:', error);
    res.status(500).json({ error: 'Failed to get aging' });
  }
});

// GET /api/dashboard/alter/recebiveis/mix
router.get('/alter/recebiveis/mix', alterGuard, heavyDashboardReadLimiter, async (req, res) => {
  try {
    const result = await alterRecebiveisService.getMix(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error getting alter mix:', error);
    res.status(500).json({ error: 'Failed to get mix' });
  }
});

// GET /api/dashboard/alter/antecipacao/sugestao?horizonte_dias=30
router.get('/alter/antecipacao/sugestao', alterGuard, heavyDashboardReadLimiter, async (req, res) => {
  try {
    const horizonte = req.query.horizonte_dias ? Number(req.query.horizonte_dias) : 30;
    const result = await antecipacaoService.recomendar(req.user.id, { horizonte_dias: horizonte });
    res.json(result);
  } catch (error) {
    console.error('Error getting antecipacao sugestao:', error);
    res.status(500).json({ error: 'Failed to get sugestao' });
  }
});

// POST /api/dashboard/alter/antecipacao/simular  body { valor_alvo, horizonte_dias }
router.post('/alter/antecipacao/simular', alterGuard, async (req, res) => {
  try {
    const { valor_alvo, horizonte_dias } = req.body || {};
    if (typeof valor_alvo !== 'number' || valor_alvo < 0) {
      return res.status(400).json({ error: 'valor_alvo deve ser número >= 0' });
    }
    const result = await antecipacaoService.simular(req.user.id, {
      valor_alvo,
      horizonte_dias: horizonte_dias || 30
    });
    res.json(result);
  } catch (error) {
    console.error('Error simulating antecipacao:', error);
    res.status(500).json({ error: 'Failed to simulate antecipacao' });
  }
});

// POST /api/dashboard/alter/antecipacao/executar body { valor_alvo, horizonte_dias }
router.post('/alter/antecipacao/executar', alterGuard, requireMFA, async (req, res) => {
  try {
    const { valor_alvo, horizonte_dias, simulacao } = req.body || {};
    if (!simulacao && (typeof valor_alvo !== 'number' || valor_alvo <= 0)) {
      return res.status(400).json({ error: 'envie valor_alvo > 0 ou simulacao' });
    }
    const result = await antecipacaoService.executar(req.user.id, {
      valor_alvo,
      horizonte_dias: horizonte_dias || 30,
      simulacao
    });

    auditLogService.log({
      userId: req.user.id,
      action: 'alter_antecipacao_executed',
      entityType: 'alter_antecipacao',
      entityId: result?.antecipacao_id || result?.id || null,
      newValue: {
        input: { valor_alvo, horizonte_dias: horizonte_dias || 30, simulacao: Boolean(simulacao) },
        output: result
      },
      req
    });

    res.json(result);
  } catch (error) {
    console.error('Error executing antecipacao:', error);
    res.status(500).json({ error: 'Failed to execute antecipacao' });
  }
});

// POST /api/dashboard/alter/antecipacao/parar-automatica
router.post('/alter/antecipacao/parar-automatica', alterGuard, requireMFA, async (req, res) => {
  try {
    const result = await antecipacaoService.pararAutomatica(req.user.id);

    auditLogService.log({
      userId: req.user.id,
      action: 'alter_antecipacao_paused',
      entityType: 'alter_antecipacao',
      entityId: null,
      newValue: result,
      req
    });

    res.json(result);
  } catch (error) {
    console.error('Error stopping antecipacao automatica:', error);
    res.status(500).json({ error: 'Failed to stop automatica' });
  }
});

// GET /api/dashboard/alter/cobertura?horizonte_dias=90&snapshot=true
router.get('/alter/cobertura', alterGuard, heavyDashboardReadLimiter, async (req, res) => {
  try {
    const horizonte = req.query.horizonte_dias ? Number(req.query.horizonte_dias) : 90;
    const persistSnapshot = req.query.snapshot === 'true';
    const result = await coberturaFornecedorService.calcular(req.user.id, {
      horizonte_dias: horizonte,
      persistSnapshot
    });
    res.json(result);
  } catch (error) {
    console.error('Error calculating cobertura:', error);
    res.status(500).json({ error: 'Failed to calculate cobertura' });
  }
});

// POST /api/dashboard/alter/pagar-fornecedor body { supplier_document_id?, conta_pagar_id? }
router.post('/alter/pagar-fornecedor', alterGuard, async (req, res) => {
  try {
    const { supplier_document_id, conta_pagar_id } = req.body || {};
    if (!supplier_document_id && !conta_pagar_id) {
      return res.status(400).json({ error: 'envie supplier_document_id ou conta_pagar_id' });
    }
    const result = await pagarComRecebivelService.sugerir(req.user.id, {
      supplier_document_id,
      conta_pagar_id
    });
    res.json(result);
  } catch (error) {
    console.error('Error suggesting pagar com recebivel:', error);
    res.status(500).json({ error: 'Failed to suggest pagar com recebivel' });
  }
});

// POST /api/dashboard/alter/pagar-fornecedor/executar body { recebiveis_ids[], conta_pagar_id? }
router.post('/alter/pagar-fornecedor/executar', alterGuard, requireMFA, async (req, res) => {
  try {
    const { recebiveis_ids, conta_pagar_id } = req.body || {};
    if (!Array.isArray(recebiveis_ids) || recebiveis_ids.length === 0) {
      return res.status(400).json({ error: 'recebiveis_ids deve ser array não vazio' });
    }
    const result = await pagarComRecebivelService.executar(req.user.id, {
      recebiveis_ids,
      conta_pagar_id
    });

    auditLogService.log({
      userId: req.user.id,
      action: 'alter_pago_recebivel_executed',
      entityType: 'conta_pagar',
      entityId: conta_pagar_id || null,
      newValue: {
        input: { recebiveis_ids, conta_pagar_id: conta_pagar_id || null },
        output: result
      },
      req
    });

    res.json(result);
  } catch (error) {
    console.error('Error executing pagar com recebivel:', error);
    res.status(500).json({ error: 'Failed to execute pagar com recebivel' });
  }
});

// ── Alter onboarding (cadastro BP + opt-in Núclea) ──────────────────────────

// POST /api/dashboard/alter/onboarding/registrar
// Cria o Business Partner na Alter e persiste alter_bp_id no perfil.
router.post('/alter/onboarding/registrar', alterGuard, async (req, res) => {
  try {
    const { name, cnpj, email, phone } = req.body;
    if (!cnpj) return res.status(400).json({ error: 'cnpj é obrigatório.' });
    const bp = await alterAdapter.registerBusinessPartner(req.user.id, { name, cnpj, email, phone });
    res.status(201).json(bp);
  } catch (error) {
    console.error('[ALTER] Erro ao registrar BP:', error?.message);
    res.status(500).json({ error: 'Falha ao registrar Business Partner na Alter.' });
  }
});

// POST /api/dashboard/alter/onboarding/opt-in
// Dispara opt-in Núclea para o BP já cadastrado (idempotente).
router.post('/alter/onboarding/opt-in', alterGuard, async (req, res) => {
  try {
    const result = await alterAdapter.requestOptIn(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('[ALTER] Erro ao solicitar opt-in:', error?.message);
    const status = error?.message?.includes('alter_bp_id') ? 400 : 500;
    res.status(status).json({ error: error?.message || 'Falha ao solicitar opt-in Núclea.' });
  }
});

// GET /api/dashboard/alter/onboarding/status
// Retorna o BP e status atual do opt-in (polling até nuclea_opt_in.status === 'active').
router.get('/alter/onboarding/status', alterGuard, heavyDashboardReadLimiter, async (req, res) => {
  try {
    const bp = await alterAdapter.getBusinessPartner(req.user.id);
    if (!bp) {
      return res.json({ registered: false, meta: { is_empty: true, hint: 'Chame POST /alter/onboarding/registrar primeiro.' } });
    }
    res.json({ registered: true, ...bp });
  } catch (error) {
    console.error('[ALTER] Erro ao buscar status BP:', error?.message);
    res.status(500).json({ error: 'Falha ao buscar status do Business Partner.' });
  }
});

// Fase 15 — Audit log: histórico de mutações críticas do usuário.
// GET /api/dashboard/audit-log?limit=50&offset=0&entity_type=transaction&action=transaction_updated
router.get('/audit-log', heavyDashboardReadLimiter, async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const offset = Number.parseInt(req.query.offset, 10);
    const result = await auditLogService.list(req.user.id, {
      entityType: req.query.entity_type || undefined,
      action: req.query.action || undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0
    });
    res.json(result);
  } catch (error) {
    console.error('Error listing audit log:', error);
    res.status(500).json({ error: 'Failed to list audit log' });
  }
});

module.exports = router;
