const supabase = require('../db/supabase');
const evolutionService = require('./evolutionService');

class ReminderService {
  async checkAndSendReminders() {
    try {
      const today = new Date();
      const currentDay = today.getDate();
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();

      console.log(`[LEMBRETES] Verificando parcelas para dia ${currentDay}...`);

      // Busca todos os atendimentos parcelados
      const { data: atendimentos, error } = await supabase
        .from('atendimentos')
        .select(`
          *,
          clientes (nome),
          profiles (telefone, nome_completo)
        `)
        .eq('forma_pagamento', 'parcelado')
        .not('parcelas', 'is', null);

      if (error) throw error;

      const remindersSent = [];

      for (const atend of atendimentos || []) {
        // Calcula qual parcela está vencendo hoje
        const dataAtendimento = new Date(atend.data);
        const diaVencimento = dataAtendimento.getDate();

        // Se hoje é o dia do vencimento
        if (currentDay === diaVencimento) {
          // Calcula qual parcela estamos
          const mesesDecorridos =
            (currentYear - dataAtendimento.getFullYear()) * 12 +
            (currentMonth - dataAtendimento.getMonth());

          const parcelaAtual = mesesDecorridos + 1;

          // Verifica se ainda há parcelas pendentes
          if (parcelaAtual <= atend.parcelas) {
            const valorParcela = parseFloat(atend.valor_total) / atend.parcelas;
            const clienteNome = atend.clientes?.nome || 'Cliente';
            const telefone = atend.profiles?.telefone;

            if (telefone) {
              const message = this.formatReminderMessage(
                clienteNome,
                valorParcela,
                parcelaAtual,
                atend.parcelas,
                atend.bandeira_cartao
              );

              try {
                await evolutionService.sendMessage(telefone, message);
                remindersSent.push({
                  atendimento_id: atend.id,
                  cliente: clienteNome,
                  parcela: parcelaAtual,
                  valor: valorParcela
                });
                console.log(`[LEMBRETE] Enviado para ${telefone}: Parcela ${parcelaAtual}/${atend.parcelas}`);
              } catch (sendError) {
                console.error(`[LEMBRETE] Erro ao enviar para ${telefone}:`, sendError.message);
              }
            }
          }
        }
      }

      // Busca contas a pagar vencendo em 3 dias
      const { data: contas, error: contasError } = await supabase
        .from('contas_pagar')
        .select(`
          *,
          profiles (telefone, nome_completo)
        `)
        .eq('status', 'pendente')
        .lte('data_vencimento', this.getDateInDays(3))
        .gte('data_vencimento', today.toISOString().split('T')[0]);

      if (!contasError && contas) {
        for (const conta of contas) {
          const telefone = conta.profiles?.telefone;
          if (telefone) {
            const diasParaVencimento = Math.ceil(
              (new Date(conta.data_vencimento) - today) / (1000 * 60 * 60 * 24)
            );
            const message = this.formatContaReminderMessage(
              conta.descricao || conta.categoria,
              parseFloat(conta.valor),
              conta.data_vencimento,
              diasParaVencimento
            );

            try {
              await evolutionService.sendMessage(telefone, message);
              remindersSent.push({
                tipo: 'conta_pagar',
                conta_id: conta.id,
                descricao: conta.descricao,
                valor: parseFloat(conta.valor),
                vencimento: conta.data_vencimento
              });
              console.log(`[LEMBRETE] Conta enviada para ${telefone}: ${conta.descricao}`);
            } catch (sendError) {
              console.error(`[LEMBRETE] Erro ao enviar conta para ${telefone}:`, sendError.message);
            }
          }
        }
      }

      console.log(`[LEMBRETES] ${remindersSent.length} lembretes enviados`);
      return remindersSent;
    } catch (error) {
      console.error('[LEMBRETES] Erro ao processar:', error);
      throw error;
    }
  }

  getDateInDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  formatContaReminderMessage(descricao, valor, dataVencimento, diasParaVencimento) {
    const dataFormatada = new Date(dataVencimento).toLocaleDateString('pt-BR');
    let message = `*LEMBRETE DE CONTA A PAGAR*\n\n`;
    message += `Descrição: *${descricao}*\n`;
    message += `Valor: *R$ ${valor.toFixed(2)}*\n`;
    message += `Vencimento: *${dataFormatada}*\n\n`;

    if (diasParaVencimento === 0) {
      message += `*Vence HOJE!*\n\n`;
    } else if (diasParaVencimento === 1) {
      message += `*Vence AMANHÃ!*\n\n`;
    } else {
      message += `*Vence em ${diasParaVencimento} dias*\n\n`;
    }

    message += `Para marcar como paga, digite "paguei ${descricao.toLowerCase()}" ou acesse o dashboard.`;

    return message;
  }

  formatReminderMessage(clienteNome, valorParcela, parcelaAtual, totalParcelas, bandeira) {
    let message = `⏰ *LEMBRETE DE PARCELA*\n\n`;
    message += `📋 Cliente: *${clienteNome}*\n`;
    message += `💳 Parcela: *${parcelaAtual}/${totalParcelas}*\n`;
    message += `💵 Valor: *R$ ${valorParcela.toFixed(2)}*\n`;

    if (bandeira) {
      message += `🏷️ Bandeira: ${bandeira.toUpperCase()}\n`;
    }

    message += `\n📅 Vence *HOJE*\n\n`;

    if (parcelaAtual === totalParcelas) {
      message += `🎉 *Última parcela!*`;
    } else {
      const restantes = totalParcelas - parcelaAtual;
      message += `📌 Faltam ${restantes} parcela${restantes > 1 ? 's' : ''}`;
    }

    return message;
  }

  // Função para buscar parcelas pendentes de um usuário (para relatórios)
  async getPendingInstallments(userId) {
    try {
      const today = new Date();
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();

      const { data: atendimentos, error } = await supabase
        .from('atendimentos')
        .select(`
          *,
          clientes (nome),
          atendimento_procedimentos (
            procedimentos (nome)
          )
        `)
        .eq('user_id', userId)
        .eq('forma_pagamento', 'parcelado')
        .not('parcelas', 'is', null);

      if (error) throw error;

      const pendingInstallments = [];

      for (const atend of atendimentos || []) {
        const dataAtendimento = new Date(atend.data);
        const mesesDecorridos =
          (currentYear - dataAtendimento.getFullYear()) * 12 +
          (currentMonth - dataAtendimento.getMonth());

        // Parcelas restantes
        for (let i = mesesDecorridos; i < atend.parcelas; i++) {
          const parcelaNum = i + 1;
          const valorParcela = parseFloat(atend.valor_total) / atend.parcelas;

          // Calcula data de vencimento da parcela
          const dataVencimento = new Date(dataAtendimento);
          dataVencimento.setMonth(dataVencimento.getMonth() + i);

          pendingInstallments.push({
            atendimento_id: atend.id,
            cliente: atend.clientes?.nome || 'Cliente',
            procedimento: atend.atendimento_procedimentos?.[0]?.procedimentos?.nome || 'Procedimento',
            parcela_atual: parcelaNum,
            total_parcelas: atend.parcelas,
            valor_parcela: valorParcela,
            data_vencimento: dataVencimento,
            bandeira: atend.bandeira_cartao
          });
        }
      }

      // Ordena por data de vencimento
      pendingInstallments.sort((a, b) => a.data_vencimento - b.data_vencimento);

      return pendingInstallments;
    } catch (error) {
      console.error('Erro ao buscar parcelas pendentes:', error);
      throw error;
    }
  }
}

module.exports = new ReminderService();
