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

    const normalizedData = {
      tipo,
      valor,
      categoria,
      descricao,
      data,
      forma_pagamento,
      parcelas,
      bandeira_cartao,
      nome_cliente
    };

    if (tipo === 'entrada') {
      const paymentCheck = this.resolvePaymentRequirements(normalizedData, originalText);
      if (paymentCheck.needsInput) {
        this.pendingTransactions.set(phone, {
          user,
          dados: paymentCheck.dados,
          originalText,
          stage: paymentCheck.stage,
          timestamp: Date.now()
        });
        return paymentCheck.prompt;
      }
      Object.assign(normalizedData, paymentCheck.dados);
    }

    // Armazena a transação pendente
    this.pendingTransactions.set(phone, {
      user,
      dados: normalizedData,
      originalText,
      stage: 'confirm',
      timestamp: Date.now()
    });

    return this.buildConfirmationMessage(normalizedData);
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

    if (pending.stage && pending.stage !== 'confirm') {
      if (
        messageLower === 'cancelar' ||
        messageLower === 'nao' ||
        messageLower === 'não' ||
        messageLower === '2'
      ) {
        this.pendingTransactions.delete(phone);
        return 'Registro cancelado ❌\n\nSe quiser registrar, é só me enviar novamente com os dados corretos!';
      }
      return this.handlePendingPaymentStep(phone, pending, messageLower);
    }

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

  buildConfirmationMessage(dados) {
    const {
      tipo,
      valor,
      categoria,
      descricao,
      data,
      forma_pagamento,
      parcelas,
      bandeira_cartao,
      nome_cliente
    } = dados;

    const tipoTexto = tipo === 'entrada' ? 'VENDA' : 'CUSTO';
    const emoji = tipo === 'entrada' ? '💰' : '💸';
    const dataFormatada = new Date(data).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    });

    let text = `${emoji} *${tipoTexto}*\n\n`;
    text += `💵 *${formatarMoeda(valor)}*\n`;
    text += `📂 ${categoria || 'Sem categoria'}\n`;

    if (nome_cliente) {
      text += `👤 ${nome_cliente}\n`;
    }

    if (descricao && !nome_cliente) {
      text += `📝 ${descricao}\n`;
    }

    if (forma_pagamento === 'parcelado' && parcelas) {
      const valorParcela = valor / parcelas;
      text += `💳 *${parcelas}x de ${formatarMoeda(valorParcela)}*\n`;
      if (bandeira_cartao) {
        text += `🏷️ ${bandeira_cartao.toUpperCase()}\n`;
      }
    } else {
      const formaTexto = this.getPaymentMethodText(forma_pagamento);
      text += `💳 ${formaTexto}\n`;
    }

    text += `📅 ${dataFormatada}\n\n`;
    text += `Responde:\n1️⃣ *Confirmar*\n2️⃣ *Cancelar*`;
    return text;
  }

  resolvePaymentRequirements(dados, originalText) {
    const text = this.normalizeText(originalText);
    const parcelMatch = text.match(/\b(\d{1,2})\s*x\b/);
    const parcelasFromText = parcelMatch ? parseInt(parcelMatch[1], 10) : null;

    const hasPix = text.includes('pix');
    const hasDinheiro = text.includes('dinheiro') || text.includes('especie');
    const hasDebito = text.includes('debito') || text.includes('débito');
    const hasCartao = text.includes('cartao') || text.includes('cartão');
    const hasCredito = text.includes('credito') || text.includes('crédito');
    const hasAvista = text.includes('avista') || text.includes('a vista') || text.includes('à vista');
    const hasParceladoWord = text.includes('parcelado') || Boolean(parcelasFromText && parcelasFromText > 1);
    const hasExplicitPayment =
      hasPix || hasDinheiro || hasDebito || hasCartao || hasCredito || hasAvista || hasParceladoWord;

    const nextDados = { ...dados };
    let normalizedMethod = this.normalizePaymentMethod(nextDados.forma_pagamento, nextDados.parcelas);

    if (hasPix) normalizedMethod = 'pix';
    if (hasDinheiro) normalizedMethod = 'dinheiro';
    if (hasDebito) normalizedMethod = 'debito';
    if (hasParcelasFromText(parcelasFromText)) {
      normalizedMethod = 'parcelado';
      nextDados.parcelas = parcelasFromText;
    }

    if ((hasCartao || hasCredito) && !hasDebito && !hasParceladoWord && !hasAvista) {
      return {
        needsInput: true,
        stage: 'awaiting_card_type',
        prompt:
          'No cartão foi como?\n\n1️⃣ Crédito à vista\n2️⃣ Parcelado\n\nResponde com 1 ou 2.',
        dados: { ...nextDados, forma_pagamento: null, parcelas: null }
      };
    }

    if (!hasExplicitPayment && (normalizedMethod === 'credito_avista' || normalizedMethod === null)) {
      return {
        needsInput: true,
        stage: 'awaiting_payment_method',
        prompt:
          'Qual foi a forma de pagamento dessa venda?\n\n1️⃣ PIX\n2️⃣ Débito\n3️⃣ Crédito à vista\n4️⃣ Cartão parcelado',
        dados: { ...nextDados, forma_pagamento: null, parcelas: null }
      };
    }

    if (!normalizedMethod || normalizedMethod === 'avista') {
      return {
        needsInput: true,
        stage: 'awaiting_payment_method',
        prompt:
          'Qual foi a forma de pagamento dessa venda?\n\n1️⃣ PIX\n2️⃣ Débito\n3️⃣ Crédito à vista\n4️⃣ Cartão parcelado',
        dados: { ...nextDados, forma_pagamento: null, parcelas: null }
      };
    }

    if (normalizedMethod === 'parcelado') {
      const totalParcelas = this.normalizeInstallments(nextDados.parcelas || parcelasFromText);
      if (!totalParcelas) {
        return {
          needsInput: true,
          stage: 'awaiting_installments',
          prompt: 'Em quantas parcelas foi no cartão? (ex: 3x)',
          dados: { ...nextDados, forma_pagamento: 'parcelado', parcelas: null }
        };
      }
      nextDados.parcelas = totalParcelas;
    } else {
      nextDados.parcelas = null;
    }

    nextDados.forma_pagamento = normalizedMethod;

    return {
      needsInput: false,
      dados: nextDados
    };
  }

  handlePendingPaymentStep(phone, pending, messageLower) {
    const current = pending.dados || {};

    if (pending.stage === 'awaiting_payment_method') {
      const method = this.parsePaymentMethodChoice(messageLower);
      if (!method) {
        return 'Não entendi. Responde com:\n1 PIX\n2 Débito\n3 Crédito à vista\n4 Cartão parcelado';
      }

      if (method === 'parcelado') {
        pending.dados = { ...current, forma_pagamento: 'parcelado', parcelas: null };
        pending.stage = 'awaiting_installments';
        this.pendingTransactions.set(phone, pending);
        return 'Em quantas parcelas foi no cartão? (ex: 3x)';
      }

      pending.dados = { ...current, forma_pagamento: method, parcelas: null };
      pending.stage = 'confirm';
      this.pendingTransactions.set(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    if (pending.stage === 'awaiting_card_type') {
      const cardType = this.parseCardTypeChoice(messageLower);
      if (!cardType) {
        return 'Não entendi. Responde com 1 para crédito à vista ou 2 para parcelado.';
      }

      if (cardType === 'parcelado') {
        pending.dados = { ...current, forma_pagamento: 'parcelado', parcelas: null };
        pending.stage = 'awaiting_installments';
        this.pendingTransactions.set(phone, pending);
        return 'Em quantas parcelas foi no cartão? (ex: 3x)';
      }

      pending.dados = { ...current, forma_pagamento: 'credito_avista', parcelas: null };
      pending.stage = 'confirm';
      this.pendingTransactions.set(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    if (pending.stage === 'awaiting_installments') {
      const installments = this.normalizeInstallments(messageLower);
      if (!installments) {
        return 'Não consegui entender as parcelas. Me manda no formato "3x" ou só o número.';
      }

      if (installments <= 1) {
        pending.dados = { ...current, forma_pagamento: 'credito_avista', parcelas: null };
      } else {
        pending.dados = { ...current, forma_pagamento: 'parcelado', parcelas: installments };
      }
      pending.stage = 'confirm';
      this.pendingTransactions.set(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    pending.stage = 'confirm';
    this.pendingTransactions.set(phone, pending);
    return this.buildConfirmationMessage(pending.dados);
  }

  parsePaymentMethodChoice(text) {
    const normalized = this.normalizeText(text);
    if (normalized === '1' || normalized.includes('pix')) return 'pix';
    if (normalized === '2' || normalized.includes('debito') || normalized.includes('débito')) return 'debito';
    if (
      normalized === '3' ||
      normalized.includes('credito a vista') ||
      normalized.includes('credito avista') ||
      normalized.includes('a vista') ||
      normalized.includes('à vista')
    ) {
      return 'credito_avista';
    }
    if (normalized === '4' || normalized.includes('parcelado') || normalized.match(/\b\d{1,2}x\b/)) {
      return 'parcelado';
    }
    return null;
  }

  parseCardTypeChoice(text) {
    const normalized = this.normalizeText(text);
    if (
      normalized === '1' ||
      normalized.includes('avista') ||
      normalized.includes('a vista') ||
      normalized.includes('à vista')
    ) {
      return 'credito_avista';
    }
    if (normalized === '2' || normalized.includes('parcelado') || normalized.match(/\b\d{1,2}x\b/)) {
      return 'parcelado';
    }
    return null;
  }

  normalizeInstallments(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number' && Number.isFinite(input)) {
      if (input >= 1 && input <= 12) return Math.round(input);
      return null;
    }
    const match = String(input).match(/(\d{1,2})/);
    if (!match) return null;
    const parsed = parseInt(match[1], 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return null;
    return parsed;
  }

  normalizePaymentMethod(method, installments) {
    const normalized = this.normalizeText(method);
    if (!normalized) return null;
    if (normalized.includes('pix')) return 'pix';
    if (normalized.includes('dinheiro') || normalized.includes('especie')) return 'dinheiro';
    if (normalized.includes('debito') || normalized.includes('débito')) return 'debito';
    if (normalized.includes('parcelado')) return 'parcelado';
    if (
      normalized.includes('credito') ||
      normalized.includes('cartao') ||
      normalized.includes('cartão')
    ) {
      return this.normalizeInstallments(installments) > 1 ? 'parcelado' : 'credito_avista';
    }
    if (normalized === 'avista' || normalized === 'a vista' || normalized === 'à vista') {
      return 'credito_avista';
    }
    return normalized;
  }

  normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  getPaymentMethodText(forma_pagamento) {
    const metodos = {
      'pix': 'PIX',
      'dinheiro': 'Dinheiro',
      'debito': 'Débito',
      'credito_avista': 'Crédito à vista',
      'avista': 'Crédito à vista',
      'parcelado': 'Parcelado'
    };
    return metodos[forma_pagamento] || 'Não informado';
  }
}

function hasParcelasFromText(parcelasFromText) {
  return Number.isFinite(parcelasFromText) && parcelasFromText > 1;
}

module.exports = TransactionHandler;
