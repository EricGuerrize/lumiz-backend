const supabase = require('../db/supabase');
const { formatarMoeda } = require('../utils/currency');

const FORMAS_COM_TAXA = ['credito_avista', 'parcelado', 'debito'];

function _dateStr(d) {
  return d.toISOString().split('T')[0];
}

function _startOfMonthMonthsAgo(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function _ceilCentavos(x) {
  return Math.ceil(Number(x) * 100) / 100;
}

class ProcedimentoCustoService {
  /**
   * Analisa atendimento_procedimentos no período e agrega por procedimento.
   */
  async _aggregarPorProcedimento(userId, meses) {
    const today = new Date();
    const todayStr = _dateStr(today);
    const start = _startOfMonthMonthsAgo(meses);
    const startStr = _dateStr(start);

    const { data: rows, error } = await supabase
      .from('atendimento_procedimentos')
      .select(`
        procedimento_id,
        custo_material,
        valor_cobrado,
        procedimentos ( id, nome ),
        atendimentos!inner (
          user_id,
          data,
          forma_pagamento,
          mdr_percent_applied
        )
      `)
      .eq('atendimentos.user_id', userId)
      .gte('atendimentos.data', startStr)
      .lte('atendimentos.data', todayStr);

    if (error) throw error;

    const byProc = new Map();

    for (const row of rows || []) {
      const pid = row.procedimento_id;
      const nome = row.procedimentos?.nome || 'Procedimento';
      const at = row.atendimentos;
      const custo = parseFloat(row.custo_material) || 0;
      const valorCob = parseFloat(row.valor_cobrado) || 0;
      const forma = (at?.forma_pagamento || '').toLowerCase();
      const mdr = parseFloat(at?.mdr_percent_applied);
      const mdrN = Number.isFinite(mdr) ? mdr : 0;

      if (!byProc.has(pid)) {
        byProc.set(pid, {
          id: pid,
          nome,
          custoSum: 0,
          valorSum: 0,
          count: 0,
          mdrSum: 0,
          mdrCount: 0,
        });
      }
      const g = byProc.get(pid);
      g.custoSum += custo;
      g.valorSum += valorCob;
      g.count += 1;
      if (FORMAS_COM_TAXA.includes(forma)) {
        g.mdrSum += mdrN;
        g.mdrCount += 1;
      }
    }

    return { byProc, periodoMeses: meses, startStr, todayStr };
  }

  _buildRow(agg) {
    const { id, nome, custoSum, valorSum, count, mdrSum, mdrCount } = agg;
    const custo_material_medio = count > 0 ? custoSum / count : 0;
    const valor_cobrado_medio = count > 0 ? valorSum / count : 0;
    const taxa_cartao_media = mdrCount > 0 ? mdrSum / mdrCount : 0;
    const custo_taxa_cartao = valor_cobrado_medio * (taxa_cartao_media / 100);
    const custo_total_real = custo_material_medio + custo_taxa_cartao;
    const margem_real =
      valor_cobrado_medio > 0
        ? ((valor_cobrado_medio - custo_total_real) / valor_cobrado_medio) * 100
        : 0;
    const operando_no_prejuizo = custo_total_real > valor_cobrado_medio;

    let preco_minimo_sem_prejuizo = null;
    const denom = 1 - taxa_cartao_media / 100;
    if (taxa_cartao_media >= 100 || denom <= 1e-9) {
      preco_minimo_sem_prejuizo = null;
    } else if (denom > 0) {
      preco_minimo_sem_prejuizo = _ceilCentavos(custo_material_medio / denom);
    } else {
      preco_minimo_sem_prejuizo = _ceilCentavos(custo_material_medio);
    }

    return {
      id,
      nome,
      valor_cobrado_medio: _ceilCentavos(valor_cobrado_medio),
      custo_material_medio: _ceilCentavos(custo_material_medio),
      taxa_cartao_media: Math.round(taxa_cartao_media * 100) / 100,
      custo_taxa_cartao: _ceilCentavos(custo_taxa_cartao),
      custo_total_real: _ceilCentavos(custo_total_real),
      margem_real: Math.round(margem_real * 10) / 10,
      operando_no_prejuizo,
      preco_minimo_sem_prejuizo,
      atendimentos_no_periodo: count,
    };
  }

  async getCustoRealProcedimentos(userId, meses = 3) {
    const m = Math.min(Math.max(parseInt(String(meses), 10) || 3, 1), 12);

    const { data: todosProcedimentos, error: pe } = await supabase
      .from('procedimentos')
      .select('id, nome')
      .eq('user_id', userId)
      .order('nome');

    if (pe) throw pe;

    const { byProc } = await this._aggregarPorProcedimento(userId, m);

    const procedimentos = (todosProcedimentos || []).map((p) => {
      const agg = byProc.get(p.id);
      if (!agg) {
        return {
          id: p.id,
          nome: p.nome,
          valor_cobrado_medio: 0,
          custo_material_medio: 0,
          taxa_cartao_media: 0,
          custo_taxa_cartao: 0,
          custo_total_real: 0,
          margem_real: 0,
          operando_no_prejuizo: false,
          preco_minimo_sem_prejuizo: null,
          atendimentos_no_periodo: 0,
        };
      }
      return this._buildRow(agg);
    });

    const alertas = procedimentos
      .filter((x) => x.operando_no_prejuizo && x.atendimentos_no_periodo > 0)
      .map((x) => ({
        procedimentoId: x.id,
        nome: x.nome,
        mensagem: `Operando no prejuízo: custo ${formatarMoeda(x.custo_total_real)} > preço médio ${formatarMoeda(x.valor_cobrado_medio)}`,
      }));

    return {
      periodo_meses: m,
      procedimentos,
      alertas,
    };
  }

  async simularImpactoDesconto(userId, procedimentoId, descontoPct) {
    const { data: proc, error: e1 } = await supabase
      .from('procedimentos')
      .select('id, nome')
      .eq('id', procedimentoId)
      .eq('user_id', userId)
      .maybeSingle();

    if (e1) throw e1;
    if (!proc) throw new Error('Procedimento não encontrado');

    const { byProc } = await this._aggregarPorProcedimento(userId, 3);
    const agg = byProc.get(procedimentoId);
    if (!agg || agg.count === 0) {
      return {
        procedimento: proc.nome,
        desconto_pct: descontoPct,
        antes: { valor: 0, margem_pct: 0 },
        depois: { valor: 0, margem_pct: 0 },
        delta_margem_pct: 0,
        alerta: 'Sem dados de atendimentos no período para simular.',
      };
    }

    const row = this._buildRow(agg);
    const valorMedio = row.valor_cobrado_medio;
    const custoTotal = row.custo_total_real;
    const margemAntes = row.margem_real;

    const valorComDesconto = valorMedio * (1 - descontoPct / 100);
    const margemDepois =
      valorComDesconto > 0
        ? ((valorComDesconto - custoTotal) / valorComDesconto) * 100
        : 0;

    const delta_margem_pct = Math.round((margemDepois - margemAntes) * 10) / 10;
    const alerta =
      margemDepois < 20
        ? `Atenção: margem projetada cai para ${Math.round(margemDepois * 10) / 10}% (abaixo de 20%).`
        : null;

    return {
      procedimento: proc.nome,
      desconto_pct: descontoPct,
      antes: {
        valor: valorMedio,
        margem_pct: row.margem_real,
      },
      depois: {
        valor: Math.round(valorComDesconto * 100) / 100,
        margem_pct: Math.round(margemDepois * 10) / 10,
      },
      delta_margem_pct,
      alerta,
    };
  }
}

module.exports = new ProcedimentoCustoService();
