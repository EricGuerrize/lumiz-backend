const supabase = require('../db/supabase');
const transactionController = require('../controllers/transactionController');
const featureFlagService = require('./featureFlagService');
const coberturaFornecedorService = require('./alter/coberturaFornecedorService');

const COBERTURA_FORNECEDOR_PESO = Number(process.env.HEALTH_SCORE_COBERTURA_FORNECEDOR_PESO || 10);

class HealthScoreService {
  _toDateOnly(dateStr) {
    return new Date(`${dateStr}T12:00:00`);
  }

  _monthBounds(year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const toDateStr = (date) => date.toISOString().split('T')[0];
    return { start: toDateStr(start), end: toDateStr(end) };
  }

  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  _buildRecommendation(componentes) {
    if (componentes.margem.valor < 15) {
      return 'Sua margem está baixa. Revise custos variáveis e ajuste preços dos procedimentos com menor rentabilidade.';
    }
    if (componentes.pontualidade.valor < 70) {
      return 'A pontualidade dos recebimentos está baixa. Reforce lembretes e negocie vencimentos mais curtos.';
    }
    if (componentes.cobertura.valor < 1) {
      return 'A cobertura de caixa está apertada. Priorize redução de saídas dos próximos 30 dias.';
    }
    if (componentes.tendencia.valor === 'falling') {
      return 'Sua receita está em queda vs mês anterior. Ative campanhas de reativação e upsell para a base atual.';
    }
    return 'Seu negócio está saudável. Mantenha a disciplina de custos e acompanhe os indicadores semanalmente.';
  }

  _nivelFromScore(score) {
    if (score < 40) return 'critico';
    if (score < 60) return 'atencao';
    if (score < 80) return 'bom';
    return 'excelente';
  }

  async _getOperationalExpensesInMonth(userId, year, month) {
    const { start, end } = this._monthBounds(year, month);
    const { data, error } = await supabase
      .from('contas_pagar')
      .select('valor')
      .eq('user_id', userId)
      .eq('is_pro_labore', false)
      .gte('data_vencimento', start)
      .lte('data_vencimento', end);
    if (error) throw error;
    return (data || []).reduce((sum, row) => sum + (parseFloat(row.valor) || 0), 0);
  }

  async getScore(userId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const { start: monthStart, end: monthEnd } = this._monthBounds(year, month);
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }

    const [balance, currentReport, prevReport, parcelasPagasResult, contasResult, despesasOpAtual] = await Promise.all([
      transactionController.getBalance(userId),
      transactionController.getMonthlyReport(userId, year, month),
      transactionController.getMonthlyReport(userId, prevYear, prevMonth),
      supabase
        .from('parcelas')
        .select('id, data_vencimento, created_at, recebimento_previsto, atendimentos!inner(user_id)')
        .eq('paga', true)
        .eq('atendimentos.user_id', userId)
        .gte('data_vencimento', monthStart)
        .lte('data_vencimento', monthEnd),
      supabase
        .from('contas_pagar')
        .select('valor, data_vencimento')
        .eq('user_id', userId)
        .eq('status_pagamento', 'pendente')
        .eq('is_pro_labore', false)
        .gte('data_vencimento', now.toISOString().split('T')[0])
        .lte('data_vencimento', new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0]),
      this._getOperationalExpensesInMonth(userId, year, month),
    ]);

    if (parcelasPagasResult.error) throw parcelasPagasResult.error;
    if (contasResult.error) throw contasResult.error;

    const receitas = currentReport.entradas || 0;
    const custos = despesasOpAtual;
    const lucro = receitas - custos;
    const margemPct = receitas > 0 ? (lucro / receitas) * 100 : 0;
    const margemPontos = this._clamp((margemPct / 30) * 40, 0, 40);

    const parcelasPagas = parcelasPagasResult.data || [];
    const emDiaCount = parcelasPagas.filter((p) => {
      const paidDate = p.recebimento_previsto || p.created_at;
      if (!p.data_vencimento || !paidDate) return false;
      return this._toDateOnly(paidDate.slice(0, 10)) <= this._toDateOnly(p.data_vencimento);
    }).length;
    const pontualidadePct = parcelasPagas.length > 0 ? (emDiaCount / parcelasPagas.length) * 100 : 100;
    const pontualidadePontos = this._clamp((pontualidadePct / 100) * 30, 0, 30);

    const saldoAtual = balance.saldo || 0;
    const contas30Dias = (contasResult.data || []).reduce((sum, item) => sum + (parseFloat(item.valor) || 0), 0);
    const coberturaRatio = saldoAtual < 0 || contas30Dias <= 0
      ? (saldoAtual < 0 ? 0 : 2)
      : saldoAtual / contas30Dias;
    const coberturaPontos = saldoAtual < 0
      ? 0
      : this._clamp((coberturaRatio / 1.5) * 20, 0, 20);

    const receitaAtual = currentReport.entradas || 0;
    const receitaAnterior = prevReport.entradas || 0;
    const tendenciaValor = receitaAtual > receitaAnterior
      ? 'growing'
      : receitaAtual < receitaAnterior
        ? 'falling'
        : 'stable';
    const tendenciaPontos = tendenciaValor === 'growing' ? 10 : tendenciaValor === 'stable' ? 5 : 0;

    let score = margemPontos + pontualidadePontos + coberturaPontos + tendenciaPontos;
    const componentes = {
      margem: {
        pontos: parseFloat(margemPontos.toFixed(1)),
        max: 40,
        valor: parseFloat(margemPct.toFixed(1)),
      },
      pontualidade: {
        pontos: parseFloat(pontualidadePontos.toFixed(1)),
        max: 30,
        valor: parseFloat(pontualidadePct.toFixed(1)),
      },
      cobertura: {
        pontos: parseFloat(coberturaPontos.toFixed(1)),
        max: 20,
        valor: parseFloat(coberturaRatio.toFixed(2)),
      },
      tendencia: {
        pontos: tendenciaPontos,
        max: 10,
        valor: tendenciaValor,
      },
    };

    // Componente cobertura_fornecedor (Onda 3.C) — só ativa quando flag Alter ligada.
    try {
      const alterEnabled = await featureFlagService.isEnabled('alter_enabled', userId);
      if (alterEnabled) {
        const cob = await coberturaFornecedorService.calcular(userId, { horizonte_dias: 90 });
        const coberturaGlobal = cob.cobertura_global_pct || 0;
        const coberturaFornecedorPontos = this._clamp((coberturaGlobal / 1.0) * COBERTURA_FORNECEDOR_PESO, 0, COBERTURA_FORNECEDOR_PESO);
        score += coberturaFornecedorPontos;
        componentes.cobertura_fornecedor = {
          pontos: parseFloat(coberturaFornecedorPontos.toFixed(1)),
          max: COBERTURA_FORNECEDOR_PESO,
          valor: parseFloat(coberturaGlobal.toFixed(2)),
          fornecedores_em_risco: (cob.top_em_risco || []).length,
          ativo: true,
        };
      }
    } catch (err) {
      // Mantém score anterior em caso de falha — fallback explícito.
      console.warn('[healthScoreService] componente cobertura_fornecedor falhou:', err.message);
    }

    const scoreRounded = Math.round(score);
    return {
      score: scoreRounded,
      nivel: this._nivelFromScore(scoreRounded),
      componentes,
      recomendacao: this._buildRecommendation(componentes),
    };
  }
}

module.exports = new HealthScoreService();
