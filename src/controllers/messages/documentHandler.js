const userController = require('../userController');
const onboardingFlowService = require('../../services/onboardingFlowService');
const onboardingService = require('../../services/onboardingService');
const documentService = require('../../services/documentService');
const userRateLimit = require('../../middleware/userRateLimit');
const { normalizePhone } = require('../../utils/phone');

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
      const response = documentService.formatDocumentSummary(result);

      if (result.processor === 'tesseract') {
        return response + '\n\nO que deseja fazer com essa informação? Me diga se é uma venda ou um custo e o valor.';
      }

      if (result.transacoes && result.transacoes.length > 0) {
        this.pendingDocumentTransactions.set(normalizedPhone, {
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
      const response = documentService.formatDocumentSummary(result);

      if (result.processor === 'tesseract') {
        return response + '\n\nO que deseja fazer com essa informação? Me diga se é uma venda ou um custo e o valor.';
      }

      if (result.transacoes && result.transacoes.length > 0) {
        this.pendingDocumentTransactions.set(normalizedPhone, {
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

      if (result.transacoes.length === 0) {
        return documentService.formatDocumentSummary(result);
      }

      // Armazena transações pendentes de confirmação
      this.pendingDocumentTransactions.set(normalizedPhone, {
        user,
        transacoes: result.transacoes,
        timestamp: Date.now()
      });
      await this.persistPendingConfirmation(normalizedPhone, user, result.transacoes);

      return documentService.formatDocumentSummary(result);
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
        this.pendingDocumentTransactions.set(normalizedPhone, pending);
      } else {
        return 'Não encontrei confirmação pendente dessa nota. Reenvie o PDF.';
      }
    }

    const messageLower = message.toLowerCase().trim();

    // Confirmação
    if (messageLower === 'sim' || messageLower === 's' || messageLower === 'confirmar' || messageLower === '1') {
      const transactionController = require('../transactionController');
      
      for (const transacao of pending.transacoes) {
        if (transacao.tipo === 'entrada') {
          await transactionController.createAtendimento(user.id, {
            valor: Math.abs(transacao.valor),
            categoria: transacao.categoria || 'Documento',
            descricao: transacao.descricao || transacao.categoria,
            data: transacao.data || new Date().toISOString().split('T')[0]
          });
        } else {
          await transactionController.createContaPagar(user.id, {
            valor: Math.abs(transacao.valor),
            descricao: transacao.descricao || transacao.categoria,
            data: transacao.data || new Date().toISOString().split('T')[0],
            categoria: transacao.categoria || 'Documento',
            parcelas: transacao.parcelas || null,
            condicoes_pagamento: transacao.condicoes_pagamento || null
          });
        }
      }

      this.pendingDocumentTransactions.delete(normalizedPhone);
      await this.clearPersistedPendingConfirmation(normalizedPhone);
      return `✅ *${pending.transacoes.length} transação(ões) registrada(s) da nota fiscal!*\n\nQuer ver seu saldo? Digite "saldo"`;
    }

    // Cancelamento
    if (messageLower === 'não' || messageLower === 'nao' || messageLower === 'n' || messageLower === 'cancelar' || messageLower === '2') {
      this.pendingDocumentTransactions.delete(normalizedPhone);
      await this.clearPersistedPendingConfirmation(normalizedPhone);
      return 'Transações canceladas ❌\n\nSe quiser registrar, é só me enviar novamente!';
    }

    return 'Não entendi... responde *sim* pra confirmar ou *não* pra cancelar 😊';
  }
}

module.exports = DocumentHandler;
