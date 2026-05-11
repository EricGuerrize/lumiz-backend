const supabase = require('../db/supabase');
const evolutionService = require('./evolutionService');
const copy = require('../copy/margemWhatsappCopy');
const { alreadySent, markSent } = require('./reminderSentHelper');

function _isoDate(d) {
  return d.toISOString().split('T')[0];
}

function _monthBounds(referenceDate) {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
  return { start: _isoDate(start), end: _isoDate(end), period: _isoDate(start).slice(0, 7) };
}

class MargemAlertaService {
  async _aggregateMonth(userId, refDate) {
    const { start, end, period } = _monthBounds(refDate);
    const { data, error } = await supabase
      .from('atendimentos')
      .select('id, valor_total, custo_total')
      .eq('user_id', userId)
      .gte('data', start)
      .lte('data', end);
    if (error) throw error;

    const rows = data || [];
    const receita = rows.reduce((s, r) => s + (parseFloat(r.valor_total) || 0), 0);
    const custos = rows.reduce((s, r) => s + (parseFloat(r.custo_total) || 0), 0);
    const count = rows.length;
    const margemPct = receita > 0 ? ((receita - custos) / receita) * 100 : 0;
    const custoMedio = count > 0 ? custos / count : 0;
    const ticketMedio = count > 0 ? receita / count : 0;

    return {
      periodo: period,
      receita: parseFloat(receita.toFixed(2)),
      custos: parseFloat(custos.toFixed(2)),
      margem_pct: parseFloat(margemPct.toFixed(1)),
      atendimentos_count: count,
      custo_por_atendimento: parseFloat(custoMedio.toFixed(2)),
      ticket_medio: parseFloat(ticketMedio.toFixed(2)),
    };
  }

  _buildDiagnostico(atual, anterior) {
    const custoAtual = atual.custo_por_atendimento || 0;
    const custoAnterior = anterior.custo_por_atendimento || 0;
    const ticketAtual = atual.ticket_medio || 0;
    const ticketAnterior = anterior.ticket_medio || 0;
    const countAtual = atual.atendimentos_count || 0;
    const countAnterior = anterior.atendimentos_count || 0;

    const custoVarPct =
      custoAnterior > 0 ? ((custoAtual - custoAnterior) / custoAnterior) * 100 : 0;
    const ticketVarPct =
      ticketAnterior > 0 ? ((ticketAtual - ticketAnterior) / ticketAnterior) * 100 : 0;
    const volumeVarPct =
      countAnterior > 0 ? ((countAtual - countAnterior) / countAnterior) * 100 : 0;

    let causa = 'indefinido';
    if (custoVarPct >= 10) causa = 'custo';
    else if (ticketVarPct <= -5) causa = 'preco';
    else if (Math.abs(volumeVarPct) >= 20) causa = 'volume';

    return {
      custo_por_atendimento_atual: custoAtual,
      custo_por_atendimento_anterior: custoAnterior,
      ticket_medio_atual: ticketAtual,
      ticket_medio_anterior: ticketAnterior,
      causa_provavel: causa,
    };
  }

  _recomendacao(diagnostico) {
    if (diagnostico.causa_provavel === 'custo') {
      const delta = diagnostico.custo_por_atendimento_atual - diagnostico.custo_por_atendimento_anterior;
      const pct =
        diagnostico.custo_por_atendimento_anterior > 0
          ? (delta / diagnostico.custo_por_atendimento_anterior) * 100
          : 0;
      return `Seus custos por atendimento subiram R$${delta.toFixed(0)} (${pct.toFixed(0)}%). Revise fornecedores e insumos.`;
    }
    if (diagnostico.causa_provavel === 'preco') {
      return 'Seu ticket médio caiu no período. Revise descontos e posicionamento de preços.';
    }
    if (diagnostico.causa_provavel === 'volume') {
      return 'Houve mudança relevante no volume/mix de atendimentos. Reavalie agenda e conversão.';
    }
    return 'Acompanhe o diagnóstico detalhado no dashboard para identificar o principal driver da margem.';
  }

  async getMargemComparativa(userId) {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [mesAtual, mesAnterior] = await Promise.all([
      this._aggregateMonth(userId, now),
      this._aggregateMonth(userId, prev),
    ]);

    const delta = parseFloat((mesAtual.margem_pct - mesAnterior.margem_pct).toFixed(1));
    const alertaAtivo = delta < -5;
    const diagnostico = this._buildDiagnostico(mesAtual, mesAnterior);

    return {
      mes_atual: {
        periodo: mesAtual.periodo,
        margem_pct: mesAtual.margem_pct,
        receita: mesAtual.receita,
        custos: mesAtual.custos,
      },
      mes_anterior: {
        periodo: mesAnterior.periodo,
        margem_pct: mesAnterior.margem_pct,
        receita: mesAnterior.receita,
        custos: mesAnterior.custos,
      },
      delta_margem_pct: delta,
      alerta_ativo: alertaAtivo,
      diagnostico,
      recomendacao: this._recomendacao(diagnostico),
    };
  }

  async checkAndAlertMargemCaindo() {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone, is_active')
      .eq('is_active', true)
      .eq('alertas_whatsapp_ativos', true)
      .not('telefone', 'is', null);

    if (error) {
      console.error('[MARGEM] Erro ao buscar perfis:', error.message);
      return [];
    }

    const monthKey = new Date().toISOString().slice(0, 7);
    const tipo = `margem_caindo_${monthKey}`;
    const sent = [];

    for (const profile of profiles || []) {
      try {
        const ja = await alreadySent(profile.id, tipo);
        if (ja) continue;

        const dados = await this.getMargemComparativa(profile.id);
        if (!dados.alerta_ativo) continue;

        const msg = copy.alertaMargemCaindo({
          delta: dados.delta_margem_pct,
          margem_atual: dados.mes_atual.margem_pct,
          margem_anterior: dados.mes_anterior.margem_pct,
          causa: dados.diagnostico.causa_provavel,
        });
        await evolutionService.sendMessage(profile.telefone, msg);
        await markSent(profile.id, profile.id, tipo);
        sent.push({ user_id: profile.id, delta_margem_pct: dados.delta_margem_pct });
      } catch (err) {
        console.error(`[MARGEM] Erro no perfil ${profile.id}:`, err.message);
      }
    }

    return sent;
  }
}

module.exports = new MargemAlertaService();
