const transactionController = require('../transactionController');
const analyticsService = require('../../services/analyticsService');
const knowledgeService = require('../../services/knowledgeService');
const { formatarMoeda } = require('../../utils/currency');

/**
 * Handler para transações (vendas e custos)
 */
class TransactionHandler {
  constructor(pendingTransactions) {
    this.pendingTransactions = pendingTransactions;
  }

  /**
   * Processa requisição de transação
   */
  async handleTransactionRequest(user, intent, phone, originalText) {
    const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente } = intent.dados;

    if (!valor || Math.abs(valor) <= 0) {
      return 'Não consegui identificar o valor 🤔\n\nMe manda assim: "Botox R$ 2800" ou "Insumos R$ 3200"';
    }

    // Armazena a transação pendente
    this.pendingTransactions.set(phone, {
      user,
      dados: { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente },
      originalText,
      timestamp: Date.now()
    });

    // Monta a mensagem de confirmação visual
    const tipoTexto = tipo === 'entrada' ? 'VENDA' : 'CUSTO';
    const emoji = tipo === 'entrada' ? '💰' : '💸';
    const dataFormatada = new Date(data).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    });

    let message = `${emoji} *${tipoTexto}*\n\n`;
    message += `💵 *${formatarMoeda(valor)}*\n`;
    message += `📂 ${categoria || 'Sem categoria'}\n`;

    // Mostra nome do cliente se disponível
    if (nome_cliente) {
      message += `👤 ${nome_cliente}\n`;
    }

    if (descricao && !nome_cliente) {
      // Só mostra descrição se não tiver cliente (para evitar duplicação)
      message += `📝 ${descricao}\n`;
    }

    // Adiciona informações de pagamento
    if (forma_pagamento === 'parcelado' && parcelas) {
      const valorParcela = valor / parcelas;
      message += `💳 *${parcelas}x de ${formatarMoeda(valorParcela)}*\n`;
      if (bandeira_cartao) {
        message += `🏷️ ${bandeira_cartao.toUpperCase()}\n`;
      }
    } else {
      // Mostra forma de pagamento de forma amigável
      const formaTexto = this.getPaymentMethodText(forma_pagamento);
      message += `💳 ${formaTexto}\n`;
    }

    message += `📅 ${dataFormatada}\n\n`;
    message += `Responde:\n1️⃣ *Confirmar*\n2️⃣ *Cancelar*`;

    return message;
  }

  /**
   * Processa confirmação de transação
   */
  async handleConfirmation(phone, message, user) {
    const pending = this.pendingTransactions.get(phone);
    if (!pending) {
      return 'Não encontrei nenhuma transação pendente. Pode enviar novamente?';
    }

    const messageLower = message.toLowerCase().trim();

    // Confirmação
    if (
      messageLower === '1' ||
      messageLower === 'sim' ||
      messageLower === 's' ||
      messageLower === 'confirmar' ||
      messageLower === '✅ confirmar' ||
      messageLower.includes('confirmar')
    ) {
      try {
        await analyticsService.track('transaction_confirmation_accepted', {
          phone,
          userId: user?.id || null,
          source: 'whatsapp'
        });
      } catch (e) { }

      const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente } = pending.dados;

      // Cria o atendimento (entrada) ou conta a pagar (saída)
      if (tipo === 'entrada') {
        await transactionController.createAtendimento(user.id, {
          valor: Math.abs(valor),
          categoria,
          descricao: descricao || categoria,
          data,
          forma_pagamento,
          parcelas,
          bandeira_cartao,
          nome_cliente
        });
      } else {
        await transactionController.createContaPagar(user.id, {
          valor: Math.abs(valor),
          descricao: descricao || categoria,
          data,
          categoria
        });
      }

      // SALVA INTERAÇÃO PARA APRENDIZADO (CAPTURE)
      if (pending.originalText) {
        knowledgeService.saveInteraction(
          pending.originalText,
          tipo === 'entrada' ? 'registrar_receita' : 'registrar_saida',
          { categoria, valor: Math.abs(valor) },
          user.id
        ).catch(err => console.error('[KNOWLEDGE] Erro ao salvar transação:', err.message));
      }

      this.pendingTransactions.delete(phone);

      const emoji = tipo === 'entrada' ? '💰' : '💸';
      const tipoTexto = tipo === 'entrada' ? 'Venda' : 'Custo';
      return `${emoji} *${tipoTexto} registrada!*\n\n${formatarMoeda(valor)} - ${categoria || descricao}\n\nQuer ver seu saldo? Digite "saldo"`;
    }

    // Cancelamento
    if (
      messageLower === '2' ||
      messageLower === 'não' ||
      messageLower === 'nao' ||
      messageLower === 'n' ||
      messageLower === 'cancelar' ||
      messageLower === 'corrigir' ||
      messageLower === '❌ cancelar' ||
      messageLower.includes('cancelar')
    ) {
      try {
        await analyticsService.track('transaction_confirmation_cancelled', {
          phone,
          userId: user?.id || null,
          source: 'whatsapp'
        });
      } catch (e) { }
      this.pendingTransactions.delete(phone);
      return 'Registro cancelado ❌\n\nSe quiser registrar, é só me enviar novamente com os dados corretos!';
    }

    // Resposta inválida
    return 'Não entendi... responde *1* pra confirmar ou *2* pra cancelar 😊';
  }

  getPaymentMethodText(forma_pagamento) {
    const metodos = {
      'pix': 'PIX',
      'dinheiro': 'Dinheiro',
      'debito': 'Débito',
      'credito_avista': 'Crédito à vista',
      'avista': 'À vista',
      'parcelado': 'Parcelado'
    };
    return metodos[forma_pagamento] || 'À vista';
  }
}

module.exports = TransactionHandler;


