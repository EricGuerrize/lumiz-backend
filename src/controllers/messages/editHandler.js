const transactionController = require('../transactionController');
const supabase = require('../../db/supabase');
const conversationRuntimeStateService = require('../../services/conversationRuntimeStateService');
const vendorClassificationService = require('../../services/vendorClassificationService');
const { formatarMoeda } = require('../../utils/currency');

/**
 * Handler para edição de transações
 */
class EditHandler {
  constructor(pendingEdits) {
    this.pendingEdits = pendingEdits;
    this.RUNTIME_FLOW = 'edit_flow';
    this.RUNTIME_TTL_MS = 10 * 60 * 1000;
  }

  async setPendingEdit(phone, pending) {
    this.pendingEdits.set(phone, pending);
    setTimeout(() => this.pendingEdits.delete(phone), this.RUNTIME_TTL_MS);
    await conversationRuntimeStateService.upsert(phone, this.RUNTIME_FLOW, pending, this.RUNTIME_TTL_MS);
  }

  async clearPendingEdit(phone) {
    this.pendingEdits.delete(phone);
    await conversationRuntimeStateService.clear(phone, this.RUNTIME_FLOW);
  }

  restorePendingEdit(phone, pending) {
    if (!phone || !pending) return;
    this.pendingEdits.set(phone, pending);
    setTimeout(() => this.pendingEdits.delete(phone), this.RUNTIME_TTL_MS);
  }

  /**
   * Inicia edição de transação
   */
  async handleEditTransaction(user, phone, intent) {
    const { id, campo, novo_valor } = intent.dados;

    if (!id) {
      const recentes = await transactionController.getRecentTransactions(user.id, 1);
      if (!recentes.length) {
        return 'Não encontrei lançamentos para corrigir.';
      }

      const ultima = recentes[0];
      await this.setPendingEdit(phone, {
        user,
        transacao: {
          id: ultima.id,
          valor_total: ultima.type === 'entrada' ? ultima.amount : null,
          valor: ultima.type === 'saida' ? ultima.amount : null,
          data: ultima.date,
          descricao: ultima.description,
          categoria: ultima.categories?.name || ultima.category
        },
        tipo: ultima.type === 'entrada' ? 'atendimento' : 'conta',
        timestamp: Date.now()
      });

      return (
        `Vamos corrigir o último lançamento:\n\n` +
        `${ultima.type === 'entrada' ? 'Venda' : 'Custo'} — ${formatarMoeda(parseFloat(ultima.amount || 0))}\n` +
        `${ultima.categories?.name || ultima.category || ultima.description || 'Sem categoria'}\n\n` +
        `Me manda o ajuste, por exemplo:\n` +
        `"valor R$ 3000"\n` +
        `"data 15/12"\n` +
        `"categoria Insumos"\n` +
        `"descrição Botox cliente Maria"`
      );
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
    await this.setPendingEdit(phone, {
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
    response += `• Categoria\n`;
    response += `• Descrição`;

    return response;
  }

  /**
   * Processa confirmação de edição
   */
  async handleEditConfirmation(phone, message, user) {
    let pending = this.pendingEdits.get(phone);
    if (!pending) {
      const persisted = await conversationRuntimeStateService.get(phone, this.RUNTIME_FLOW);
      if (persisted?.payload) {
        pending = persisted.payload;
        this.pendingEdits.set(phone, pending);
      }
    }

    if (!pending) {
      return 'Não encontrei edição pendente. Pode começar novamente?';
    }

    const messageLower = message.toLowerCase().trim();
    const { transacao, tipo } = pending;

    if (['cancelar', 'sair', 'voltar', 'nao', 'não', '2'].includes(messageLower)) {
      await this.clearPendingEdit(phone);
      return 'Edição cancelada ✅';
    }

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
    } else if (messageLower.includes('categoria') || messageLower.includes('classific')) {
      campo = 'categoria';
      const catMatch = message.match(/\b(?:categoria|classifica(?:r|cao|ção)?)\s*(?:e|é|eh|era|foi|para|como|:)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s/.-]{1,50})/i);
      novoValor = catMatch?.[1]?.trim() || message.replace(/categoria|classificacao|classificação/gi, '').trim();
    } else if (messageLower.includes('descrição') || messageLower.includes('descricao')) {
      campo = 'descricao';
      novoValor = message.replace(/descrição|descricao/gi, '').trim();
    }

    if (!campo || !novoValor) {
      return 'Não entendi o que você quer editar. Pode ser mais específico?\n\nExemplo: "valor R$ 3000", "data 15/12" ou "categoria Insumos"';
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
      } else if (campo === 'categoria') {
        updateData.categoria = novoValor;
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

      if (campo === 'categoria' && tipo === 'conta' && user?.id) {
        const vendorName = transacao.descricao || transacao.fornecedor_nome || null;
        if (vendorName) {
          await vendorClassificationService.learnVendorClassification(vendorName, novoValor, user.id);
        }
      }

      await this.clearPendingEdit(phone);
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
      const deleted = await transactionController.deleteTransaction(user.id, ultima.id);
      if (!deleted) throw new Error('Última transação não encontrada para remoção');

      return `✅ *Última transação removida!*\n\n${ultima.type === 'entrada' ? 'Venda' : 'Custo'} de ${formatarMoeda(parseFloat(ultima.amount))} foi removida.`;
    } catch (error) {
      console.error('Erro ao desfazer transação:', error);
      return 'Erro ao desfazer transação. Tente novamente.';
    }
  }
}

module.exports = EditHandler;
