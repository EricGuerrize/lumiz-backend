const supabase = require('../db/supabase');
const cashflowService = require('./cashflowService');
const transactionController = require('../controllers/transactionController');
const evolutionService = require('./evolutionService');
const copy = require('../copy/emergencyWhatsappCopy');

class EmergencyModeService {
  async getStatus(userId) {
    const projection = await cashflowService.getCashflowProjection(userId, 30);

    let saldoMinimo = projection.saldoAtual;
    let dataRisco = null;
    let runningBalance = projection.saldoAtual;

    for (const day of projection.days) {
      runningBalance += (day.entradas || 0) - (day.saidas || 0);
      if (runningBalance < saldoMinimo) {
        saldoMinimo = runningBalance;
        dataRisco = day.data;
      }
    }

    const alert = saldoMinimo < 0;

    return {
      alert,
      saldoAtual: projection.saldoAtual,
      saldoMinimo: parseFloat(saldoMinimo.toFixed(2)),
      dataRisco,
      diasAnalisados: 30,
    };
  }

  async checkAndAlert() {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, telefone')
      .not('telefone', 'is', null);

    if (error) {
      console.error('[EMERGENCY] Erro ao buscar perfis:', error.message);
      return [];
    }

    const alertsSent = [];

    for (const profile of profiles || []) {
      try {
        const status = await this.getStatus(profile.id);
        if (status.alert) {
          const message = copy.alertaCaixaNegativo(status.saldoMinimo, status.dataRisco);
          await evolutionService.sendMessage(profile.telefone, message);
          try {
            await supabase.from('emergency_alert_history').insert({
              user_id: profile.id,
              tipo: 'caixa_negativo',
              saldo_minimo: status.saldoMinimo,
              data_risco: status.dataRisco,
              canal: 'whatsapp',
            });
          } catch (histErr) {
            console.warn('[EMERGENCY] Histórico não gravado:', histErr.message);
          }
          alertsSent.push({ user_id: profile.id, saldoMinimo: status.saldoMinimo, dataRisco: status.dataRisco });
          console.log(`[EMERGENCY] Alerta enviado para ${profile.telefone}`);
        }
      } catch (err) {
        console.error(`[EMERGENCY] Erro para ${profile.id}:`, err.message);
      }
    }

    console.log(`[EMERGENCY] ${alertsSent.length} alertas enviados`);
    return alertsSent;
  }

  _dateStr(d) {
    return d.toISOString().split('T')[0];
  }

  _addDays(date, days) {
    const x = new Date(date);
    x.setDate(x.getDate() + days);
    return x;
  }

  _recLine(prioridade) {
    const n = Number(prioridade) || 5;
    if (n <= 2) return 'Pague primeiro';
    if (n >= 4) return 'Pode aguardar';
    return 'Prioridade média: acompanhe a data de vencimento';
  }

  /**
   * Painel detalhado: status atual + prioridade de pagamentos + recebíveis + antecipação sugerida.
   */
  async getEmergenciaDetalhada(userId) {
    const status = await this.getStatus(userId);

    const today = new Date();
    const todayStr = this._dateStr(today);
    const end30 = this._dateStr(this._addDays(today, 30));
    const end15 = this._dateStr(this._addDays(today, 15));
    const end7 = this._dateStr(this._addDays(today, 7));

    const { data: contas30, error: e1 } = await supabase
      .from('contas_pagar')
      .select(
        'id, descricao, valor, data_vencimento, categoria, prioridade, status_pagamento'
      )
      .eq('user_id', userId)
      .eq('status_pagamento', 'pendente')
      .gte('data_vencimento', todayStr)
      .lte('data_vencimento', end30)
      .order('prioridade', { ascending: true })
      .order('data_vencimento', { ascending: true });

    if (e1) throw e1;

    const prioridade_pagamentos = (contas30 || []).map((c) => ({
      descricao: c.descricao,
      valor: parseFloat(c.valor) || 0,
      data_vencimento: c.data_vencimento,
      categoria: c.categoria || null,
      prioridade: Number(c.prioridade) || 5,
      recomendacao: this._recLine(c.prioridade),
    }));

    const { data: parcelas15, error: e2 } = await supabase
      .from('parcelas')
      .select('valor, valor_liquido, data_vencimento, atendimentos!inner(user_id)')
      .eq('paga', false)
      .eq('atendimentos.user_id', userId)
      .gte('data_vencimento', todayStr)
      .lte('data_vencimento', end15);

    if (e2) throw e2;

    const total_a_receber = (parcelas15 || []).reduce(
      (s, p) => s + parseFloat(p.valor_liquido ?? p.valor ?? 0),
      0
    );

    const recebiveis_proximos_15d = {
      total_a_receber: Math.round(total_a_receber * 100) / 100,
      mensagem: `Nos próximos 15 dias entram R$ ${total_a_receber.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} de recebível`,
    };

    const balance = await transactionController.getBalance(userId);
    const saldo_atual = parseFloat(balance.saldo) || 0;

    const { data: contas7, error: e3 } = await supabase
      .from('contas_pagar')
      .select('valor')
      .eq('user_id', userId)
      .eq('status_pagamento', 'pendente')
      .gte('data_vencimento', todayStr)
      .lte('data_vencimento', end7);

    if (e3) throw e3;

    const total_contas_vencendo_7d = (contas7 || []).reduce(
      (s, c) => s + parseFloat(c.valor || 0),
      0
    );

    const gap = total_contas_vencendo_7d - saldo_atual;
    const antecipacao_sugerida =
      gap > 0
        ? {
            necessaria: true,
            valor: Math.round(gap * 100) / 100,
            mensagem: `Antecipe pelo menos R$ ${gap.toLocaleString('pt-BR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} para cobrir os próximos 7 dias`,
          }
        : {
            necessaria: false,
            valor: 0,
            mensagem: 'Caixa suficiente para os próximos 7 dias',
          };

    return {
      ...status,
      saldo_atual: Math.round(saldo_atual * 100) / 100,
      prioridade_pagamentos,
      recebiveis_proximos_15d,
      antecipacao_sugerida,
    };
  }

  /**
   * Histórico de alertas enviados (auditoria), mais recentes primeiro.
   * @param {string} userId
   * @param {number} [limit=50]
   */
  async getAlertHistory(userId, limit = 50) {
    const lim = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
    const { data, error } = await supabase
      .from('emergency_alert_history')
      .select('id, tipo, saldo_minimo, data_risco, canal, enviado_em')
      .eq('user_id', userId)
      .order('enviado_em', { ascending: false })
      .limit(lim);

    if (error) throw error;
    return { limit: lim, itens: data || [] };
  }
}

module.exports = new EmergencyModeService();
