const supabase = require('../db/supabase');
const evolutionService = require('./evolutionService');
const copy = require('../copy/reminderWhatsappCopy');

const JANELAS_PARCELA = [
  { dias: -3, tipo: 'parcela_3d_antes' },
  { dias: 0,  tipo: 'parcela_dia' },
  { dias: 3,  tipo: 'parcela_atraso_3' },
  { dias: 7,  tipo: 'parcela_atraso_7' },
  { dias: 15, tipo: 'parcela_atraso_15' },
];

const JANELAS_CONTA = [
  { dias: -3, tipo: 'conta_3d_antes' },
  { dias: 0,  tipo: 'conta_dia' },
  { dias: 3,  tipo: 'conta_atraso_3' },
  { dias: 7,  tipo: 'conta_atraso_7' },
  { dias: 15, tipo: 'conta_atraso_15' },
];

class ReminderService {
  dateStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
  }

  async alreadySent(referenciaId, tipoLembrete) {
    const { data } = await supabase
      .from('reminders_sent')
      .select('id')
      .eq('referencia_id', referenciaId)
      .eq('tipo_lembrete', tipoLembrete)
      .maybeSingle();
    return !!data;
  }

  async markSent(userId, referenciaId, tipoLembrete) {
    await supabase.from('reminders_sent').upsert(
      { user_id: userId, referencia_id: referenciaId, tipo_lembrete: tipoLembrete },
      { onConflict: 'referencia_id,tipo_lembrete' }
    );
  }

  async checkAndSendReminders() {
    const remindersSent = [];

    try {
      await this._processarParcelas(remindersSent);
      await this._processarContas(remindersSent);
      console.log(`[LEMBRETES] ${remindersSent.length} lembretes enviados`);
    } catch (error) {
      console.error('[LEMBRETES] Erro ao processar:', error);
      throw error;
    }

    return remindersSent;
  }

  async _processarParcelas(remindersSent) {
    for (const janela of JANELAS_PARCELA) {
      const targetDate = this.dateStr(janela.dias);

      const { data: parcelas, error } = await supabase
        .from('parcelas')
        .select(`
          id, numero, valor, data_vencimento, paga, bandeira_cartao,
          atendimentos!inner (
            user_id, parcelas,
            clientes (nome),
            profiles (telefone)
          )
        `)
        .eq('paga', false)
        .eq('data_vencimento', targetDate);

      if (error) { console.error('[LEMBRETES] Erro parcelas:', error.message); continue; }

      for (const p of parcelas || []) {
        const telefone = p.atendimentos?.profiles?.telefone;
        if (!telefone) continue;

        const sent = await this.alreadySent(p.id, janela.tipo);
        if (sent) continue;

        const clienteNome = p.atendimentos?.clientes?.nome || 'Cliente';
        const totalParcelas = p.atendimentos?.parcelas || 1;
        const valor = parseFloat(p.valor);
        const diasAtraso = Math.abs(janela.dias);

        let message;
        if (janela.dias < 0) {
          message = copy.parcelaAntecipado(clienteNome, valor, p.numero, totalParcelas, diasAtraso);
        } else if (janela.dias === 0) {
          message = copy.parcelaNoDia(clienteNome, valor, p.numero, totalParcelas, p.bandeira_cartao);
        } else {
          message = copy.parcelaAtraso(clienteNome, valor, p.numero, totalParcelas, diasAtraso);
        }

        try {
          await evolutionService.sendMessage(telefone, message);
          await this.markSent(p.atendimentos.user_id, p.id, janela.tipo);
          remindersSent.push({ tipo: janela.tipo, parcela_id: p.id, cliente: clienteNome, valor });
          console.log(`[LEMBRETE] ${janela.tipo} → ${telefone}`);
        } catch (err) {
          console.error(`[LEMBRETE] Erro ao enviar ${janela.tipo}:`, err.message);
        }
      }
    }
  }

  async _processarContas(remindersSent) {
    for (const janela of JANELAS_CONTA) {
      const targetDate = this.dateStr(janela.dias);

      const { data: contas, error } = await supabase
        .from('contas_pagar')
        .select(`*, profiles (telefone)`)
        .eq('status_pagamento', 'pendente')
        .eq('data_vencimento', targetDate);

      if (error) { console.error('[LEMBRETES] Erro contas:', error.message); continue; }

      for (const conta of contas || []) {
        const telefone = conta.profiles?.telefone;
        if (!telefone) continue;

        const sent = await this.alreadySent(conta.id, janela.tipo);
        if (sent) continue;

        const descricao = conta.descricao || conta.categoria || 'Conta';
        const valor = parseFloat(conta.valor);
        const diasAtraso = Math.abs(janela.dias);

        let message;
        if (janela.dias < 0) {
          message = copy.contaAntecipada(descricao, valor, conta.data_vencimento, diasAtraso);
        } else if (janela.dias === 0) {
          message = copy.contaNoDia(descricao, valor, conta.data_vencimento);
        } else {
          message = copy.contaAtraso(descricao, valor, diasAtraso);
        }

        try {
          await evolutionService.sendMessage(telefone, message);
          await this.markSent(conta.user_id, conta.id, janela.tipo);
          remindersSent.push({ tipo: janela.tipo, conta_id: conta.id, descricao, valor });
          console.log(`[LEMBRETE] ${janela.tipo} → ${telefone}`);
        } catch (err) {
          console.error(`[LEMBRETE] Erro ao enviar ${janela.tipo}:`, err.message);
        }
      }
    }
  }

  // Kept for backward compatibility with installmentHandler
  async getPendingInstallments(userId) {
    const { data: parcelas, error } = await supabase
      .from('parcelas')
      .select(`
        id, numero, valor, data_vencimento, bandeira_cartao,
        atendimentos!inner (
          user_id, parcelas,
          clientes (nome),
          atendimento_procedimentos (procedimentos (nome))
        )
      `)
      .eq('paga', false)
      .eq('atendimentos.user_id', userId)
      .gte('data_vencimento', new Date().toISOString().split('T')[0])
      .order('data_vencimento', { ascending: true });

    if (error) throw error;

    return (parcelas || []).map(p => ({
      atendimento_id: p.atendimentos?.id,
      cliente: p.atendimentos?.clientes?.nome || 'Cliente',
      procedimento: p.atendimentos?.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento',
      parcela_atual: p.numero,
      total_parcelas: p.atendimentos?.parcelas || 1,
      valor_parcela: parseFloat(p.valor),
      data_vencimento: new Date(p.data_vencimento),
      bandeira: p.bandeira_cartao,
    }));
  }
}

module.exports = new ReminderService();
