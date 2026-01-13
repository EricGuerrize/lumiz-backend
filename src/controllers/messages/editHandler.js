const transactionController = require('../transactionController');
const supabase = require('../../db/supabase');
const { formatarMoeda } = require('../../utils/currency');

/**
 * Handler para edição de transações
 */
class EditHandler {
  constructor(pendingEdits) {
    this.pendingEdits = pendingEdits;
  }

  /**
   * Inicia edição de transação
   */
  async handleEditTransaction(user, phone, intent) {
    const { id, campo, novo_valor } = intent.dados;

    if (!id) {
      return 'Qual transação você quer editar? Me diga o ID ou descreva a transação.';
    }

    // Busca a transação
    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    const { data: conta } = await supabase
      .from('contas_pagar')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    const transacao = atendimento || conta;
    if (!transacao) {
      return 'Não encontrei essa transação. Verifique o ID.';
    }

    // Se tem campo e novo valor, edita direto
    if (campo && novo_valor) {
      return await this.applyEdit(user, phone, transacao, campo, novo_valor, atendimento ? 'atendimento' : 'conta');
    }

    // Senão, pergunta o que quer editar
    this.pendingEdits.set(phone, {
      user,
      transacao,
      tipo: atendimento ? 'atendimento' : 'conta',
      timestamp: Date.now()
    });

    let response = `*EDITAR TRANSAÇÃO*\n\n`;
    response += `Valor: ${formatarMoeda(parseFloat(transacao.valor_total || transacao.valor))}\n`;
    response += `Data: ${new Date(transacao.data).toLocaleDateString('pt-BR')}\n`;
    if (transacao.descricao) {
      response += `Descrição: ${transacao.descricao}\n`;
    }
    response += `\nO que você quer editar?\n`;
    response += `• Valor\n`;
    response += `• Data\n`;
    response += `• Descrição`;

    return response;
  }

  /**
   * Processa confirmação de edição
   */
  async handleEditConfirmation(phone, message, user) {
    const pending = this.pendingEdits.get(phone);
    if (!pending) {
      return 'Não encontrei edição pendente. Pode começar novamente?';
    }

    const messageLower = message.toLowerCase().trim();
    const { transacao, tipo } = pending;

    // Detecta campo e valor
    let campo = null;
    let novoValor = null;

    if (messageLower.includes('valor')) {
      campo = 'valor';
      const valorMatch = message.match(/(\d+[.,]?\d*)/);
      if (valorMatch) {
        novoValor = parseFloat(valorMatch[0].replace(',', '.'));
      }
    } else if (messageLower.includes('data')) {
      campo = 'data';
      // Tenta extrair data da mensagem
      const dataMatch = message.match(/(\d{1,2})\/(\d{1,2})/);
      if (dataMatch) {
        const now = new Date();
        novoValor = `${now.getFullYear()}-${dataMatch[2].padStart(2, '0')}-${dataMatch[1].padStart(2, '0')}`;
      }
    } else if (messageLower.includes('descrição') || messageLower.includes('descricao')) {
      campo = 'descricao';
      novoValor = message.replace(/descrição|descricao/gi, '').trim();
    }

    if (!campo || !novoValor) {
      return 'Não entendi o que você quer editar. Pode ser mais específico?\n\nExemplo: "valor R$ 3000" ou "data 15/12"';
    }

    return await this.applyEdit(user, phone, transacao, campo, novoValor, tipo);
  }

  /**
   * Aplica a edição
   */
  async applyEdit(user, phone, transacao, campo, novoValor, tipo) {
    try {
      const updateData = {};
      
      if (campo === 'valor') {
        if (tipo === 'atendimento') {
          updateData.valor_total = Math.abs(novoValor);
        } else {
          updateData.valor = Math.abs(novoValor);
        }
      } else if (campo === 'data') {
        updateData.data = novoValor;
      } else if (campo === 'descricao') {
        updateData.descricao = novoValor;
      }

      const table = tipo === 'atendimento' ? 'atendimentos' : 'contas_pagar';
      const { error } = await supabase
        .from(table)
        .update(updateData)
        .eq('id', transacao.id)
        .eq('user_id', user.id);

      if (error) {
        throw error;
      }

      this.pendingEdits.delete(phone);
      return `✅ *Transação editada!*\n\n${campo} atualizado para: ${novoValor}`;
    } catch (error) {
      console.error('Erro ao editar transação:', error);
      return 'Erro ao editar transação. Tente novamente.';
    }
  }

  /**
   * Desfaz última transação
   */
  async handleUndoLastTransaction(user, phone) {
    try {
      // Busca última transação
      const atendimentos = await transactionController.getRecentTransactions(user.id, 1);
      
      if (atendimentos.length === 0) {
        return 'Não encontrei transações para desfazer.';
      }

      const ultima = atendimentos[0];
      const table = ultima.type === 'entrada' ? 'atendimentos' : 'contas_pagar';

      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', ultima.id)
        .eq('user_id', user.id);

      if (error) {
        throw error;
      }

      return `✅ *Última transação removida!*\n\n${ultima.type === 'entrada' ? 'Venda' : 'Custo'} de ${formatarMoeda(parseFloat(ultima.amount))} foi removida.`;
    } catch (error) {
      console.error('Erro ao desfazer transação:', error);
      return 'Erro ao desfazer transação. Tente novamente.';
    }
  }
}

module.exports = EditHandler;


