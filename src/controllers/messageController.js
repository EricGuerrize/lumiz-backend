const geminiService = require('../services/geminiService');
const evolutionService = require('../services/evolutionService');
const userController = require('./userController');
const onboardingFlowService = require('../services/onboardingFlowService');
const transactionController = require('./transactionController');
const conversationHistoryService = require('../services/conversationHistoryService');
const analyticsService = require('../services/analyticsService');
const pdfQueueService = require('../services/pdfQueueService');
const intentHeuristicService = require('../services/intentHeuristicService');
const { normalizePhone } = require('../utils/phone');

// Handlers especializados
const TransactionHandler = require('./messages/transactionHandler');
const QueryHandler = require('./messages/queryHandler');
const DocumentHandler = require('./messages/documentHandler');
const EditHandler = require('./messages/editHandler');
const SearchHandler = require('./messages/searchHandler');
const GoalHandler = require('./messages/goalHandler');
const HelpHandler = require('./messages/helpHandler');
const InstallmentHandler = require('./messages/installmentHandler');
const ExportHandler = require('./messages/exportHandler');
const ScheduleHandler = require('./messages/scheduleHandler');
const InsightsHandler = require('./messages/insightsHandler');

/**
 * MessageController refatorado - Orquestrador principal
 * Delega para handlers especializados
 */
class MessageController {
  constructor() {
    // Armazena estados temporários
    this.pendingTransactions = new Map();
    this.lastTransactions = new Map();
    this.awaitingData = new Map();
    this.pendingDocumentTransactions = new Map();
    this.pendingEdits = new Map();

    // Inicializa handlers com referências aos Maps
    this.transactionHandler = new TransactionHandler(this.pendingTransactions);
    this.queryHandler = new QueryHandler();
    this.documentHandler = new DocumentHandler(this.pendingDocumentTransactions);
    this.editHandler = new EditHandler(this.pendingEdits);
    this.searchHandler = new SearchHandler();
    this.goalHandler = new GoalHandler();
    this.helpHandler = new HelpHandler();
    this.installmentHandler = new InstallmentHandler();
    this.exportHandler = new ExportHandler();
    this.scheduleHandler = new ScheduleHandler();
    this.insightsHandler = new InsightsHandler();
  }

  /**
   * Processa mensagem recebida
   */
  async handleIncomingMessage(phone, message) {
    try {
      const normalizedPhone = normalizePhone(phone) || phone;

      // Verifica se está em processo de onboarding
      if (onboardingFlowService.isOnboarding(normalizedPhone)) {
        return await onboardingFlowService.processOnboarding(normalizedPhone, message);
      }

      // Detecta mensagem inicial do teste gratuito (link do site)
      const messageLower = message.toLowerCase().trim();
      const isTesteGratuitoMessage = 
        messageLower.includes('🔥 quero organizar o financeiro da minha clínica com a lumiz') ||
        messageLower.includes('quero organizar o financeiro da minha clínica com a lumiz') ||
        messageLower.includes('tenho o convite para o teste gratuito') ||
        messageLower.includes('teste gratuito') ||
        messageLower.includes('convite para o teste') ||
        messageLower.includes('quero testar a lumiz') ||
        messageLower.includes('começar meu cadastro') ||
        messageLower.includes('comecar meu cadastro') ||
        messageLower.includes('começar com a lumiz') ||
        messageLower.includes('comecar com a lumiz');

      // Busca usuário pelo telefone
      const user = await userController.findUserByPhone(normalizedPhone);

      // Se detectou mensagem de teste gratuito
      if (isTesteGratuitoMessage) {
        if (user) {
          return `Que bom que você voltou! Você já tá com o convite do teste gratuito, perfeito! Esse teste é o primeiro passo: ele vai mostrar como a Lumiz realiza a gestão do seu financeiro pelo WhatsApp em poucos minutos. Depois disso, pra continuar a gestão da sua clínica no dia a dia, aí só com o plano pago mesmo.`;
        } else {
          return await onboardingFlowService.startIntroFlow(normalizedPhone);
        }
      }

      // Se não encontrou usuário e não é mensagem de teste, inicia novo onboarding
      if (!user) {
        return await onboardingFlowService.startNewOnboarding(normalizedPhone);
      }

      // Verifica estados pendentes
      if (this.pendingTransactions.has(normalizedPhone)) {
        return await this.transactionHandler.handleConfirmation(normalizedPhone, message, user);
      }

      if (this.pendingDocumentTransactions.has(normalizedPhone)) {
        return await this.documentHandler.handleDocumentConfirmation(normalizedPhone, message, user);
      }

      if (this.pendingEdits.has(normalizedPhone)) {
        return await this.editHandler.handleEditConfirmation(normalizedPhone, message, user);
      }

      // Tenta heurística primeiro (economiza ~60% das chamadas Gemini)
      let intent = await intentHeuristicService.detectIntent(message);
      let usedHeuristic = false;

      // Se heurística não funcionou ou confiança baixa, chama Gemini
      if (!intent || intent.confidence < 0.7) {
        // Busca contexto histórico (RAG) - só se for chamar Gemini
        const recentHistory = await conversationHistoryService.getRecentHistory(user.id, 5);
        const similarExamples = await conversationHistoryService.findSimilarExamples(message, user.id, 3);

        const geminiIntent = await geminiService.processMessage(message, {
          recentMessages: recentHistory,
          similarExamples: similarExamples
        });

        // Se Gemini retornou, usa ele; senão, tenta usar heurística mesmo com baixa confiança
        if (geminiIntent && geminiIntent.intencao) {
          intent = geminiIntent;
          usedHeuristic = false;
        } else if (intent) {
          // Usa heurística mesmo com confiança baixa se Gemini falhou
          usedHeuristic = true;
        } else {
          // Fallback: cria intent genérico
          intent = {
            intencao: 'mensagem_ambigua',
            dados: {},
            source: 'fallback'
          };
        }
      } else {
        usedHeuristic = true;
      }

      // Log para métricas (opcional, pode remover em produção)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[MESSAGE] Intent detectado: ${intent.intencao}, source: ${usedHeuristic ? 'heuristic' : 'gemini'}, confidence: ${intent.confidence || 'N/A'}`);
      }

      // Verifica se estamos aguardando dados (ex: valor)
      if (this.awaitingData.has(phone)) {
        return await this.handleAwaitingData(phone, message, intent, user);
      }

      // Roteia para handlers baseado no intent
      let response = await this.routeIntent(intent, user, normalizedPhone, message);

      // Salva conversa no histórico
      if (response && response !== null) {
        try {
          await conversationHistoryService.saveConversation(
            user.id,
            message,
            response,
            intent.intencao,
            { dados: intent.dados }
          );
        } catch (error) {
          console.error('[MESSAGE] Erro ao salvar histórico (não crítico):', error.message);
        }
      }

      return response;
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      return 'Eita, deu um erro aqui 😅\n\nTenta de novo! Se o problema continuar, me manda a mensagem de um jeito mais simples.\n\nExemplo: _"Botox 2800 cliente Maria"_';
    }
  }

  /**
   * Roteia intent para handler apropriado
   */
  async routeIntent(intent, user, phone, message) {
    switch (intent.intencao) {
      case 'registrar_entrada':
      case 'registrar_saida':
        if (!intent.dados.valor) {
          this.awaitingData.set(phone, {
            intent: intent,
            timestamp: Date.now()
          });
          const tipo = intent.intencao === 'registrar_entrada' ? 'venda' : 'custo';
          const cat = intent.dados.categoria || 'esse item';
          return `Entendi que é ${tipo === 'venda' ? 'uma venda' : 'um custo'} de *${cat}*, mas qual o valor? 💰\n\nPode mandar só o número (ex: 500).`;
        }
        return await this.transactionHandler.handleTransactionRequest(user, intent, phone);

      case 'consultar_saldo':
        return await this.queryHandler.handleBalance(user);

      case 'consultar_historico':
        return await this.queryHandler.handleHistory(user);

      case 'relatorio_mensal':
        if (intent.dados?.formato === 'pdf' || message.toLowerCase().includes('pdf')) {
          await pdfQueueService.addJob('monthly_report_pdf', {
            userId: user.id,
            phone: phone,
            params: intent.dados
          });
          return null; // PDF será enviado via fila
        }
        return await this.queryHandler.handleMonthlyReport(user, intent.dados);

      case 'exportar_dados':
        const formato = intent.dados?.formato || (message.toLowerCase().includes('excel') || message.toLowerCase().includes('planilha') || message.toLowerCase().includes('csv') ? 'excel' : 'pdf');
        if (formato === 'excel' || formato === 'csv') {
          await pdfQueueService.addJob('export_data_excel', {
            userId: user.id,
            phone: phone,
            params: { ...intent.dados, formato }
          });
          return null;
        }
        await pdfQueueService.addJob('export_data_pdf', {
          userId: user.id,
          phone: phone,
          params: intent.dados
        });
        return null;

      case 'comparar_meses':
        if (intent.dados?.periodo1 || intent.dados?.periodo2) {
          return await this.queryHandler.handleCompareCustomPeriods(user, intent.dados);
        }
        return await this.queryHandler.handleCompareMonths(user);

      case 'consultar_parcelas':
        return await this.installmentHandler.handlePendingInstallments(user);

      case 'stats_hoje':
        return await this.queryHandler.handleTodayStats(user);

      case 'ranking_procedimentos':
        return await this.queryHandler.handleProcedureRanking(user);

      case 'marcar_parcela_paga':
        return await this.installmentHandler.handleMarkInstallmentPaid(user, phone);

      case 'consultar_agenda':
        return await this.scheduleHandler.handleSchedule(user);

      case 'consultar_meta':
        return await this.goalHandler.handleGoalProgress(user);

      case 'insights':
        return await this.insightsHandler.handleInsights(user);

      case 'enviar_documento':
        return this.helpHandler.handleDocumentPrompt();

      case 'codigo_boleto':
        return await this.handleBarcodeMessage(user, intent, phone);

      case 'desfazer':
        return await this.editHandler.handleUndoLastTransaction(user, phone);

      case 'editar_transacao':
        return await this.editHandler.handleEditTransaction(user, phone, intent);

      case 'buscar_transacao':
        return await this.searchHandler.handleSearchTransaction(user, intent, message);

      case 'definir_meta':
        return await this.goalHandler.handleDefineGoal(user, phone, intent);

      case 'saudacao':
        return this.helpHandler.handleGreeting();

      case 'ajuda':
        return this.helpHandler.handleHelp();

      case 'apenas_valor':
        return await this.handleOnlyValue(intent, phone);

      case 'apenas_procedimento':
        return await this.handleOnlyProcedure(intent, phone);

      case 'mensagem_ambigua':
        return await this.helpHandler.handleAmbiguousMessage(user, message, transactionController);

      case 'erro':
        return 'Ops, tive um probleminha técnico 🤔\n\nPode tentar de novo? Se continuar dando erro, tenta simplificar a mensagem.\n\nExemplo: _"Botox 2800"_';

      default:
        return 'Opa, não entendi essa 😅\n\nPode reformular? Tipo:\n_"Vendi um preenchimento por 1500"_\n_"Paguei conta de luz 450"_\n_"Como tá meu saldo?"_\n\nOu manda "ajuda" que te explico melhor!';
    }
  }

  /**
   * Processa quando está aguardando dados
   */
  async handleAwaitingData(phone, message, intent, user) {
    const pendingData = this.awaitingData.get(phone);
    const messageLower = message.toLowerCase().trim();

    if (['cancelar', 'não', 'nao', 'desfazer'].includes(messageLower)) {
      this.awaitingData.delete(phone);
      return 'Entendido, cancelei o registro incompleto. 👍';
    }

    // Cenário 1: Comando completo agora
    if ((intent.intencao === 'registrar_entrada' || intent.intencao === 'registrar_saida') && intent.dados.valor) {
      console.log('[CONTROLLER] Novo comando completo detectado, descartando espera anterior');
      this.awaitingData.delete(phone);
      return await this.transactionHandler.handleTransactionRequest(user, intent, phone);
    }

    // Cenário 2: Apenas valor
    if (intent.intencao === 'apenas_valor' && intent.dados.valor) {
      pendingData.intent.dados.valor = intent.dados.valor;
      this.awaitingData.delete(phone);
      console.log(`[CONTROLLER] Valor ${intent.dados.valor} recebido via apenas_valor`);
      return await this.transactionHandler.handleTransactionRequest(user, pendingData.intent, phone);
    }

    // Cenário 3: Fallback regex
    const valorMatch = message.match(/(\d+[.,]?\d*)/);
    if (valorMatch) {
      const valor = parseFloat(valorMatch[0].replace(',', '.'));
      if (!isNaN(valor)) {
        const intent = pendingData.intent;
        intent.dados.valor = valor;
        this.awaitingData.delete(phone);
        console.log(`[CONTROLLER] Valor ${valor} recebido via regex`);
        return await this.transactionHandler.handleTransactionRequest(user, intent, phone);
      }
    }

    return 'Não consegui identificar o valor 🤔\n\nMe manda só o número, tipo: _500_ ou _1500.50_';
  }

  /**
   * Handlers de mensagens de mídia (delegam para documentHandler ou onboarding)
   */
  async handleImageMessage(phone, mediaUrl, caption, messageKey = null) {
    const normalizedPhone = normalizePhone(phone) || phone;
    
    // Se está em onboarding, processa no onboarding
    if (onboardingFlowService.isOnboarding(normalizedPhone)) {
      return await onboardingFlowService.processOnboarding(normalizedPhone, caption || '', mediaUrl, null);
    }
    
    return await this.documentHandler.handleImageMessage(phone, mediaUrl, caption, messageKey);
  }

  async handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption) {
    return await this.documentHandler.handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption);
  }

  async handleDocumentMessage(phone, mediaUrl, fileName, messageKey = null) {
    const normalizedPhone = normalizePhone(phone) || phone;
    
    // Se está em onboarding, processa no onboarding
    if (onboardingFlowService.isOnboarding(normalizedPhone)) {
      return await onboardingFlowService.processOnboarding(normalizedPhone, '', mediaUrl, fileName);
    }
    
    return await this.documentHandler.handleDocumentMessage(phone, mediaUrl, fileName, messageKey);
  }

  async handleDocumentMessageWithBuffer(phone, docBuffer, mimeType, fileName) {
    const documentService = require('../services/documentService');
    const user = await userController.findUserByPhone(phone);
    if (!user) {
      await onboardingFlowService.startNewOnboarding(phone);
      return null;
    }

    const result = await documentService.processDocumentFromBuffer(docBuffer, mimeType, fileName);
    const response = documentService.formatDocumentSummary(result);

    if (result.transacoes && result.transacoes.length > 0) {
      this.pendingDocumentTransactions.set(phone, {
        user,
        transacoes: result.transacoes,
        timestamp: Date.now()
      });
    }

    return response;
  }

  /**
   * Handler para código de boleto
   */
  async handleBarcodeMessage(user, intent, phone) {
    const codigo = intent.dados.codigo;
    let response = `Recebi o código do boleto! 🔢\n\n`;
    response += `Agora me diz: esse boleto é de quê e qual o valor?\n\n`;
    response += `Por exemplo:\n_"Fornecedor 1500"_\n_"Conta de luz 450"_\n\n`;
    response += `Ou se preferir, manda uma foto do boleto que eu leio tudo automaticamente 📸`;
    return response;
  }

  /**
   * Handlers auxiliares
   */
  async handleOnlyValue(intent, phone) {
    const valor = intent.dados.valor;
    return `Entendi, *R$ ${valor.toFixed(2)}* 💰\n\nMas isso foi uma venda ou um gasto?\n\nMe conta mais, tipo:\n_"Botox ${valor}"_ se foi uma venda\n_"Insumos ${valor}"_ se foi um custo`;
  }

  async handleOnlyProcedure(intent, phone) {
    const categoria = intent.dados.categoria;
    return `Beleza, *${categoria}*! 💉\n\nE qual foi o valor?\n\nMe manda completo, tipo:\n_"${categoria} 2800"_`;
  }

  /**
   * Métodos auxiliares para compatibilidade
   */
  getPendingTransactions() {
    return this.pendingTransactions;
  }

  getLastTransactions() {
    return this.lastTransactions;
  }

  getAwaitingData() {
    return this.awaitingData;
  }

  getPendingDocumentTransactions() {
    return this.pendingDocumentTransactions;
  }

  getPendingEdits() {
    return this.pendingEdits;
  }
}

module.exports = new MessageController();
