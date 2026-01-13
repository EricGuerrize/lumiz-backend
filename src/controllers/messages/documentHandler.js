const userController = require('../userController');
const onboardingFlowService = require('../../services/onboardingFlowService');
const documentService = require('../../services/documentService');

/**
 * Handler para documentos e imagens
 */
class DocumentHandler {
  constructor(pendingDocumentTransactions) {
    this.pendingDocumentTransactions = pendingDocumentTransactions;
  }

  /**
   * Processa mensagem de documento (PDF/imagem)
   */
  async handleDocumentMessage(phone, mediaUrl, fileName, messageKey = null) {
    try {
      // Verifica se usuário está cadastrado
      if (onboardingFlowService.isOnboarding(phone)) {
        return 'Complete seu cadastro primeiro! 😊\n\nQual o nome da sua clínica?';
      }

      const user = await userController.findUserByPhone(phone);
      if (!user) {
        await onboardingFlowService.startNewOnboarding(phone);
        return `Oi, prazer! Sou a Lumiz 👋\n\nSou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.\n\nAntes de começarmos, veja este vídeo rapidinho para entender como eu te ajudo a controlar tudo sem planilhas.\n\nVou te ajudar a cuidar das finanças da sua clínica de forma simples, automática e sem complicação.\n\nPara começar seu teste, qual é o nome da sua clínica?`;
      }

      // Processa o documento (PDF ou imagem)
      const result = await documentService.processImage(mediaUrl, messageKey);
      const response = documentService.formatDocumentSummary(result);

      if (result.processor === 'tesseract') {
        return response + '\n\nO que deseja fazer com essa informação? Me diga se é uma venda ou um custo e o valor.';
      }

      if (result.transacoes && result.transacoes.length > 0) {
        this.pendingDocumentTransactions.set(phone, {
          user,
          transacoes: result.transacoes,
          timestamp: Date.now()
        });
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
      // Verifica se está em onboarding
      if (onboardingFlowService.isOnboarding(phone)) {
        const step = onboardingFlowService.getOnboardingStep(phone);

        // Se está no step de primeira venda ou custos, processa a imagem
        if (step === 'primeira_venda' || step === 'primeiro_custo' || step === 'segundo_custo') {
          const result = await documentService.processImage(mediaUrl, messageKey);

          if (result.processor === 'tesseract') {
            return `Li o seguinte texto:\n"${result.text}"\n\nMas não consegui identificar o valor automaticamente. Por favor, digite o valor e o nome (ex: "Venda R$ 100").`;
          }

          if (result.transacoes && result.transacoes.length > 0) {
            const transacao = result.transacoes[0];
            let mensagemSimulada = '';
            if (transacao.tipo === 'entrada') {
              mensagemSimulada = `${transacao.categoria || 'Venda'} ${transacao.valor}`;
              if (transacao.cliente) {
                mensagemSimulada += ` cliente ${transacao.cliente}`;
              } else if (transacao.descricao) {
                mensagemSimulada += ` ${transacao.descricao}`;
              }
            } else {
              mensagemSimulada = `${transacao.categoria || transacao.descricao || 'Custo'} ${transacao.valor}`;
            }
            return await onboardingFlowService.processOnboarding(phone, mensagemSimulada);
          }

          return 'Não consegui identificar esse documento 🤔\n\nPode me enviar uma foto mais clara ou descrever a transação em texto?';
        }

        return 'Complete seu cadastro primeiro! 😊';
      }

      const user = await userController.findUserByPhone(phone);
      if (!user) {
        await onboardingFlowService.startNewOnboarding(phone);
        return `Oi, prazer! Sou a Lumiz 👋\n\nSou a IA que vai organizar o financeiro da sua clínica — direto pelo WhatsApp.\n\nAntes de começarmos, veja este vídeo rapidinho para entender como eu te ajudo a controlar tudo sem planilhas.\n\nVou te ajudar a cuidar das finanças da sua clínica de forma simples, automática e sem complicação.\n\nPara começar seu teste, qual é o nome da sua clínica?`;
      }

      // Processa a imagem
      const result = await documentService.processImage(mediaUrl, messageKey);
      const response = documentService.formatDocumentSummary(result);

      if (result.processor === 'tesseract') {
        return response + '\n\nO que deseja fazer com essa informação? Me diga se é uma venda ou um custo e o valor.';
      }

      if (result.transacoes && result.transacoes.length > 0) {
        this.pendingDocumentTransactions.set(phone, {
          user,
          transacoes: result.transacoes,
          timestamp: Date.now()
        });
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
      // Verifica se está em onboarding
      if (onboardingFlowService.isOnboarding(phone)) {
        const step = onboardingFlowService.getOnboardingStep(phone);
        if (step === 'primeira_venda' || step === 'primeiro_custo' || step === 'segundo_custo') {
          const result = await documentService.processImageFromBuffer(imageBuffer, mimeType);
          if (result.transacoes && result.transacoes.length > 0) {
            const transacao = result.transacoes[0];
            let mensagemSimulada = '';
            if (transacao.tipo === 'entrada') {
              mensagemSimulada = `${transacao.categoria || 'Venda'} ${transacao.valor}`;
            } else {
              mensagemSimulada = `${transacao.categoria || transacao.descricao || 'Custo'} ${transacao.valor}`;
            }
            return await onboardingFlowService.processOnboarding(phone, mensagemSimulada);
          }
          return 'Complete seu cadastro primeiro! 😊';
        }
      }

      const user = await userController.findUserByPhone(phone);
      if (!user) {
        await onboardingFlowService.startNewOnboarding(phone);
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
      this.pendingDocumentTransactions.set(phone, {
        user,
        transacoes: result.transacoes,
        timestamp: Date.now()
      });

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
    const pending = this.pendingDocumentTransactions.get(phone);
    if (!pending) {
      return 'Não encontrei transações pendentes. Pode enviar novamente?';
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
            categoria: transacao.categoria || 'Documento'
          });
        }
      }

      this.pendingDocumentTransactions.delete(phone);
      return `✅ *${pending.transacoes.length} transação(ões) registrada(s)!*\n\nQuer ver seu saldo? Digite "saldo"`;
    }

    // Cancelamento
    if (messageLower === 'não' || messageLower === 'nao' || messageLower === 'n' || messageLower === 'cancelar' || messageLower === '2') {
      this.pendingDocumentTransactions.delete(phone);
      return 'Transações canceladas ❌\n\nSe quiser registrar, é só me enviar novamente!';
    }

    return 'Não entendi... responde *sim* pra confirmar ou *não* pra cancelar 😊';
  }
}

module.exports = DocumentHandler;


