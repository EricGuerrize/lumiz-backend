const reminderService = require('../../services/reminderService');
const transactionController = require('../transactionController');
const supabase = require('../../db/supabase');

/**
 * Handler para parcelas e pagamentos
 */
class InstallmentHandler {
  /**
   * Lista parcelas pendentes
   */
  async handlePendingInstallments(user) {
    try {
      const installments = await reminderService.getPendingInstallments(user.id);

      if (installments.length === 0) {
        return `Não tem parcelas pendentes! ✅\n\nPra registrar venda parcelada, é só me mandar:\n_"Botox 2800 3x cartão paciente Maria"_`;
      }

      let response = `💳 *PARCELAS A RECEBER*\n\n`;

      // Total a receber
      const totalReceber = installments.reduce((sum, i) => sum + i.valor_parcela, 0);
      response += `💵 Total pendente: *R$ ${totalReceber.toFixed(2)}*\n`;
      response += `📋 ${installments.length} parcela${installments.length > 1 ? 's' : ''} restante${installments.length > 1 ? 's' : ''}\n\n`;

      // Agrupa por mês
      const porMes = {};
      installments.forEach(inst => {
        const mesAno = inst.data_vencimento.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
        if (!porMes[mesAno]) {
          porMes[mesAno] = [];
        }
        porMes[mesAno].push(inst);
      });

      // Mostra próximas 10 parcelas
      let count = 0;
      for (const [mesAno, parcelas] of Object.entries(porMes)) {
        if (count >= 10) break;

        response += `📅 *${mesAno.toUpperCase()}*\n`;

        for (const p of parcelas) {
          if (count >= 10) break;

          const dataFormatada = p.data_vencimento.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit'
          });

          // Formato: parcela • valor • cliente • procedimento
          let linha = `  ${p.parcela_atual}/${p.total_parcelas} • R$ ${p.valor_parcela.toFixed(2)}`;
          linha += ` • ${p.cliente}`;

          // Adiciona procedimento se disponível
          if (p.procedimento && p.procedimento !== 'Procedimento') {
            linha += ` _(${p.procedimento})_`;
          }

          // Adiciona bandeira se disponível
          if (p.bandeira) {
            linha += ` 🏷️${p.bandeira}`;
          }

          response += `${linha}\n`;
          count++;
        }
        response += `\n`;
      }

      if (installments.length > 10) {
        response += `_... e mais ${installments.length - 10} parcela${installments.length - 10 > 1 ? 's' : ''}_`;
      }

      return response.trim();
    } catch (error) {
      console.error('Erro ao buscar parcelas:', error);
      return 'Erro ao buscar parcelas 😢\n\nTente novamente.';
    }
  }

  /**
   * Marca parcela como paga
   */
  async handleMarkInstallmentPaid(user, phone) {
    try {
      // Busca parcelas pendentes
      const installments = await reminderService.getPendingInstallments(user.id);

      if (installments.length === 0) {
        return 'Não tem parcelas pendentes para marcar como pagas.';
      }

      // Por enquanto, retorna lista para o usuário escolher
      // Futuramente pode implementar seleção interativa
      let response = `*MARCAR PARCELA COMO PAGA*\n\n`;
      response += `Encontrei ${installments.length} parcela(s) pendente(s).\n\n`;
      response += `Para marcar como paga, me diga qual parcela:\n\n`;

      installments.slice(0, 5).forEach((p, index) => {
        const dataFormatada = p.data_vencimento.toLocaleDateString('pt-BR');
        response += `${index + 1}. ${p.cliente} - R$ ${p.valor_parcela.toFixed(2)} (${dataFormatada})\n`;
      });

      response += `\nDigite o número da parcela ou "cancelar".`;

      return response;
    } catch (error) {
      console.error('Erro ao marcar parcela:', error);
      return 'Erro ao processar. Tente novamente.';
    }
  }
}

module.exports = InstallmentHandler;

