const transactionController = require('../transactionController');
const analyticsService = require('../../services/analyticsService');
const knowledgeService = require('../../services/knowledgeService');
const conversationRuntimeStateService = require('../../services/conversationRuntimeStateService');
const vendorClassificationService = require('../../services/vendorClassificationService');
const recurringExpenseService = require('../../services/recurringExpenseService');
const { rebuildClinicProfile } = require('../../services/agentic/profileBuilderService');
const crypto = require('crypto');
const { formatarMoeda } = require('../../utils/currency');
const {
  recoverValueWithInstallmentsContext,
  extractMixedPaymentSplit
} = require('../../utils/moneyParser');
const { sanitizeClientName } = require('../../utils/procedureKeywords');
const { isLowConfidence, lowConfidenceBanner } = require('../../copy/captureConfirmCopy');
const { applyTransactionCorrection } = require('../../utils/whatsappCorrectionParser');
const {
  extractCostPaymentDetails,
  inferCostTypeAndCategoryFromText
} = require('../../services/onboardingUtils');
const estoqueCopy = require('../../copy/estoqueWhatsappCopy');
const estoqueProdutoService = require('../../services/estoqueProdutoService');
const EstoqueHandler = require('./estoqueHandler');
const { TX_CONFIRM_FOOTER, PAYMENT_CARD_TYPE_FOOTER, PAYMENT_METHOD_FOOTER } = require('../../copy/whatsappMenuMarkers');

/**
 * Handler para transações (vendas e custos)
 */
class TransactionHandler {
  constructor(pendingTransactions) {
    this.pendingTransactions = pendingTransactions;
    this.RUNTIME_FLOW = 'tx_confirm';
    this.RUNTIME_TTL_MS = 15 * 60 * 1000;
  }

  async setPendingTransaction(phone, pending, ttlMs = this.RUNTIME_TTL_MS) {
    this.pendingTransactions.set(phone, pending);
    setTimeout(() => this.pendingTransactions.delete(phone), ttlMs);
    await conversationRuntimeStateService.upsert(phone, this.RUNTIME_FLOW, pending, ttlMs);
  }

  async clearPendingTransaction(phone) {
    this.pendingTransactions.delete(phone);
    await conversationRuntimeStateService.clear(phone, this.RUNTIME_FLOW);
  }

  restorePendingTransaction(phone, pending) {
    if (!phone || !pending) return;
    this.pendingTransactions.set(phone, pending);
    setTimeout(() => this.pendingTransactions.delete(phone), this.RUNTIME_TTL_MS);
  }

  /**
   * Processa requisição de transação
   */
  async handleTransactionRequest(user, intent, phone, originalText) {
    const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente, payment_split } = intent.dados;
    const valorCorrigido = this.recoverTransactionValue(originalText, valor, parcelas);
    const mixedCandidate = extractMixedPaymentSplit(originalText, intent.dados?.valor_total || valorCorrigido || valor);

    if ((!valorCorrigido || Math.abs(valorCorrigido) <= 0) && !mixedCandidate) {
      return 'Não consegui identificar o valor 🤔\n\nMe manda assim: "Botox R$ 2800" ou "Insumos R$ 3200"';
    }

    const intentConfidence = (typeof intent.confidence_score === 'number')
      ? intent.confidence_score
      : (typeof intent.confianca === 'number' ? intent.confianca : null);

    const normalizedData = {
      tipo,
      valor: mixedCandidate?.total || valorCorrigido,
      categoria,
      descricao,
      data,
      forma_pagamento,
      parcelas,
      bandeira_cartao,
      nome_cliente,
      payment_split: payment_split || mixedCandidate?.splits || null,
      valor_total: intent.dados?.valor_total || mixedCandidate?.total || null,
      confidence_score: intentConfidence
    };

    if (tipo === 'saida') {
      this._enrichSaidaFromText(normalizedData, originalText);
      await this._applyVendorClassificationForCost(user, normalizedData, originalText);
    }

    if (normalizedData.tipo === 'entrada') {
      normalizedData.categoria = this.sanitizeSaleCategory(
        originalText,
        normalizedData.categoria,
        normalizedData.nome_cliente
      );
    }

    normalizedData.nome_cliente = this.sanitizeClientName(normalizedData.nome_cliente, normalizedData.categoria);

    if (tipo === 'entrada') {
      const paymentCheck = this.resolvePaymentRequirements(normalizedData, originalText);
      if (paymentCheck.needsInput) {
        await this.setPendingTransaction(phone, {
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
    await this.setPendingTransaction(phone, {
      user,
      dados: normalizedData,
      originalText,
      stage: 'confirm',
      timestamp: Date.now()
    });

    return this.buildConfirmationMessage(normalizedData);
  }

  /**
   * Abre o pending de baixa de estoque pós-venda e devolve o sufixo de pergunta
   * para anexar à mensagem de sucesso. Falha de forma silenciosa (não-crítico).
   * @param {string} phone
   * @param {{atendimentoId?: string, procedimentoNome?: string}} context
   * @returns {Promise<string>}
   * @private
   */
  async _openStockAfterSalePrompt(phone, context = {}) {
    try {
      await conversationRuntimeStateService.upsert(
        phone,
        EstoqueHandler.STOCK_AFTER_SALE_FLOW,
        {
          stage: 'ask',
          atendimentoId: context.atendimentoId || null,
          procedimentoNome: context.procedimentoNome || null,
        },
        EstoqueHandler.STOCK_AFTER_SALE_TTL_MS
      );
      return estoqueCopy.perguntarBaixaPosProcedimento();
    } catch (error) {
      console.error('[ESTOQUE] Falha ao abrir baixa pós-venda:', error.message);
      return '';
    }
  }

  /**
   * Processa confirmação de transação
   */
  async handleConfirmation(phone, message, user) {
    let pending = this.pendingTransactions.get(phone);
    if (!pending) {
      const persisted = await conversationRuntimeStateService.get(phone, this.RUNTIME_FLOW);
      if (persisted?.payload) {
        pending = persisted.payload;
        this.pendingTransactions.set(phone, pending);
        setTimeout(() => this.pendingTransactions.delete(phone), this.RUNTIME_TTL_MS);
      }
    }

    if (!pending) {
      return 'Não encontrei nenhuma transação pendente. Pode enviar novamente?';
    }

    const messageLower = message.toLowerCase().trim();

    if (pending.stage && pending.stage !== 'confirm') {
      if (
        messageLower === 'cancelar' ||
        messageLower === 'nao' ||
        messageLower === 'não'
      ) {
        await this.clearPendingTransaction(phone);
        return 'Registro cancelado ❌\n\nSe quiser registrar, é só me enviar novamente com os dados corretos!';
      }
      return await this.handlePendingPaymentStep(phone, pending, messageLower);
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
      } catch (e) { console.warn('[ANALYTICS] Falha ao registrar confirmação de transação:', e.message); }

      const { tipo, valor, categoria, descricao, data, forma_pagamento, parcelas, bandeira_cartao, nome_cliente, payment_split, recurrence } = pending.dados;
      const traceability = {
        origem: 'whatsapp_text',
        source_phone: phone,
        source_message_id: pending.providerMessageId || pending.messageId || null,
        raw_message: pending.originalText || null,
        is_test: false,
        metadata: {
          confidence_score: pending.dados?.confidence_score ?? null,
          intent_source: pending.dados?.intent_source || null
        }
      };

      // Cria o atendimento (entrada) ou conta a pagar (saída)
      let createdResult = null;
      if (tipo === 'entrada') {
        if (Array.isArray(payment_split) && payment_split.length > 1) {
          const splitGroupId = crypto.randomUUID();
          const splitCode = splitGroupId.slice(0, 8).toUpperCase();
          for (let index = 0; index < payment_split.length; index += 1) {
            const part = payment_split[index];
            await transactionController.createAtendimento(user.id, {
              valor: Math.abs(Number(part.valor) || 0),
              categoria,
              descricao: `${descricao || categoria} [Split ${index + 1}/${payment_split.length} #${splitCode}]`,
              data,
              forma_pagamento: part.metodo || forma_pagamento,
              parcelas: part.parcelas || (part.metodo === 'parcelado' ? parcelas : null),
              bandeira_cartao: part.bandeira_cartao || bandeira_cartao,
              nome_cliente,
              split_group_id: splitGroupId,
              split_part: index + 1,
              split_total_parts: payment_split.length,
              metadata: {
                ...traceability.metadata,
                split_group_id: splitGroupId,
                split_part: index + 1,
                split_total_parts: payment_split.length
              },
              origem: traceability.origem,
              source_phone: traceability.source_phone,
              source_message_id: traceability.source_message_id,
              raw_message: traceability.raw_message,
              is_test: traceability.is_test
            });
          }
        } else {
          createdResult = await transactionController.createAtendimento(user.id, {
            valor: Math.abs(valor),
            categoria,
            descricao: descricao || categoria,
            data,
            forma_pagamento,
            parcelas,
            bandeira_cartao,
            nome_cliente,
            ...traceability
          });
        }
      } else if (recurrence?.months) {
        createdResult = await recurringExpenseService.createRecurring(user.id, pending.dados, traceability);
      } else {
        await transactionController.createContaPagar(user.id, {
          valor: Math.abs(valor),
          descricao: descricao || categoria,
          data,
          categoria,
          tipo: pending.dados.tipo_custo || 'variavel',
          // Parcelas e datas de vencimento extraídas pelo LLM de classificação de intenção.
          // Ex: "30/60/90/120" → parcelas=4, datas_vencimento=[...4 datas...]
          parcelas: pending.dados.parcelas || null,
          condicoes_pagamento: pending.dados.datas_vencimento || null,
          ...traceability
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

      // A cada 10 lançamentos, recalcula perfil assincronamente
      try {
        const { data: countData } = await require('../../db/supabase')
          .from('atendimentos')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id);
        const total = countData?.count ?? 0;
        if (total > 0 && total % 10 === 0) {
          setImmediate(() => rebuildClinicProfile(user.id));
        }
      } catch (_) { /* não-crítico */ }

      analyticsService.track('transaction_created', {
        phone,
        userId: user?.id || null,
        source: 'whatsapp',
        properties: {
          tipo,
          valor: Math.abs(Number(valor) || 0),
          categoria: categoria || null,
          forma_pagamento: forma_pagamento || null,
          parcelas: parcelas || null,
          is_split: Array.isArray(payment_split) && payment_split.length > 1,
          split_parts: Array.isArray(payment_split) ? payment_split.length : 1,
        }
      }).catch(() => {});

      await this.clearPendingTransaction(phone);

      const emoji = tipo === 'entrada' ? '💰' : '💸';
      const tipoTexto = tipo === 'entrada' ? 'Venda' : 'Custo';

      // Item 23 (replanejado): após uma venda, oferece atualizar o estoque usado.
      // Sem baixa automática — abre um pending de confirmação e anexa a pergunta.
      // Só pergunta se o usuário já tem inventário real configurado.
      const stockQuestionSuffix = tipo === 'entrada' && await estoqueProdutoService.hasRealInventory(user.id)
        ? await this._openStockAfterSalePrompt(phone, {
            atendimentoId: createdResult?.id || null,
            procedimentoNome: categoria || descricao || null,
          })
        : '';

      if (tipo === 'entrada' && Array.isArray(payment_split) && payment_split.length > 1) {
        const splitLines = payment_split.map((part, idx) => {
          const method = this.getPaymentMethodText(part.metodo);
          const parcelaTxt = part.metodo === 'parcelado' && part.parcelas ? ` ${part.parcelas}x` : '';
          return `${idx + 1}/${payment_split.length} ${method}${parcelaTxt}: ${formatarMoeda(part.valor)}`;
        }).join('\n');
        return `${emoji} *Vendas vinculadas registradas!*\n\nValor total: ${formatarMoeda(valor)}\n${splitLines}\n\nTudo foi salvo como partes da mesma venda ✅${stockQuestionSuffix}`;
      }
      if (tipo === 'entrada') {
        const paymentText = this.buildRegisteredPaymentText(forma_pagamento, parcelas);
        const clientText = nome_cliente ? `\nCliente: ${nome_cliente}` : '';
        const pricingText = this.buildRegisteredPricingText(createdResult);
        return (
          `${emoji} *${tipoTexto} registrada!* ✅\n\n` +
          `${categoria || descricao || 'Procedimento'} — ${formatarMoeda(valor)}${paymentText}${clientText}\n\n` +
          `${pricingText}` +
          `Isso já entrou no financeiro deste mês.\n` +
          `Quer ver o impacto no saldo? Digite "saldo".` +
          `${stockQuestionSuffix}`
        );
      }

      if (tipo === 'saida' && recurrence?.months) {
        return (
          `${emoji} *Despesa recorrente registrada!* ✅\n\n` +
          `${categoria || descricao} — ${formatarMoeda(valor)}\n` +
          `${createdResult?.months || recurrence.months} vencimento(s) futuros criados como contas a pagar.\n\n` +
          `Me diz "contas a pagar" pra ver o calendário.`
        );
      }

      if (tipo === 'saida' && pending.dados.parcelas > 1) {
        const parcelasCount = pending.dados.parcelas;
        const valorParcela = Math.abs(valor) / parcelasCount;
        return (
          `${emoji} *Despesa parcelada registrada!* ✅\n\n` +
          `${categoria || descricao} — ${formatarMoeda(valor)} em ${parcelasCount}x de ${formatarMoeda(valorParcela)}\n\n` +
          `Me diz "contas a pagar" pra ver o calendário.`
        );
      }

      if (tipo === 'saida') {
        return (
          `${emoji} *Custo registrado!* ✅\n\n` +
          `${formatarMoeda(valor)} — ${categoria || descricao}\n\n` +
          `Quer ver seu saldo? Digite "saldo".`
        );
      }

      return `${emoji} *${tipoTexto} registrado!* ✅\n\n${formatarMoeda(valor)} - ${categoria || descricao}\n\nQuer ver seu saldo? Digite "saldo"`;
    }

    if (
      messageLower === '3' ||
      messageLower === 'corrigir' ||
      messageLower.includes('corrigir') ||
      messageLower.includes('alterar') ||
      messageLower.includes('editar')
    ) {
      const previousCategory = pending.dados?.categoria;
      const correction = this.applyCorrectionToDados(pending.dados, message);
      if (correction.changed) {
        pending.dados = correction.dados;
        await this._maybeLearnVendorFromCostCorrection(user, previousCategory, pending.dados, pending.originalText);
        pending.stage = 'confirm';
        await this.setPendingTransaction(phone, pending);
        return this.buildConfirmationMessage(pending.dados);
      }

      pending.stage = 'awaiting_correction';
      await this.setPendingTransaction(phone, pending);
      return 'Me manda só o que precisa corrigir.\n\nExemplos:\n"valor era 4500"\n"foi no pix"\n"cliente Romulo"\n"procedimento preenchimento"';
    }

    // Cancelamento
    if (
      messageLower === '2' ||
      messageLower === 'não' ||
      messageLower === 'nao' ||
      messageLower === 'n' ||
      messageLower === 'cancelar' ||
      messageLower === '❌ cancelar' ||
      messageLower.includes('cancelar')
    ) {
      try {
        await analyticsService.track('transaction_confirmation_cancelled', {
          phone,
          userId: user?.id || null,
          source: 'whatsapp'
        });
      } catch (e) { console.warn('[ANALYTICS] Falha ao registrar cancelamento de transação:', e.message); }
      await this.clearPendingTransaction(phone);
      return 'Registro cancelado ❌\n\nSe quiser registrar, é só me enviar novamente com os dados corretos!';
    }

    // Resposta inválida
    const previousCategory = pending.dados?.categoria;
    const correction = this.applyCorrectionToDados(pending.dados, message);
    if (correction.changed) {
      pending.dados = correction.dados;
      await this._maybeLearnVendorFromCostCorrection(user, previousCategory, pending.dados, pending.originalText);
      pending.stage = 'confirm';
      await this.setPendingTransaction(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    return 'Não entendi... responde *confirmar*, *cancelar* ou *corrigir* 😊';
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

    let text = '';
    if (isLowConfidence(dados?.confidence_score)) {
      text += `${lowConfidenceBanner()}\n\n`;
    }
    text += `${emoji} *${tipoTexto}*\n\n`;
    text += `💵 *${formatarMoeda(valor)}*\n`;
    text += `📂 ${categoria || 'Sem categoria'}\n`;
    const categoryTrigger = dados.category_trigger || dados._vendor_category_trigger;
    if (categoryTrigger) {
      text += `ℹ️ ${categoryTrigger}\n`;
    }

    if (nome_cliente) {
      text += `👤 ${nome_cliente}\n`;
    }

    if (descricao && !nome_cliente) {
      text += `📝 ${descricao}\n`;
    }

    if (forma_pagamento === 'misto' && Array.isArray(dados.payment_split) && dados.payment_split.length) {
      const splitText = dados.payment_split
        .map((part) => {
          const method = this.getPaymentMethodText(part.metodo);
          const parcelaTxt = part.metodo === 'parcelado' && part.parcelas ? ` ${part.parcelas}x` : '';
          return `${method}${parcelaTxt} ${formatarMoeda(part.valor)}`;
        })
        .join(' + ');
      text += `💳 Split: ${splitText}\n`;
    } else if (forma_pagamento === 'parcelado' && parcelas) {
      const valorParcela = valor / parcelas;
      text += `💳 *${parcelas}x de ${formatarMoeda(valorParcela)}*\n`;
      if (bandeira_cartao) {
        text += `🏷️ ${bandeira_cartao.toUpperCase()}\n`;
      }
    } else if (tipo === 'saida' && parcelas && parcelas > 1) {
      const valorParcela = valor / parcelas;
      text += `📆 *${parcelas}x de ${formatarMoeda(valorParcela)}*`;
      if (Array.isArray(dados.datas_vencimento) && dados.datas_vencimento.length) {
        const previewDates = dados.datas_vencimento
          .slice(0, 3)
          .map((dateStr) => new Date(`${dateStr}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))
          .join(', ');
        text += ` (venc. ${previewDates}${dados.datas_vencimento.length > 3 ? '…' : ''})`;
      }
      text += '\n';
    } else {
      const formaTexto = this.getPaymentMethodText(forma_pagamento);
      if (formaTexto && formaTexto !== 'Não informado') {
        text += `💳 ${formaTexto}\n`;
      }
    }

    text += `📅 ${dataFormatada}\n\n`;
    if (tipo === 'saida' && dados.recurrence?.months) {
      text += `🔁 Recorrente: vou criar ${dados.recurrence.months} conta(s) a pagar futura(s)`;
      if (dados.recurrence.dueDay) {
        text += ` com vencimento no dia ${dados.recurrence.dueDay}`;
      }
      text += '.\n\n';
    }
    text += TX_CONFIRM_FOOTER;
    return text;
  }

  applyCorrectionToDados(dados, message) {
    const parsedCorrection = applyTransactionCorrection(dados, message);
    const next = { ...(parsedCorrection.dados || dados || {}) };
    const raw = String(message || '').trim();
    const normalized = this.normalizeText(raw);
    let changed = parsedCorrection.changed;

    const looksLikeInstallmentOnly = /^\D*\d{1,2}\s*x\D*$/.test(normalized);
    const value = looksLikeInstallmentOnly ? null : this.recoverTransactionValue(raw, null, next.parcelas);
    if (value && value > 0 && /\b(valor|era|foi|deu|total|r\$|\d)/.test(normalized)) {
      next.valor = value;
      changed = true;
    }

    const installments = this.parseInstallments(normalized);
    if (installments && installments > 1) {
      next.forma_pagamento = 'parcelado';
      next.parcelas = installments;
      changed = true;
    }

    const method = this.parsePaymentMethodChoice(normalized) || this.parseCardTypeChoice(normalized);
    if (method && !installments) {
      next.forma_pagamento = method;
      next.parcelas = method === 'parcelado' ? next.parcelas : null;
      changed = true;
    }

    const clientMatch = raw.match(/\b(?:cliente|paciente|nome)\s+(?:e|é|eh|era|foi|:)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{1,40})/i);
    if (clientMatch?.[1]) {
      next.nome_cliente = clientMatch[1].trim();
      changed = true;
    }

    const categoryMatch = raw.match(/\b(?:procedimento|categoria|servico|serviço)\s+(?:e|é|eh|era|foi|:)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{1,50})/i);
    if (categoryMatch?.[1]) {
      next.categoria = categoryMatch[1].trim();
      changed = true;
    } else if (next.tipo === 'entrada') {
      const inferred = this.inferSaleCategoryFromText(raw, next.nome_cliente);
      if (inferred && !/\b(valor|cliente|paciente|pix|credito|debito|cartao|dinheiro|parcelado)\b/.test(normalized)) {
        next.categoria = inferred;
        changed = true;
      }
    }

    if (next.tipo === 'entrada') {
      next.categoria = this.sanitizeSaleCategory(raw, next.categoria, next.nome_cliente);
      next.nome_cliente = this.sanitizeClientName(next.nome_cliente, next.categoria);
    }

    return { changed, dados: next };
  }

  recoverTransactionValue(originalText, currentValue, parcelas) {
    return recoverValueWithInstallmentsContext(originalText, currentValue, parcelas);
  }

  sanitizeSaleCategory(originalText, category, clientName = null) {
    const normalizedCategory = this.normalizeText(category);
    const paymentLikeCategory =
      !normalizedCategory ||
      normalizedCategory === 'procedimento' ||
      /\b(credito|cartao|cartao em|credito em|debito|pix|dinheiro|parcelado|avista|a vista|pagamento)\b/.test(normalizedCategory);

    if (!paymentLikeCategory) {
      return category;
    }

    const inferred = this.inferSaleCategoryFromText(originalText, clientName);
    return inferred || category || 'Procedimento';
  }

  inferSaleCategoryFromText(originalText, clientName = null) {
    const raw = String(originalText || '').trim();
    if (!raw) return null;

    const lower = this.normalizeText(raw);
    const procedureTerms = [
      'limpeza de pele',
      'bioestimulador',
      'preenchimento',
      'harmonizacao',
      'harmonização',
      'botox',
      'toxina',
      'tox',
      'peeling',
      'laser',
      'fios'
    ];

    const found = procedureTerms.find((term) => lower.includes(this.normalizeText(term)));
    if (found) {
      return found.charAt(0).toUpperCase() + found.slice(1);
    }

    const beforeValue = raw
      .split(/\b(?:r\$)?\s*\d/i)[0]
      .replace(/\b(cliente|paciente|fez|pagou|comprou|realizou|atendeu|vendeu|vendi|fiz|procedimento|receita|venda)\b/gi, ' ')
      .trim();

    if (!beforeValue) return null;

    const clientNorm = this.normalizeText(clientName);
    const words = beforeValue
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => {
        const norm = this.normalizeText(word);
        return norm && norm !== clientNorm && !/\b(no|na|em|de|do|da|para|com)\b/.test(norm);
      });

    if (!words.length) return null;
    const candidate = words.slice(-2).join(' ').trim();
    return candidate ? candidate.charAt(0).toUpperCase() + candidate.slice(1) : null;
  }

  sanitizeClientName(nomeCliente, categoria) {
    return sanitizeClientName(nomeCliente, categoria);
  }

  buildRegisteredPaymentText(formaPagamento, parcelas) {
    if (formaPagamento === 'parcelado' && parcelas) {
      return ` no crédito em ${parcelas}x`;
    }
    const label = this.getPaymentMethodText(formaPagamento);
    if (!label || label === 'Não informado') return '';
    return ` no ${label.toLowerCase()}`;
  }

  buildRegisteredPricingText(atendimento) {
    if (!atendimento || atendimento.valor_bruto === undefined || atendimento.valor_liquido === undefined) {
      return '';
    }

    const bruto = Number(atendimento.valor_bruto);
    const liquido = Number(atendimento.valor_liquido);
    const taxa = bruto - liquido;
    if (!Number.isFinite(bruto) || !Number.isFinite(liquido) || taxa <= 0.009) {
      return '';
    }

    const pct = Number(atendimento.mdr_percent_applied || 0);
    const pctText = pct > 0 ? ` (${pct.toFixed(2)}%)` : '';
    const recebimento = atendimento.recebimento_previsto
      ? `\nRecebimento previsto: ${new Date(atendimento.recebimento_previsto).toLocaleDateString('pt-BR')}`
      : '';

    return `Taxa estimada: ${formatarMoeda(taxa)}${pctText}\nLíquido previsto: ${formatarMoeda(liquido)}${recebimento}\n\n`;
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
    const mixedInfo = extractMixedPaymentSplit(originalText, nextDados.valor_total || nextDados.valor);
    if (mixedInfo && mixedInfo.splits?.length) {
      if (mixedInfo.inconsistent) {
        return {
          needsInput: true,
          stage: 'awaiting_mixed_total',
          prompt: 'Percebi um split de pagamento, mas os valores não fecharam. Qual foi o valor total da venda?',
          dados: { ...nextDados, forma_pagamento: 'misto', payment_split: mixedInfo.splits, parcelas: null }
        };
      }
      const cardPart = mixedInfo.splits.find((part) => part.metodo === 'parcelado');
      if (!mixedInfo.total || mixedInfo.total <= 0) {
        return {
          needsInput: true,
          stage: 'awaiting_mixed_total',
          prompt: 'Perfeito. Qual foi o valor total dessa venda mista?',
          dados: { ...nextDados, forma_pagamento: 'misto', payment_split: mixedInfo.splits, parcelas: null }
        };
      }

      if (cardPart && (!cardPart.parcelas || cardPart.parcelas < 2)) {
        return {
          needsInput: true,
          stage: 'awaiting_mixed_installments',
          prompt: 'Na parte do cartão, em quantas parcelas foi? (ex: 6x)',
          dados: { ...nextDados, forma_pagamento: 'misto', valor: mixedInfo.total, payment_split: mixedInfo.splits }
        };
      }

      return {
        needsInput: false,
        dados: {
          ...nextDados,
          valor: mixedInfo.total,
          valor_total: mixedInfo.total,
          forma_pagamento: 'misto',
          payment_split: mixedInfo.splits,
          parcelas: null
        }
      };
    }

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
          PAYMENT_CARD_TYPE_FOOTER,
        dados: { ...nextDados, forma_pagamento: null, parcelas: null }
      };
    }

    if (!hasExplicitPayment && (normalizedMethod === 'credito_avista' || normalizedMethod === null)) {
      return {
        needsInput: true,
        stage: 'awaiting_payment_method',
        prompt:
          PAYMENT_METHOD_FOOTER,
        dados: { ...nextDados, forma_pagamento: null, parcelas: null }
      };
    }

    if (!normalizedMethod || normalizedMethod === 'avista') {
      return {
        needsInput: true,
        stage: 'awaiting_payment_method',
        prompt:
          PAYMENT_METHOD_FOOTER,
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

  async handlePendingPaymentStep(phone, pending, messageLower) {
    const current = pending.dados || {};

    if (pending.stage === 'awaiting_correction') {
      const previousCategory = current.categoria;
      const correction = this.applyCorrectionToDados(current, messageLower);
      if (!correction.changed) {
        return 'Não consegui aplicar essa correção. Tenta assim: "valor era 4500", "foi no pix" ou "cliente Romulo".';
      }
      pending.dados = correction.dados;
      await this._maybeLearnVendorFromCostCorrection(user, previousCategory, pending.dados, pending.originalText);
      pending.stage = 'confirm';
      await this.setPendingTransaction(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    if (pending.stage === 'awaiting_mixed_total') {
      const valueMatch = this.recoverTransactionValue(messageLower, null, null);
      if (!valueMatch || valueMatch <= 0) {
        return 'Não consegui pegar o valor total. Me manda assim: "R$ 5000".';
      }
      const recalculated = extractMixedPaymentSplit(pending.originalText || '', valueMatch);
      const paymentSplit = recalculated?.splits || current.payment_split || [];
      pending.dados = {
        ...current,
        valor: valueMatch,
        valor_total: valueMatch,
        forma_pagamento: 'misto',
        payment_split: paymentSplit
      };

      const cardPart = paymentSplit.find((part) => part.metodo === 'parcelado');
      if (cardPart && (!cardPart.parcelas || cardPart.parcelas < 2)) {
        pending.stage = 'awaiting_mixed_installments';
        await this.setPendingTransaction(phone, pending);
        return 'Na parte do cartão, em quantas parcelas foi? (ex: 6x)';
      }

      pending.stage = 'confirm';
      await this.setPendingTransaction(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    if (pending.stage === 'awaiting_mixed_installments') {
      const installments = this.parseInstallments(messageLower);
      if (!installments || installments < 2) {
        return 'Não entendi as parcelas do cartão. Responda no formato "6x" ou "6".';
      }

      pending.dados = {
        ...current,
        parcelas: installments,
        payment_split: (current.payment_split || []).map((part) =>
          part.metodo === 'parcelado' || part.metodo === 'credito_avista'
            ? { ...part, metodo: 'parcelado', parcelas: installments }
            : part
        )
      };
      pending.stage = 'confirm';
      await this.setPendingTransaction(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    if (pending.stage === 'awaiting_payment_method') {
      const combinedInstallments = this.parseCreditoParceladoCombined(messageLower);
      if (combinedInstallments) {
        pending.dados = { ...current, forma_pagamento: 'parcelado', parcelas: combinedInstallments };
        pending.stage = 'confirm';
        await this.setPendingTransaction(phone, pending);
        return this.buildConfirmationMessage(pending.dados);
      }

      const method = this.parsePaymentMethodChoice(messageLower);
      if (!method) {
        return 'Não entendi. Responde com:\n1 PIX\n2 Débito\n3 Crédito à vista\n4 Cartão parcelado';
      }

      if (method === 'parcelado') {
        pending.dados = { ...current, forma_pagamento: 'parcelado', parcelas: null };
        pending.stage = 'awaiting_installments';
        await this.setPendingTransaction(phone, pending);
        return 'Em quantas parcelas foi no cartão? (ex: 3x)';
      }

      pending.dados = { ...current, forma_pagamento: method, parcelas: null };
      pending.stage = 'confirm';
      await this.setPendingTransaction(phone, pending);
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
        await this.setPendingTransaction(phone, pending);
        return 'Em quantas parcelas foi no cartão? (ex: 3x)';
      }

      pending.dados = { ...current, forma_pagamento: 'credito_avista', parcelas: null };
      pending.stage = 'confirm';
      await this.setPendingTransaction(phone, pending);
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
      await this.setPendingTransaction(phone, pending);
      return this.buildConfirmationMessage(pending.dados);
    }

    pending.stage = 'confirm';
    await this.setPendingTransaction(phone, pending);
    return this.buildConfirmationMessage(pending.dados);
  }

  /**
   * Crédito/cartão parcelado em uma frase (ex.: "crédito em 3x") durante awaiting_payment_method.
   * @param {string} messageLower
   * @returns {number|null} número de parcelas (2–12) ou null
   */
  parseCreditoParceladoCombined(messageLower) {
    const n = this.normalizeText(messageLower);
    const m = n.match(/\b(\d{1,2})x\b/);
    if (!m) return null;
    const installments = parseInt(m[1], 10);
    if (!Number.isFinite(installments) || installments < 2 || installments > 12) return null;
    const creditish =
      /\bcredito\b/.test(n) ||
      /\bcartao\b/.test(n) ||
      /\bparcelad/.test(n);
    if (!creditish) return null;
    return installments;
  }

  parseInstallments(text) {
    return this.normalizeInstallments(text);
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

  _enrichSaidaFromText(normalizedData, originalText) {
    const recurrence = recurringExpenseService.parseRecurrenceFromText(originalText);
    if (recurrence) {
      normalizedData.tipo_custo = 'fixa';
      normalizedData.recurrence = recurrence;
      return;
    }

    const payment = extractCostPaymentDetails(originalText);
    if (payment.parcelas && payment.parcelas > 1) {
      normalizedData.parcelas = payment.parcelas;
      normalizedData.datas_vencimento = payment.datas_vencimento || normalizedData.datas_vencimento || null;
      normalizedData.forma_pagamento = payment.forma_pagamento || normalizedData.forma_pagamento;
    } else if (Array.isArray(payment.datas_vencimento) && payment.datas_vencimento.length > 1) {
      normalizedData.parcelas = payment.datas_vencimento.length;
      normalizedData.datas_vencimento = payment.datas_vencimento;
      normalizedData.forma_pagamento = payment.forma_pagamento || normalizedData.forma_pagamento;
    } else if (payment.forma_pagamento) {
      normalizedData.forma_pagamento = payment.forma_pagamento;
    }

    if (recurringExpenseService.isFixedCostText(originalText)) {
      normalizedData.tipo_custo = 'fixa';
    }

    const forcedType = normalizedData.tipo_custo === 'fixa' ? 'fixo' : null;
    const inferred = inferCostTypeAndCategoryFromText(originalText, forcedType);
    if (inferred.categoria && this._isGenericCostCategory(normalizedData.categoria)) {
      normalizedData.categoria = inferred.categoria;
      normalizedData.category_trigger = inferred.category_trigger;
    }
    if (inferred.tipo && !normalizedData.tipo_custo) {
      normalizedData.tipo_custo = inferred.tipo === 'fixo' ? 'fixa' : 'variavel';
    }
  }

  async _applyVendorClassificationForCost(user, normalizedData, originalText) {
    const vendorName = this._extractVendorNameForLearning(normalizedData, originalText);
    if (!vendorName || !user?.id) return;

    if (!this._isGenericCostCategory(normalizedData.categoria)) return;

    const categoriaVendor = await vendorClassificationService.classifyVendor(vendorName, user.id);
    if (!categoriaVendor) return;

    normalizedData.categoria = vendorClassificationService.normalizeCategoryForDisplay(categoriaVendor);
    normalizedData.category_trigger = `Identifiquei como ${normalizedData.categoria} (${vendorName} está na minha lista de fornecedores).`;
  }

  async _maybeLearnVendorFromCostCorrection(user, previousCategory, dados, originalText) {
    if (!user?.id || !dados || dados.tipo !== 'saida') return;
    if (!dados.categoria || dados.categoria === previousCategory) return;

    const vendorName = this._extractVendorNameForLearning(dados, originalText);
    if (!vendorName) return;

    await vendorClassificationService.learnVendorClassification(vendorName, dados.categoria, user.id);
  }

  _extractVendorNameForLearning(dados, originalText) {
    if (dados?.descricao && dados.descricao !== dados.categoria) {
      return String(dados.descricao).trim();
    }

    const raw = String(originalText || '').trim();
    if (!raw) return null;

    const beforeValue = raw
      .split(/\b(?:r\$)?\s*\d/i)[0]
      .replace(/\b(insumo|insumos|aluguel|despesa|custo|mensal|recorrente|boleto|pix)\b/gi, ' ')
      .trim();

    if (beforeValue && beforeValue.length > 2) {
      return beforeValue.charAt(0).toUpperCase() + beforeValue.slice(1);
    }

    return dados?.descricao ? String(dados.descricao).trim() : null;
  }

  _isGenericCostCategory(categoria) {
    const normalized = this.normalizeText(categoria);
    return !normalized ||
      normalized === 'sem categoria' ||
      normalized === 'outros' ||
      normalized === 'outro' ||
      normalized === 'custo' ||
      normalized === 'despesa' ||
      normalized === 'documento' ||
      normalized === 'fornecedores';
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
      'parcelado': 'Cartão parcelado',
      'misto': 'Pagamento misto'
    };
    return metodos[forma_pagamento] || 'Não informado';
  }
}

function hasParcelasFromText(parcelasFromText) {
  return Number.isFinite(parcelasFromText) && parcelasFromText > 1;
}

module.exports = TransactionHandler;
