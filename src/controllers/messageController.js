const geminiService = require('../services/geminiService');
const evolutionService = require('../services/evolutionService');
const userController = require('./userController');
const onboardingFlowService = require('../services/onboardingFlowService');
const transactionController = require('./transactionController');
const conversationHistoryService = require('../services/conversationHistoryService');
const analyticsService = require('../services/analyticsService');
const pdfQueueService = require('../services/pdfQueueService');
const intentHeuristicService = require('../services/intentHeuristicService');
const conversationRuntimeStateService = require('../services/conversationRuntimeStateService');
const cacheService = require('../services/cacheService');
const supabase = require('../db/supabase');
const { normalizePhone } = require('../utils/phone');
const { formatarMoeda } = require('../utils/currency');
const { extractPrimaryMonetaryValue } = require('../utils/moneyParser');

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
const MemberHandler = require('./messages/memberHandler');
const mdrChatFlowService = require('../services/mdrChatFlowService');
const betaFeedbackService = require('../services/betaFeedbackService');

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
    this.mediaProcessing = new Map();
    this.MEDIA_PROCESSING_TTL_MS = 60 * 1000;
    this.AWAITING_DATA_TTL_MS = 10 * 60 * 1000;
    this.RUNTIME_AWAITING_FLOW = 'awaiting_data';

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
    this.memberHandler = new MemberHandler();
  }

  async setAwaitingData(phone, pending, ttlMs = this.AWAITING_DATA_TTL_MS) {
    const payload = {
      ...(pending || {}),
      timestamp: pending?.timestamp || Date.now()
    };
    this.awaitingData.set(phone, payload);
    await conversationRuntimeStateService.upsert(phone, this.RUNTIME_AWAITING_FLOW, payload, ttlMs);
  }

  async clearAwaitingData(phone) {
    this.awaitingData.delete(phone);
    await conversationRuntimeStateService.clear(phone, this.RUNTIME_AWAITING_FLOW);
  }

  isOptionToken(messageLower) {
    return [
      '1', '2', '3', '4',
      'sim', 's',
      'nao', 'não', 'n',
      'confirmar', 'cancelar'
    ].includes(String(messageLower || '').trim());
  }

  hasPendingConversationContext(phone) {
    return (
      this.pendingTransactions.has(phone) ||
      this.pendingDocumentTransactions.has(phone) ||
      this.pendingEdits.has(phone) ||
      this.awaitingData.has(phone) ||
      this.memberHandler.isAddingMember(phone) ||
      this.memberHandler.isRemovingMember(phone) ||
      this.memberHandler.hasPendingTransfer(phone) ||
      mdrChatFlowService.isActive(phone)
    );
  }

  getOrphanOptionReplyMessage() {
    return 'Não encontrei confirmação pendente agora. Se era confirmação, repita o último comando. Se era valor, envie com contexto (ex: _R$ 100_ ou _Insumos R$ 100_).';
  }

  async rehydrateRuntimeStates(phone) {
    const runtimeStates = await conversationRuntimeStateService.getAllActive(phone);
    if (!Array.isArray(runtimeStates) || runtimeStates.length === 0) {
      return;
    }

    const byFlow = new Map();
    for (const state of runtimeStates) {
      if (!state?.flow || !state?.payload) continue;
      byFlow.set(state.flow, state.payload);
    }

    if (!this.pendingTransactions.has(phone) && byFlow.has('tx_confirm')) {
      this.transactionHandler.restorePendingTransaction(phone, byFlow.get('tx_confirm'));
    }

    if (!this.awaitingData.has(phone) && byFlow.has(this.RUNTIME_AWAITING_FLOW)) {
      this.awaitingData.set(phone, byFlow.get(this.RUNTIME_AWAITING_FLOW));
    }

    if (!this.pendingEdits.has(phone) && byFlow.has('edit_flow')) {
      this.editHandler.restorePendingEdit(phone, byFlow.get('edit_flow'));
    }

    if (!this.memberHandler.isAddingMember(phone) && byFlow.has('member_add')) {
      this.memberHandler.restoreAddMemberState(phone, byFlow.get('member_add'));
    }

    if (!this.memberHandler.isRemovingMember(phone) && byFlow.has('member_remove')) {
      this.memberHandler.restoreRemoveMemberState(phone, byFlow.get('member_remove'));
    }

    if (!mdrChatFlowService.isActive(phone) && byFlow.has('mdr_flow')) {
      mdrChatFlowService.restoreState(phone, byFlow.get('mdr_flow'));
    }
  }

  startMediaProcessing(phone, type = 'document') {
    const normalizedPhone = normalizePhone(phone) || phone;
    this.mediaProcessing.set(normalizedPhone, {
      startedAt: Date.now(),
      type
    });
  }

  stopMediaProcessing(phone, reason = 'completed') {
    const normalizedPhone = normalizePhone(phone) || phone;
    const active = this.mediaProcessing.get(normalizedPhone);
    if (!active) return;

    this.mediaProcessing.delete(normalizedPhone);
  }

  isMediaProcessing(phone) {
    const normalizedPhone = normalizePhone(phone) || phone;
    const active = this.mediaProcessing.get(normalizedPhone);
    if (!active) return false;

    if (Date.now() - active.startedAt > this.MEDIA_PROCESSING_TTL_MS) {
      this.mediaProcessing.delete(normalizedPhone);
      return false;
    }

    return true;
  }

  /**
   * Processa mensagem recebida
   */
  async handleIncomingMessage(phone, message) {
    try {
      const normalizedPhone = normalizePhone(phone) || phone;
      console.log(`[MESSAGE] v2 - Recebida mensagem de ${normalizedPhone}: ${message?.substring(0, 30)}`);

      // IMPORTANTE: Primeiro verifica se é membro de clínica (clinic_members)
      // Isso tem prioridade sobre o estado de onboarding para evitar que membros
      // cadastrados fiquem presos em onboarding antigo
      const clinicMemberService = require('../services/clinicMemberService');
      const existingMember = await clinicMemberService.findMemberByPhone(normalizedPhone);
      console.log(`[MESSAGE] existingMember encontrado:`, existingMember ? `${existingMember.nome} (clinic_id: ${existingMember.clinic_id})` : 'NAO');

      // Se é membro de uma clínica, verifica se está em onboarding ATIVO
      // Só limpa estado de onboarding se estiver em steps FINAIS (já completou o fluxo principal)
      if (existingMember && existingMember.clinic_id) {
        const isOnboarding = await onboardingFlowService.ensureOnboardingState(normalizedPhone);
        const onboardingStep = onboardingFlowService.getOnboardingStep(normalizedPhone);

        // Steps finais onde o onboarding pode ser considerado "residual"
        // IMPORTANTE: MDR_SETUP_* faz parte do onboarding atual e deve ser processado pelo fluxo.
        const finalSteps = ['MDR_SETUP_COMPLETE'];
        const isInFinalStep = finalSteps.includes(onboardingStep);

        // Se está em onboarding ATIVO (não em step final), continua o onboarding
        if (isOnboarding && !isInFinalStep) {
          console.log(`[MESSAGE] Membro ${normalizedPhone} está em onboarding ativo (step: ${onboardingStep}), continuando fluxo`);
          const result = await onboardingFlowService.processOnboarding(normalizedPhone, message);
          if (result === null) {
            // Onboarding foi finalizado, continua para processamento normal
          } else if (result) {
            return result;
          }
        } else if (isOnboarding && isInFinalStep) {
          // Está em step final - pode limpar se quiser sair do onboarding
          console.log(`[MESSAGE] Membro ${normalizedPhone} em step final de onboarding (${onboardingStep}), processando normalmente`);
        }
        // Continua para processamento normal como membro da clínica
      } else {
        // Não é membro, verifica se está em processo de onboarding
        const isOnboarding = await onboardingFlowService.ensureOnboardingState(normalizedPhone);
        if (isOnboarding) {
          const result = await onboardingFlowService.processOnboarding(normalizedPhone, message);

          // Se o onboarding retornou null, significa que foi finalizado e a mensagem deve ser processada normalmente
          if (result === null) {
            // Onboarding foi finalizado, reprocessa a mensagem normalmente
            // Continua o fluxo abaixo para processar como transação normal
          } else if (result) {
            return result;
          }
        }
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
      let user = await userController.findUserByPhone(normalizedPhone);

      // Se detectou mensagem de teste gratuito
      if (isTesteGratuitoMessage) {
        if (user) {
          return `Que bom que você voltou! Você já tá com o convite do teste gratuito, perfeito! Esse teste é o primeiro passo: ele vai mostrar como a Lumiz realiza a gestão do seu financeiro pelo WhatsApp em poucos minutos. Depois disso, pra continuar a gestão da sua clínica no dia a dia, aí só com o plano pago mesmo.`;
        } else {
          return await onboardingFlowService.startIntroFlow(normalizedPhone);
        }
      }

      // Se não encontrou usuário e não é mensagem de teste, faz busca mais robusta
      if (!user) {
        // Busca adicional em clinic_members incluindo membros não confirmados
        // Isso garante que encontramos membros recém-cadastrados que ainda não confirmaram
        const clinicMemberService = require('../services/clinicMemberService');
        const member = await clinicMemberService.findMemberByPhone(normalizedPhone);

        if (member && member.clinic_id) {
          // Encontrou membro! Busca o profile da clínica
          const { data: clinicProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', member.clinic_id)
            .single();

          if (clinicProfile) {
            // Adiciona informação do membro
            clinicProfile._member = {
              nome: member.nome,
              funcao: member.funcao,
              is_primary: member.is_primary,
              confirmed: member.confirmed,
              phone_used: normalizedPhone
            };

            // Atualiza cache para próxima busca
            const cacheService = require('../services/cacheService');
            const cacheKey = `phone:profile:${normalizedPhone}`;
            await cacheService.set(cacheKey, clinicProfile, 900);

            // Atribui ao user para continuar processamento normalmente
            user = clinicProfile;
          }
        }

        // Se ainda não encontrou usuário, inicia novo onboarding
        if (!user) {
          return await onboardingFlowService.startNewOnboarding(normalizedPhone);
        }
      }

      // Verifica se é membro secundário não confirmado
      if (user._member && !user._member.confirmed && !user._member.is_primary) {
        return await this.handleSecondaryMemberConfirmation(user, normalizedPhone, message);
      }

      await this.rehydrateRuntimeStates(normalizedPhone);

      // Verifica estados pendentes
      if (this.pendingTransactions.has(normalizedPhone)) {
        return await this.transactionHandler.handleConfirmation(normalizedPhone, message, user);
      }

      if (this.pendingDocumentTransactions.has(normalizedPhone)) {
        return await this.documentHandler.handleDocumentConfirmation(normalizedPhone, message, user);
      }

      const normalizedMessage = (message || '').trim().toLowerCase();
      const looksLikeYesNoDocumentReply = [
        'sim', 's', 'confirmar', '1',
        'não', 'nao', 'n', 'cancelar', '2'
      ].includes(normalizedMessage);

      if (looksLikeYesNoDocumentReply) {
        const persistedPending = await this.documentHandler.getPersistedPendingConfirmation(normalizedPhone);
        if (persistedPending) {
          return await this.documentHandler.handleDocumentConfirmation(normalizedPhone, message, user);
        }
      }

      if (this.pendingEdits.has(normalizedPhone)) {
        return await this.editHandler.handleEditConfirmation(normalizedPhone, message, user);
      }

      if (this.isMediaProcessing(normalizedPhone)) {
        return 'Recebi seu documento e ainda estou analisando. Já te respondo em instantes.';
      }

      // Verifica se está no fluxo de adicionar membro
      if (this.memberHandler.isAddingMember(normalizedPhone)) {
        const result = await this.memberHandler.processAddMember(normalizedPhone, message);
        if (result) {
          return result;
        }
      }

      // Verifica se está no fluxo de remover membro
      if (this.memberHandler.isRemovingMember(normalizedPhone)) {
        const result = await this.memberHandler.processRemoveMember(normalizedPhone, message);
        if (result) {
          return result;
        }
      }

      // Verifica se há transferência pendente aguardando resposta deste usuário
      if (this.memberHandler.hasPendingTransfer(normalizedPhone)) {
        const result = await this.memberHandler.processTransferResponse(normalizedPhone, message);
        if (result) {
          return result;
        }
      }

      if (user && user.id) {
        const mdrResponse = await mdrChatFlowService.handleMessageIfNeeded({
          phone: normalizedPhone,
          user,
          message
        });
        if (mdrResponse) {
          return mdrResponse;
        }
      }

      // CORREÇÃO: Se usuário não existe e a mensagem parece ser saudação, inicia onboarding antes de detectar intent
      if (!user) {
        const messageLower = message.toLowerCase().trim();
        const isGreeting = messageLower === 'oi' || messageLower === 'olá' || messageLower === 'ola' ||
          messageLower === 'sim' || messageLower === 'começar' || messageLower === 'comecar' ||
          messageLower.includes('oi') || messageLower.includes('olá') || messageLower.includes('ola');
        if (isGreeting) {
          return await onboardingFlowService.startIntroFlow(normalizedPhone);
        }
      }

      if (this.isOptionToken(normalizedMessage) && !this.hasPendingConversationContext(normalizedPhone)) {
        return this.getOrphanOptionReplyMessage();
      }

      // Atalhos rápidos: comandos simples respondidos sem chamar Gemini ou heurística
      const msgSimples = message.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const saudacoes = ['oi', 'oii', 'oiii', 'ola', 'opa', 'hey', 'eai', 'e ai', 'salve', 'alo',
        'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'td bem'];
      if (saudacoes.includes(msgSimples)) {
        return this.helpHandler.handleGreeting();
      }
      if (['ajuda', 'help', 'comandos'].includes(msgSimples)) {
        return this.helpHandler.handleHelp();
      }
      if (['dashboard', 'link', 'painel'].includes(msgSimples)) {
        return this.helpHandler.handleDashboard();
      }

      // Tenta heurística primeiro (economiza ~60% das chamadas Gemini)
      let intent = await intentHeuristicService.detectIntent(message, user?.id || null);
      let usedHeuristic = false;

      // Opção A: mensagens curtas (≤2 palavras) → confiar na heurística, não chamar Gemini
      const palavras = message.trim().split(/\s+/);
      const mensagemSimples = palavras.length <= 2;

      // Se heurística não funcionou ou confiança baixa, chama Gemini
      if (!mensagemSimples && (!intent || intent.confidence < 0.7)) {
        // Busca contexto histórico (RAG) - só se for chamar Gemini e se usuário existir
        let recentHistory = [];
        let similarExamples = [];
        if (user && user.id) {
          const [historyResult, examplesResult] = await Promise.allSettled([
            conversationHistoryService.getRecentHistory(user.id, 5),
            conversationHistoryService.findSimilarExamples(message, user.id, 3)
          ]);
          if (historyResult.status === 'fulfilled') recentHistory = historyResult.value;
          else console.warn('[RAG] Falha ao buscar histórico:', historyResult.reason?.message);
          if (examplesResult.status === 'fulfilled') similarExamples = examplesResult.value;
          else console.warn('[RAG] Falha ao buscar exemplos:', examplesResult.reason?.message);
        }

        // Opção B: timeout de 6s no Gemini — se demorar, cai no ambíguo
        const GEMINI_TIMEOUT_MS = 6000;
        const geminiIntent = await Promise.race([
          geminiService.processMessage(message, {
            recentMessages: recentHistory,
            similarExamples: similarExamples
          }),
          new Promise(resolve => setTimeout(() => resolve(null), GEMINI_TIMEOUT_MS))
        ]);

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
      } else if (!intent) {
        // Mensagem simples sem match — resposta imediata
        intent = {
          intencao: 'mensagem_ambigua',
          dados: {},
          source: 'fallback'
        };
      } else {
        usedHeuristic = true;
      }

      // Log para métricas (opcional, pode remover em produção)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[MESSAGE] Intent detectado: ${intent.intencao}, source: ${usedHeuristic ? 'heuristic' : 'gemini'}, confidence: ${intent.confidence || 'N/A'}`);
      }

      // Verifica se estamos aguardando dados (ex: valor)
      if (this.awaitingData.has(normalizedPhone)) {
        return await this.handleAwaitingData(normalizedPhone, message, intent, user);
      }

      // Captura feedback explícito ("feedback: ..." ou "sugestão: ...")
      const msgLowerFeedback = message.toLowerCase().trim();
      if (msgLowerFeedback.startsWith('feedback:') || msgLowerFeedback.startsWith('sugestão:') || msgLowerFeedback.startsWith('sugestao:')) {
        betaFeedbackService.capture({ phone: normalizedPhone, type: 'explicit', message });
        return 'Anotado, obrigado! 👍';
      }

      // Roteia para handlers baseado no intent
      let response = await this.routeIntent(intent, user, normalizedPhone, message);

      // Captura falhas de entendimento como feedback passivo
      if (intent.intencao === 'erro' || intent.intencao === 'mensagem_ambigua') {
        betaFeedbackService.capture({
          phone: normalizedPhone,
          type: 'failed_intent',
          message,
          intent: intent.intencao,
          botResponse: response
        });
      }

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

      // Detecta erros específicos de conexão com Supabase
      if (error.message && (
        error.message.includes('fetch failed') ||
        error.message.includes('Erro de conexão com o banco de dados') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ECONNREFUSED')
      )) {
        console.error('[MESSAGE] Erro de conexão com Supabase detectado');
        return 'Ops, estou com um probleminha de conexão agora 😅\n\nTenta de novo em alguns segundos. Se o problema continuar, pode ser que o servidor esteja temporariamente indisponível.';
      }

      return 'Eita, deu um erro aqui 😅\n\nTenta de novo! Se o problema continuar, me manda a mensagem de um jeito mais simples.\n\nExemplo: _"Botox R$ 2800 cliente Maria"_';
    }
  }

  /**
   * Roteia intent para handler apropriado
   */
  async routeIntent(intent, user, phone, message) {
    switch (intent.intencao) {
      case 'registrar_entrada':
      case 'registrar_saida':
        if (!intent.dados) {
          intent.dados = {};
        }

        if (!Number.isFinite(Number(intent.dados.valor)) || Number(intent.dados.valor) <= 0) {
          const valorFallback = extractPrimaryMonetaryValue(message);
          if (Number.isFinite(valorFallback) && valorFallback > 0) {
            intent.dados.valor = valorFallback;
            console.log(`[CONTROLLER] Valor ${valorFallback} recuperado via fallback em routeIntent`);
          }
        }

        const tipo = intent.intencao === 'registrar_entrada' ? 'venda' : 'custo';
        const temValor = Number.isFinite(Number(intent.dados.valor)) && Number(intent.dados.valor) > 0;
        const temCategoria = intent.dados.categoria && intent.dados.categoria.trim().length > 0;

        // Se tem ambos, processa normalmente
        if (temValor && temCategoria) {
          return await this.transactionHandler.handleTransactionRequest(user, intent, phone, message);
        }

        // Se não tem valor E não tem categoria: pergunta ambos
        if (!temValor && !temCategoria) {
          await this.setAwaitingData(phone, {
            intent: intent,
            stage: 'awaiting_category_and_value',
            timestamp: Date.now()
          });
          const exemplos = tipo === 'venda'
            ? '_Botox R$ 2800_ ou _Preenchimento R$ 3500_'
            : '_Insumos R$ 500_ ou _Aluguel R$ 2000_';
          return `O que você quer registrar? 💰\n\nMe diga o ${tipo === 'venda' ? 'procedimento' : 'tipo de custo'} e o valor.\n\nExemplo: ${exemplos}`;
        }

        // Se tem categoria mas não tem valor: pergunta apenas o valor
        if (temCategoria && !temValor) {
          await this.setAwaitingData(phone, {
            intent: intent,
            stage: 'awaiting_value',
            timestamp: Date.now()
          });
          return `Entendi que é uma ${tipo} de *${intent.dados.categoria}*, mas qual o valor? 💰\n\nPode mandar só o número (ex: R$ 500).`;
        }

        // Se tem valor mas não tem categoria: pergunta apenas a categoria
        if (temValor && !temCategoria) {
          await this.setAwaitingData(phone, {
            intent: intent,
            stage: 'awaiting_category',
            timestamp: Date.now()
          });
          const exemplos = tipo === 'venda'
            ? '_Botox_, _Preenchimento_, _Harmonização_'
            : '_Insumos_, _Aluguel_, _Marketing_';
          return `Qual ${tipo === 'venda' ? 'procedimento' : 'tipo de custo'} dessa ${tipo} de ${formatarMoeda(intent.dados.valor)}? 💰\n\nExemplo: ${exemplos}`;
        }

        // Fallback: processa normalmente
        return await this.transactionHandler.handleTransactionRequest(user, intent, phone, message);

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

      case 'adicionar_numero':
        return await this.memberHandler.handleAddMember(user, phone);

      case 'listar_numeros':
        return await this.memberHandler.handleListMembers(user);

      case 'remover_numero':
        return await this.memberHandler.handleRemoveMember(user, phone);

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
        // Se o usuário não existe, inicia onboarding ao invés de retornar mensagem genérica
        if (!user) {
          return await onboardingFlowService.startIntroFlow(phone);
        }
        return this.helpHandler.handleGreeting();

      case 'ver_dashboard':
        return this.helpHandler.handleDashboard();

      case 'ajuda':
        return this.helpHandler.handleHelp();

      case 'apenas_valor':
        await this.setAwaitingData(phone, {
          intent: intent,
          stage: 'awaiting_type_for_value',
          timestamp: Date.now()
        });
        return await this.handleOnlyValue(intent, phone);

      case 'apenas_procedimento':
        await this.setAwaitingData(phone, {
          intent: intent,
          stage: 'awaiting_value_for_category',
          timestamp: Date.now()
        });
        return await this.handleOnlyProcedure(intent, phone);

      case 'mensagem_ambigua':
        return await this.helpHandler.handleAmbiguousMessage(user, message, transactionController);

      case 'erro':
        return 'Ops, tive um probleminha técnico 🤔\n\nPode tentar de novo? Se continuar dando erro, tenta simplificar a mensagem.\n\nExemplo: _"Botox R$ 2800"_';

      default:
        return 'Opa, não entendi essa 😅\n\nPode reformular? Tipo:\n_"Vendi um preenchimento por R$ 1500"_\n_"Paguei conta de luz R$ 450"_\n_"Como tá meu saldo?"_\n\nOu manda "ajuda" que te explico melhor!';
    }
  }

  /**
   * Processa quando está aguardando dados
   */
  async handleAwaitingData(phone, message, intent, user) {
    const pendingData = this.awaitingData.get(phone);
    if (!pendingData) {
      return 'Não encontrei nenhum registro pendente agora. Me manda a transação completa, tipo: _Botox R$ 2800_.';
    }

    const pendingAgeMs = Date.now() - (pendingData.timestamp || 0);
    if (pendingAgeMs > this.AWAITING_DATA_TTL_MS) {
      await this.clearAwaitingData(phone);
      return 'Esse pedido anterior expirou. Me manda de novo em uma mensagem só, tipo: _Insumos R$ 500_ ou _Botox R$ 2800_.';
    }

    const messageLower = message.toLowerCase().trim();

    if (['cancelar', 'não', 'nao', 'desfazer'].includes(messageLower)) {
      await this.clearAwaitingData(phone);
      return 'Entendido, cancelei o registro incompleto. 👍';
    }

    if (pendingData.stage === 'awaiting_type_for_value') {
      return await this.handleAwaitingTypeForValue(phone, message, intent, user, pendingData);
    }

    if (pendingData.stage === 'awaiting_value_for_category') {
      return await this.handleAwaitingValueForCategory(phone, message, intent, user, pendingData);
    }

    if (!pendingData.intent) {
      pendingData.intent = { dados: {} };
    }
    if (!pendingData.intent.dados) {
      pendingData.intent.dados = {};
    }

    // Cenário 1: Comando completo agora
    if (intent.intencao === 'registrar_entrada' || intent.intencao === 'registrar_saida') {
      const valorDetectado = Number.isFinite(Number(intent?.dados?.valor)) && Number(intent.dados.valor) > 0
        ? Number(intent.dados.valor)
        : extractPrimaryMonetaryValue(message);

      if (Number.isFinite(valorDetectado) && valorDetectado > 0) {
        intent.dados.valor = valorDetectado;
        console.log('[CONTROLLER] Novo comando completo detectado, descartando espera anterior');
        await this.clearAwaitingData(phone);
        return await this.transactionHandler.handleTransactionRequest(user, intent, phone, message);
      }
    }

    // Cenário 2: Apenas valor
    if (intent.intencao === 'apenas_valor' && intent.dados.valor) {
      pendingData.intent.dados.valor = intent.dados.valor;
      await this.clearAwaitingData(phone);
      console.log(`[CONTROLLER] Valor ${intent.dados.valor} recebido via apenas_valor`);
      return await this.transactionHandler.handleTransactionRequest(user, pendingData.intent, phone, message);
    }

    // Cenário 2.1: Apenas categoria/procedimento
    if (intent.intencao === 'apenas_procedimento' && intent.dados.categoria) {
      pendingData.intent.dados.categoria = intent.dados.categoria;
      console.log('[CONTROLLER] Novo comando completo detectado, descartando espera anterior');
      await this.clearAwaitingData(phone);
      return await this.transactionHandler.handleTransactionRequest(user, pendingData.intent, phone, message);
    }

    // Cenário 3: Fallback robusto para extrair valor monetário principal
    const valorFallback = extractPrimaryMonetaryValue(message);
    if (valorFallback && Number.isFinite(valorFallback) && valorFallback > 0) {
      const pendingIntent = pendingData.intent;
      pendingIntent.dados.valor = valorFallback;
      await this.clearAwaitingData(phone);
      console.log(`[CONTROLLER] Valor ${valorFallback} recebido via moneyParser fallback`);
      return await this.transactionHandler.handleTransactionRequest(user, pendingIntent, phone, message);
    }

    return 'Não consegui identificar o valor 🤔\n\nMe manda só o número, tipo: _R$ 500_ ou _R$ 1500.50_';
  }

  async handleAwaitingTypeForValue(phone, message, intent, user, pendingData) {
    const pendingValue = Number(pendingData?.intent?.dados?.valor);
    if (!Number.isFinite(pendingValue) || pendingValue <= 0) {
      await this.clearAwaitingData(phone);
      return 'Perdi o valor anterior aqui. Me manda de novo a transação completa, tipo: _Insumos R$ 500_.';
    }

    if (intent.intencao === 'registrar_entrada' || intent.intencao === 'registrar_saida') {
      const mergedIntent = {
        ...intent,
        dados: {
          ...(intent.dados || {}),
          valor: Number.isFinite(Number(intent?.dados?.valor)) && Number(intent.dados.valor) > 0
            ? Number(intent.dados.valor)
            : pendingValue
        }
      };

      if (intent.intencao === 'registrar_saida') {
        mergedIntent.dados.tipo = 'saida';
        if (!mergedIntent.dados.categoria) {
          mergedIntent.dados.categoria = this.resolveCostCategory(message, intent);
        }
      } else {
        mergedIntent.dados.tipo = 'entrada';
        if (!mergedIntent.dados.categoria) {
          mergedIntent.dados.categoria = 'Procedimento';
        }
      }

      if (!mergedIntent.dados.data) {
        mergedIntent.dados.data = this.getTodayDate();
      }

      await this.clearAwaitingData(phone);
      return await this.transactionHandler.handleTransactionRequest(user, mergedIntent, phone, message);
    }

    if (intent.intencao === 'apenas_procedimento' && intent?.dados?.categoria) {
      const entradaIntent = {
        intencao: 'registrar_entrada',
        dados: {
          tipo: 'entrada',
          valor: pendingValue,
          categoria: intent.dados.categoria,
          data: this.getTodayDate()
        }
      };
      await this.clearAwaitingData(phone);
      return await this.transactionHandler.handleTransactionRequest(user, entradaIntent, phone, message);
    }

    const messageLower = String(message || '').toLowerCase().trim();
    const isExpense = this.isExpenseTypeMessage(messageLower);
    const isEntry = this.isEntryTypeMessage(messageLower);
    const categoriaCusto = this.resolveCostCategory(message, intent);
    const hasSpecificCostCategory = categoriaCusto !== 'Outros';

    if (isExpense || (!isEntry && hasSpecificCostCategory)) {
      const saidaIntent = {
        intencao: 'registrar_saida',
        dados: {
          tipo: 'saida',
          valor: pendingValue,
          categoria: categoriaCusto,
          data: this.getTodayDate()
        }
      };
      await this.clearAwaitingData(phone);
      return await this.transactionHandler.handleTransactionRequest(user, saidaIntent, phone, message);
    }

    if (isEntry) {
      const entradaIntent = {
        intencao: 'registrar_entrada',
        dados: {
          tipo: 'entrada',
          valor: pendingValue,
          categoria: intent?.dados?.categoria || 'Procedimento',
          data: this.getTodayDate()
        }
      };
      await this.clearAwaitingData(phone);
      return await this.transactionHandler.handleTransactionRequest(user, entradaIntent, phone, message);
    }

    return 'Perfeito. Agora me diz se foi *venda* ou *gasto*.';
  }

  async handleAwaitingValueForCategory(phone, message, intent, user, pendingData) {
    const categoria = pendingData?.intent?.dados?.categoria || 'Procedimento';
    const valor = Number.isFinite(Number(intent?.dados?.valor)) && Number(intent.dados.valor) > 0
      ? Number(intent.dados.valor)
      : extractPrimaryMonetaryValue(message);

    if (!Number.isFinite(valor) || valor <= 0) {
      return `Perfeito, entendi *${categoria}*. Agora me manda só o valor (ex: _R$ 500_).`;
    }

    const entradaIntent = {
      intencao: 'registrar_entrada',
      dados: {
        tipo: 'entrada',
        valor,
        categoria,
        data: this.getTodayDate()
      }
    };

    await this.clearAwaitingData(phone);
    return await this.transactionHandler.handleTransactionRequest(user, entradaIntent, phone, message);
  }

  isExpenseTypeMessage(messageLower) {
    const expenseHints = ['gasto', 'custo', 'despesa', 'saida', 'saída', 'paguei', 'comprei'];
    return expenseHints.some((token) => messageLower.includes(token));
  }

  isEntryTypeMessage(messageLower) {
    const entryHints = ['venda', 'receita', 'entrada', 'entrou', 'ganhei', 'recebi'];
    return entryHints.some((token) => messageLower.includes(token));
  }

  resolveCostCategory(message, intent) {
    const intentCategory = intent?.dados?.categoria;
    if (typeof intentCategory === 'string' && intentCategory.trim().length > 0) {
      return intentCategory.trim();
    }

    const costInfo = intentHeuristicService.extractCostInfo(message || '');
    if (costInfo?.categoria && costInfo.categoria !== 'Outros') {
      return costInfo.categoria;
    }

    return 'Outros';
  }

  getTodayDate() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Processa confirmação de membro secundário
   */
  async handleSecondaryMemberConfirmation(user, phone, message) {
    const onboardingCopy = require('../copy/onboardingWhatsappCopy');
    const clinicMemberService = require('../services/clinicMemberService');

    const messageLower = message.toLowerCase().trim();

    // Verifica se é resposta à confirmação
    const isYes = messageLower === '1' || messageLower === 'sim' ||
      messageLower.includes('confirmo') || messageLower.includes('aceito');
    const isNo = messageLower === '2' || messageLower === 'não' ||
      messageLower === 'nao' || messageLower.includes('não sou');

    if (isYes) {
      // Confirma o vínculo
      await clinicMemberService.confirmMember(phone);

      // Invalida cache para que próxima consulta pegue confirmed=true
      await cacheService.delete(`phone:profile:${phone}`);

      return onboardingCopy.secondaryNumberConfirmed(user.nome_clinica);
    }

    if (isNo) {
      // Rejeita o vínculo
      await clinicMemberService.rejectMember(phone);

      // Invalida cache
      await cacheService.delete(`phone:profile:${phone}`);

      return onboardingCopy.secondaryNumberRejected();
    }

    // Se não é resposta clara, mostra a pergunta de confirmação
    // Busca quem adicionou este membro para mostrar na mensagem
    const member = await clinicMemberService.findMemberByPhone(phone);
    const addedByName = member?.profiles?.nome_completo || 'alguém da clínica';

    return onboardingCopy.secondaryNumberConfirmation(user.nome_clinica, addedByName);
  }

  /**
   * Handlers de mensagens de mídia (delegam para documentHandler ou onboarding)
   */
  async handleImageMessage(phone, mediaUrl, caption, messageKey = null) {
    const normalizedPhone = normalizePhone(phone) || phone;
    this.startMediaProcessing(normalizedPhone, 'image');

    try {
      if (mdrChatFlowService.isActive(normalizedPhone)) {
        const user = await userController.findUserByPhone(normalizedPhone);
        if (user) {
          const mdrResponse = await mdrChatFlowService.handleMedia({
            phone: normalizedPhone,
            user,
            mediaUrl
          });
          if (mdrResponse) {
            return mdrResponse;
          }
        }
      }

      // Se está em onboarding, processa no onboarding
      if (await onboardingFlowService.ensureOnboardingState(normalizedPhone)) {
        return await onboardingFlowService.processOnboarding(
          normalizedPhone,
          caption || '',
          mediaUrl,
          null,
          messageKey
        );
      }

      return await this.documentHandler.handleImageMessage(phone, mediaUrl, caption, messageKey);
    } finally {
      this.stopMediaProcessing(normalizedPhone);
    }
  }

  async handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption, messageKey = null) {
    const normalizedPhone = normalizePhone(phone) || phone;
    this.startMediaProcessing(normalizedPhone, 'image_buffer');

    try {
      if (await onboardingFlowService.ensureOnboardingState(normalizedPhone)) {
        return await onboardingFlowService.processOnboarding(
          normalizedPhone,
          caption || '',
          null,
          null,
          messageKey,
          imageBuffer,
          mimeType
        );
      }

      return await this.documentHandler.handleImageMessageWithBuffer(phone, imageBuffer, mimeType, caption);
    } finally {
      this.stopMediaProcessing(normalizedPhone);
    }
  }

  async handleDocumentMessage(phone, mediaUrl, fileName, messageKey = null) {
    const normalizedPhone = normalizePhone(phone) || phone;
    this.startMediaProcessing(normalizedPhone, 'document');

    try {
      if (mdrChatFlowService.isActive(normalizedPhone)) {
        const user = await userController.findUserByPhone(normalizedPhone);
        if (user) {
          const mdrResponse = await mdrChatFlowService.handleMedia({
            phone: normalizedPhone,
            user,
            mediaUrl
          });
          if (mdrResponse) {
            return mdrResponse;
          }
        }
      }

      // Se está em onboarding, processa no onboarding
      if (await onboardingFlowService.ensureOnboardingState(normalizedPhone)) {
        return await onboardingFlowService.processOnboarding(
          normalizedPhone,
          '',
          mediaUrl,
          fileName,
          messageKey
        );
      }

      return await this.documentHandler.handleDocumentMessage(phone, mediaUrl, fileName, messageKey);
    } finally {
      this.stopMediaProcessing(normalizedPhone);
    }
  }

  async handleDocumentMessageWithBuffer(phone, docBuffer, mimeType, fileName, messageKey = null) {
    const normalizedPhone = normalizePhone(phone) || phone;
    this.startMediaProcessing(normalizedPhone, 'document_buffer');

    try {
      if (await onboardingFlowService.ensureOnboardingState(normalizedPhone)) {
        return await onboardingFlowService.processOnboarding(
          normalizedPhone,
          '',
          null,
          fileName,
          messageKey,
          docBuffer,
          mimeType
        );
      }

      const documentService = require('../services/documentService');
      const user = await userController.findUserByPhone(normalizedPhone);
      if (!user) {
        await onboardingFlowService.startNewOnboarding(normalizedPhone);
        return null;
      }

      const result = await documentService.processDocumentFromBuffer(docBuffer, mimeType, fileName);
      const response = documentService.formatDocumentSummary(result);

      if (result.transacoes && result.transacoes.length > 0) {
        this.pendingDocumentTransactions.set(normalizedPhone, {
          user,
          transacoes: result.transacoes,
          timestamp: Date.now()
        });
        setTimeout(() => this.pendingDocumentTransactions.delete(normalizedPhone), 30 * 60 * 1000);
      }

      return response;
    } finally {
      this.stopMediaProcessing(normalizedPhone);
    }
  }

  /**
   * Handler para código de boleto
   */
  async handleBarcodeMessage(user, intent, phone) {
    const codigo = intent.dados.codigo;
    let response = `Recebi o código do boleto! 🔢\n\n`;
    response += `Agora me diz: esse boleto é de quê e qual o valor?\n\n`;
    response += `Por exemplo:\n_"Fornecedor R$ 1500"_\n_"Conta de luz R$ 450"_\n\n`;
    response += `Ou se preferir, manda uma foto do boleto que eu leio tudo automaticamente 📸`;
    return response;
  }

  /**
   * Handlers auxiliares
   */
  async handleOnlyValue(intent, phone) {
    const valor = intent.dados.valor;
    return `Entendi, *${formatarMoeda(valor)}* 💰\n\nIsso foi *venda* ou *gasto*?\n\nResponde com uma palavra:\n• venda\n• gasto`;
  }

  async handleOnlyProcedure(intent, phone) {
    const categoria = intent.dados.categoria;
    return `Beleza, *${categoria}*! 💉\n\nE qual foi o valor?\n\nMe manda completo, tipo:\n_"${categoria} R$ 2800"_`;
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
