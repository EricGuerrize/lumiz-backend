const userController = require('../userController');
const onboardingFlowService = require('../../services/onboardingFlowService');
const onboardingService = require('../../services/onboardingService');
const documentService = require('../../services/documentService');
const supplierDocumentService = require('../../services/supplierDocumentService');
const userRateLimit = require('../../middleware/userRateLimit');
const { normalizePhone } = require('../../utils/phone');
const { isLowConfidence, lowConfidenceBanner } = require('../../copy/captureConfirmCopy');
const supplierCopy = require('../../copy/supplierDocWhatsappCopy');

/**
 * Handler para documentos e imagens
 */
class DocumentHandler {
  constructor(pendingDocumentTransactions) {
    this.pendingDocumentTransactions = pendingDocumentTransactions;
    this.PENDING_CONFIRMATION_TTL_MS = 15 * 60 * 1000;
  }

  normalizePhoneKey(phone) {
    return normalizePhone(phone) || phone;
  }

  /**
   * Prepend banner de baixa confiança quando o OCR retornou confidence_score < 0.8
   * (no documento ou em qualquer transação extraída).
   */
  _prefixLowConfidence(response, result) {
    if (!response || typeof response !== 'string') return response;
    const docScore = typeof result?.confidence_score === 'number' ? result.confidence_score : null;
    const transacoes = Array.isArray(result?.transacoes) ? result.transacoes : [];
    const minTransactionScore = transacoes.reduce((min, t) => {
      const s = typeof t?.confidence_score === 'number' ? t.confidence_score : null;
      if (s === null) return min;
      if (min === null) return s;
      return Math.min(min, s);
    }, null);
    const lowDoc = isLowConfidence(docScore);
    const lowTx = isLowConfidence(minTransactionScore);
    if (!lowDoc && !lowTx) return response;
    return `${lowConfidenceBanner()}\n\n${response}`;
  }

  _setPendingDoc(normalizedPhone, value) {
    this.pendingDocumentTransactions.set(normalizedPhone, value);
    setTimeout(() => this.pendingDocumentTransactions.delete(normalizedPhone), this.PENDING_CONFIRMATION_TTL_MS);
  }

  async persistPendingConfirmation(phone, user, transacoes) {
    try {
      const normalizedPhone = this.normalizePhoneKey(phone);
      const state = await onboardingService.getState(normalizedPhone);
      if (!state?.id) return;

      const newData = {
        ...(state.data || {}),
        realtime: {
          ...(state.data?.realtime || {}),
          pending_document_confirmation: {
            tipo: 'doc_confirmation',
            created_at: new Date().toISOString(),
            user_id: user?.id || null,
            transacoes: Array.isArray(transacoes) ? transacoes : []
          }
        }
      };

      await onboardingService.updateRecord(state.id, { data: newData });
    } catch (error) {
      console.warn('[DOC_CONFIRM] Falha ao persistir pending de documento:', error.message);
    }
  }

  async clearPersistedPendingConfirmation(phone) {
    try {
      const normalizedPhone = this.normalizePhoneKey(phone);
      const state = await onboardingService.getState(normalizedPhone);
      if (!state?.id) return;

      const realtime = { ...(state.data?.realtime || {}) };
      if (!realtime.pending_document_confirmation) return;
      delete realtime.pending_document_confirmation;

      const newData = {
        ...(state.data || {}),
        realtime
      };

      await onboardingService.updateRecord(state.id, { data: newData });
    } catch (error) {
      console.warn('[DOC_CONFIRM] Falha ao limpar pending persistido:', error.message);
    }
  }

  async getPersistedPendingConfirmation(phone) {
    try {
      const normalizedPhone = this.normalizePhoneKey(phone);
      const state = await onboardingService.getState(normalizedPhone);
      const pending = state?.data?.realtime?.pending_document_confirmation;

      if (!pending || !Array.isArray(pending.transacoes) || pending.transacoes.length === 0) {
        return null;
      }

      const createdAt = pending.created_at ? new Date(pending.created_at).getTime() : 0;
      if (!createdAt || Number.isNaN(createdAt)) {
        return null;
      }

      if (Date.now() - createdAt > this.PENDING_CONFIRMATION_TTL_MS) {
        await this.clearPersistedPendingConfirmation(normalizedPhone);
        return null;
      }

      return pending;
    } catch (error) {
      console.warn('[DOC_CONFIRM] Falha ao ler pending persistido:', error.message);
      return null;
    }
  }

  /**
   * Onda 2.B — Detecta se o resultado do OCR corresponde a NF/Boleto e, em caso
   * positivo, prepara um pending especial de "supplier_doc" para confirmação.
   *
   * @param {Object} ctx
   * @param {Object} ctx.user
   * @param {string} ctx.normalizedPhone
   * @param {Object} ctx.result - output bruto do documentService
   * @param {Buffer|null} [ctx.buffer] - quando disponível, gera fileHash determinístico
   * @returns {Promise<{response: string, parsed: Object} | null>} null se não é supplier doc
   */
  async _maybePrepareSupplierDocPending({ user, normalizedPhone, result, buffer = null }) {
    if (!result || !result.tipo_documento) return null;
    const tipoBruto = String(result.tipo_documento).toLowerCase();
    const isSupplierDoc = ['nota_fiscal', 'boleto', 'fatura', 'comprovante'].some((t) => tipoBruto.includes(t));
    if (!isSupplierDoc) return null;

    const parsed = supplierDocumentService.fromDocumentResult(result);
    if (!parsed.valor_total || parsed.valor_total <= 0) return null;

    const fileHash = buffer ? supplierDocumentService.computeFileHash(buffer) : null;

    let supplierDoc = null;
    try {
      supplierDoc = await supplierDocumentService.persist(user.id, parsed, {
        fileHash,
        sourcePhone: normalizedPhone,
        fornecedorId: null
      });
    } catch (err) {
      const message = String(err?.message || '');
      if (message.includes('uq_supplier_documents_user_hash')) {
        console.warn('[SUPPLIER_DOC] Documento já registrado anteriormente (hash duplicado), seguindo sem persistir.');
      } else {
        console.error('[SUPPLIER_DOC] Falha ao persistir supplier_document:', message);
      }
    }

    const pending = {
      user,
      isSupplierDoc: true,
      supplier_document_id: supplierDoc?.id || null,
      parsed,
      timestamp: Date.now()
    };
    this._setPendingDoc(normalizedPhone, pending);
    await this.persistPendingConfirmation(normalizedPhone, user, []);

    const response = supplierCopy.confirmacaoSupplierDoc(parsed, {
      isLowConfidence: isLowConfidence(parsed.confidence_score)
    });
    return { response, parsed };
  }

  /**
   * Verifica rate limit para operações de OCR/documento
   * @returns {string|null} Mensagem de erro ou null se permitido
   */
  async checkDocumentRateLimit(phone) {
    const result = await userRateLimit.checkExpensiveOperationLimit(phone, 'document');
    if (!result.allowed) {
      const waitMinutes = Math.ceil((result.resetAt.getTime() - Date.now()) / 60000);
      return `⏳ Você enviou muitos documentos em pouco tempo.\n\nPor favor, aguarde ${waitMinutes} minuto${waitMinutes > 1 ? 's' : ''} antes de enviar mais.\n\nDica: Você pode registrar manualmente digitando, por exemplo:\n_"Custo R$ 150 conta de luz"_`;
    }
    return null;
  }

  /**
   * Processa mensagem de documento (PDF/imagem)
   */
  async handleDocumentMessage(phone, mediaUrl, fileName, messageKey = null) {
    try {
      const normalizedPhone = this.normalizePhoneKey(phone);
      // Verifica rate limit antes de processar
      const rateLimitError = await this.checkDocumentRateLimit(normalizedPhone);
      if (rateLimitError) {
        return rateLimitError;
      }

      // Verifica se usuário está cadastrado
      if (await onboardingFlowService.ensureOnboardingState(normalizedPhone)) {
        return 'Complete seu cadastro primeiro! 😊\n\nQual o nome da sua clínica?';
      }

      const user = await userController.findUserByPhone(normalizedPhone);
      if (!user) {
        await onboardingFlowService.startNewOnboarding(normalizedPhone);
        return `Oi, prazer! Sou a Lumiz 👋\n\nSou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.\n\nAntes de começarmos, veja este vídeo rapidinho para entender como eu te ajudo a controlar tudo sem planilhas.\n\nVou te ajudar a cuidar das finanças da sua clínica de forma simples, automática e sem complicação.\n\nPara começar seu teste, qual é o nome da sua clínica?`;
      }

      // Processa o documento (PDF ou imagem)
      const result = await documentService.processImage(mediaUrl, messageKey);

      // Onda 2.B — caminho rápido para NF/boleto: pending de supplier_doc
      const supplierFlow = await this._maybePrepareSupplierDocPending({
        user,
        normalizedPhone,
        result
      });
      if (supplierFlow) return supplierFlow.response;

      const baseResponse = documentService.formatDocumentSummary(result);
      const response = this._prefixLowConfidence(baseResponse, result);

      if (result.processor === 'tesseract') {
        return response + '\n\nO que deseja fazer com essa informação? Me diga se é uma venda ou um custo e o valor.';
      }

      if (result.transacoes && result.transacoes.length > 0) {
        this._setPendingDoc(normalizedPhone, {
          user,
          transacoes: result.transacoes,
          timestamp: Date.now()
        });
        await this.persistPendingConfirmation(normalizedPhone, user, result.transacoes);
      }

      return response;
    } catch (error) {
      console.error('Erro ao processar documento:', error);
      return 'Erro ao analisar documento 😢\n\nTente enviar uma foto ou registre manualmente.';
    }
  }

  /**
   * Processa mensagem de imagem
   */
  async handleImageMessage(phone, mediaUrl, caption, messageKey = null) {
    try {
      const normalizedPhone = this.normalizePhoneKey(phone);
      // Verifica rate limit antes de processar
      const rateLimitError = await this.checkDocumentRateLimit(normalizedPhone);
      if (rateLimitError) {
        return rateLimitError;
      }

      // Verifica se está em onboarding
      if (await onboardingFlowService.ensureOnboardingState(normalizedPhone)) {
        const step = onboardingFlowService.getOnboardingStep(normalizedPhone);

        // AHA_COSTS_UPLOAD: repassa a mídia diretamente ao onboarding
        if (step === 'AHA_COSTS_UPLOAD') {
          return await onboardingFlowService.processOnboarding(
            normalizedPhone, '', mediaUrl, null, messageKey, null, null
          );
        }

        // AHA_REVENUE: processa imagem e simula texto com o valor extraído
        if (step === 'AHA_REVENUE') {
          const result = await documentService.processImage(mediaUrl, messageKey);

          if (result.processor === 'tesseract') {
            return `Li o seguinte texto:\n"${result.text}"\n\nMas não consegui identificar o valor automaticamente. Por favor, digite o valor e o nome (ex: "Venda R$ 100").`;
          }

          if (result.transacoes && result.transacoes.length > 0) {
            const transacao = result.transacoes[0];
            let mensagemSimulada = `${transacao.categoria || 'Venda'} ${transacao.valor}`;
            if (transacao.cliente) mensagemSimulada += ` cliente ${transacao.cliente}`;
            else if (transacao.descricao) mensagemSimulada += ` ${transacao.descricao}`;
            return await onboardingFlowService.processOnboarding(normalizedPhone, mensagemSimulada);
          }

          return 'Não consegui identificar esse documento 🤔\n\nPode me enviar uma foto mais clara ou descrever a transação em texto?';
        }

        return 'Complete seu cadastro primeiro! 😊';
      }

      const user = await userController.findUserByPhone(normalizedPhone);
      if (!user) {
        await onboardingFlowService.startNewOnboarding(normalizedPhone);
        return `Oi, prazer! Sou a Lumiz 👋\n\nSou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.\n\nAntes de começarmos, veja este vídeo rapidinho para entender como eu te ajudo a controlar tudo sem planilhas.\n\nVou te ajudar a cuidar das finanças da sua clínica de forma simples, automática e sem complicação.\n\nPara começar seu teste, qual é o nome da sua clínica?`;
      }

      // Processa a imagem
      const result = await documentService.processImage(mediaUrl, messageKey);

      // Onda 2.B — caminho rápido para NF/boleto
      const supplierFlow = await this._maybePrepareSupplierDocPending({
        user,
        normalizedPhone,
        result
      });
      if (supplierFlow) return supplierFlow.response;

      const baseResponse = documentService.formatDocumentSummary(result);
      const response = this._prefixLowConfidence(baseResponse, result);

      if (result.processor === 'tesseract') {
        return response + '\n\nO que deseja fazer com essa informação? Me diga se é uma venda ou um custo e o valor.';
      }

      if (result.transacoes && result.transacoes.length > 0) {
        this._setPendingDoc(normalizedPhone, {
          user,
          transacoes: result.transacoes,
          timestamp: Date.now()
        });
        await this.persistPendingConfirmation(normalizedPhone, user, result.transacoes);
      }

      return response;
    } catch (error) {
      console.error('Erro ao processar imagem:', error);
      return 'Erro ao analisar imagem 😢\n\nTente enviar novamente ou registre manualmente.';
    }
  }

  /**
   * Processa imagem com buffer
   */
  async handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption) {
    try {
      const normalizedPhone = this.normalizePhoneKey(phone);
      // Verifica se está em onboarding
      if (await onboardingFlowService.ensureOnboardingState(normalizedPhone)) {
        const step = onboardingFlowService.getOnboardingStep(normalizedPhone);

        // AHA_COSTS_UPLOAD: repassa o buffer diretamente ao onboarding
        if (step === 'AHA_COSTS_UPLOAD') {
          return await onboardingFlowService.processOnboarding(
            normalizedPhone, '', null, null, null, imageBuffer, mimeType
          );
        }

        // AHA_REVENUE: processa buffer e simula texto com o valor extraído
        if (step === 'AHA_REVENUE') {
          const result = await documentService.processImageFromBuffer(imageBuffer, mimeType);
          if (result.transacoes && result.transacoes.length > 0) {
            const transacao = result.transacoes[0];
            let mensagemSimulada = transacao.tipo === 'entrada'
              ? `${transacao.categoria || 'Venda'} ${transacao.valor}`
              : `${transacao.categoria || transacao.descricao || 'Custo'} ${transacao.valor}`;
            return await onboardingFlowService.processOnboarding(normalizedPhone, mensagemSimulada);
          }
          return 'Não consegui identificar esse documento 🤔\n\nPode me enviar uma foto mais clara ou descrever a transação em texto?';
        }

        return 'Complete seu cadastro primeiro! 😊';
      }

      const user = await userController.findUserByPhone(normalizedPhone);
      if (!user) {
        await onboardingFlowService.startNewOnboarding(normalizedPhone);
        return `Oi, prazer! Sou a Lumiz 👋\n\nSou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.\n\nAntes de começarmos, veja este vídeo rapidinho para entender como eu te ajudo a controlar tudo sem planilhas.\n\nVou te ajudar a cuidar das finanças da sua clínica de forma simples, automática e sem complicação.\n\nPara começar seu teste, qual é o nome da sua clínica?`;
      }

      // Processa a imagem diretamente do buffer
      const result = await documentService.processImageFromBuffer(imageBuffer, mimeType);

      if (result.tipo_documento === 'erro' || result.tipo_documento === 'nao_identificado') {
        return documentService.formatDocumentSummary(result);
      }

      // Onda 2.B — caminho rápido para NF/boleto (com fileHash a partir do buffer)
      const supplierFlow = await this._maybePrepareSupplierDocPending({
        user,
        normalizedPhone,
        result,
        buffer: imageBuffer
      });
      if (supplierFlow) return supplierFlow.response;

      if (result.transacoes.length === 0) {
        return documentService.formatDocumentSummary(result);
      }

      // Armazena transações pendentes de confirmação
      this._setPendingDoc(normalizedPhone, {
        user,
        transacoes: result.transacoes,
        timestamp: Date.now()
      });
      await this.persistPendingConfirmation(normalizedPhone, user, result.transacoes);

      return this._prefixLowConfidence(documentService.formatDocumentSummary(result), result);
    } catch (error) {
      console.error('Erro ao processar imagem:', error);
      return 'Erro ao analisar imagem 😢\n\nTente enviar novamente ou registre manualmente.';
    }
  }

  /**
   * Processa confirmação de transações de documento
   */
  async handleDocumentConfirmation(phone, message, user) {
    const normalizedPhone = this.normalizePhoneKey(phone);
    let pending = this.pendingDocumentTransactions.get(normalizedPhone);

    if (!pending) {
      const persistedPending = await this.getPersistedPendingConfirmation(normalizedPhone);
      if (persistedPending) {
        pending = {
          user,
          transacoes: persistedPending.transacoes,
          timestamp: new Date(persistedPending.created_at).getTime()
        };
        this._setPendingDoc(normalizedPhone, pending);
      } else {
        return 'Não encontrei confirmação pendente dessa nota. Reenvie o PDF.';
      }
    }

    const messageLower = message.toLowerCase().trim();
    const isConfirm = messageLower === 'sim' || messageLower === 's' || messageLower === 'confirmar' || messageLower === '1';
    const isCancel = messageLower === 'não' || messageLower === 'nao' || messageLower === 'n' || messageLower === 'cancelar' || messageLower === '2';

    // Onda 2.B — fluxo de supplier_doc (NF/boleto)
    if (pending.isSupplierDoc) {
      if (isConfirm) {
        try {
          const fornecedor = await supplierDocumentService.linkOrCreateFornecedor(user.id, pending.parsed);
          const contas = await supplierDocumentService.createContasPagarFromDocument(
            user.id,
            pending.parsed,
            fornecedor.id,
            { supplierDocumentId: pending.supplier_document_id || null }
          );
          const estoque = await supplierDocumentService.applyEstoqueEntradaFromItens(
            user.id,
            pending.parsed,
            { supplierDocumentId: pending.supplier_document_id || null, fornecedorId: fornecedor.id }
          );

          this.pendingDocumentTransactions.delete(normalizedPhone);
          await this.clearPersistedPendingConfirmation(normalizedPhone);

          return supplierCopy.supplierDocConfirmado({
            contasCount: contas.length,
            valorTotal: pending.parsed.valor_total,
            estoqueAplicados: estoque.aplicados.length,
            estoquePendentes: estoque.pendentes.length,
            fornecedorNome: fornecedor.nome
          });
        } catch (err) {
          console.error('[SUPPLIER_DOC] Falha ao confirmar supplier_doc:', err.message);
          return 'Não consegui registrar essa nota agora 😢\n\nTenta novamente em alguns minutos ou me manda os dados em texto.';
        }
      }
      if (isCancel) {
        this.pendingDocumentTransactions.delete(normalizedPhone);
        await this.clearPersistedPendingConfirmation(normalizedPhone);
        if (pending.supplier_document_id) {
          try {
            const supabase = require('../../db/supabase');
            await supabase
              .from('supplier_documents')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() })
              .eq('id', pending.supplier_document_id)
              .eq('user_id', user.id);
          } catch (e) { /* não-crítico */ }
        }
        return supplierCopy.supplierDocCancelado();
      }
      return 'Não entendi... responde *1* pra confirmar a NF ou *2* pra cancelar 😊';
    }

    // Confirmação
    if (isConfirm) {
      const transactionController = require('../transactionController');
      const parcelasRegistradas = []; // para mensagem final de boleto parcelado

      for (const transacao of pending.transacoes) {
        if (transacao.tipo === 'entrada') {
          await transactionController.createAtendimento(user.id, {
            valor: Math.abs(transacao.valor),
            categoria: transacao.categoria || 'Documento',
            descricao: transacao.descricao || transacao.categoria,
            data: transacao.data || new Date().toISOString().split('T')[0]
          });
        } else {
          // Verifica se LLM retornou parcelas como array de objetos {valor, vencimento, numero}
          const parcelasArray = Array.isArray(transacao.parcelas) ? transacao.parcelas : null;

          if (parcelasArray && parcelasArray.length > 1) {
            // Boleto parcelado: cria uma conta_pagar por parcela
            const descricaoBase = transacao.descricao || transacao.categoria || 'Despesa';
            for (const parcela of parcelasArray) {
              const descParcela = `${descricaoBase} - parcela ${parcela.numero || parcelasArray.indexOf(parcela) + 1}`;
              await transactionController.createContaPagar(user.id, {
                valor: Math.abs(parcela.valor),
                descricao: descParcela,
                data: parcela.vencimento || transacao.data || new Date().toISOString().split('T')[0],
                categoria: transacao.categoria || 'Documento',
                parcelas: null,
                condicoes_pagamento: null,
                observacoes: transacao.category_trigger || null
              });
              parcelasRegistradas.push({
                valor: parcela.valor,
                vencimento: parcela.vencimento,
                numero: parcela.numero || parcelasArray.indexOf(parcela) + 1
              });
            }
          } else {
            // Comportamento original: parcelas como número ou sem parcelas
            await transactionController.createContaPagar(user.id, {
              valor: Math.abs(transacao.valor),
              descricao: transacao.descricao || transacao.categoria,
              data: transacao.data || new Date().toISOString().split('T')[0],
              categoria: transacao.categoria || 'Documento',
              parcelas: typeof transacao.parcelas === 'number' ? transacao.parcelas : null,
              condicoes_pagamento: transacao.condicoes_pagamento || null,
              observacoes: transacao.category_trigger || null
            });
          }
        }
      }

      this.pendingDocumentTransactions.delete(normalizedPhone);
      await this.clearPersistedPendingConfirmation(normalizedPhone);

      // Se registrou boleto com múltiplas parcelas, resposta detalhada
      if (parcelasRegistradas.length > 1) {
        const formatDate = (d) => {
          if (!d) return '?';
          const parts = String(d).split('-');
          return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
        };
        const formatCurrency = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        const listaParc = parcelasRegistradas
          .map((p) => `${formatCurrency(p.valor)} em ${formatDate(p.vencimento)}`)
          .join(', ');
        return `✅ Registrei ${parcelasRegistradas.length} parcelas: ${listaParc}\n\nQuer ver suas contas a pagar? Digite "contas a pagar"`;
      }

      return `✅ *${pending.transacoes.length} transação(ões) registrada(s) da nota fiscal!*\n\nQuer ver seu saldo? Digite "saldo"`;
    }

    // Cancelamento
    if (isCancel) {
      this.pendingDocumentTransactions.delete(normalizedPhone);
      await this.clearPersistedPendingConfirmation(normalizedPhone);
      return 'Transações canceladas ❌\n\nSe quiser registrar, é só me enviar novamente!';
    }

    return 'Não entendi... responde *sim* pra confirmar ou *não* pra cancelar 😊';
  }
}

module.exports = DocumentHandler;
