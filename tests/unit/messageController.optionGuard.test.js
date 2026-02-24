describe('MessageController - guard de opções órfãs', () => {
  let controller;
  let detectIntentMock;
  let handleTransactionRequestMock;
  let runtimeGetAllActiveMock;

  const mockGenericHandler = () => jest.fn().mockImplementation(() => ({}));

  beforeEach(() => {
    jest.resetModules();

    detectIntentMock = jest.fn();
    handleTransactionRequestMock = jest.fn().mockResolvedValue('ok');
    runtimeGetAllActiveMock = jest.fn().mockResolvedValue([]);

    jest.doMock('../../src/services/geminiService', () => ({ processMessage: jest.fn() }));
    jest.doMock('../../src/services/evolutionService', () => ({}));
    jest.doMock('../../src/services/cacheService', () => ({
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true)
    }));

    jest.doMock('../../src/controllers/userController', () => ({
      findUserByPhone: jest.fn().mockResolvedValue({ id: 'user-1', nome_clinica: 'Clinica Teste' })
    }));

    jest.doMock('../../src/services/clinicMemberService', () => ({
      findMemberByPhone: jest.fn().mockResolvedValue(null)
    }));

    jest.doMock('../../src/services/onboardingFlowService', () => ({
      ensureOnboardingState: jest.fn().mockResolvedValue(false),
      processOnboarding: jest.fn(),
      startIntroFlow: jest.fn(),
      startNewOnboarding: jest.fn(),
      getOnboardingStep: jest.fn().mockReturnValue(null)
    }));

    jest.doMock('../../src/controllers/transactionController', () => ({}));
    jest.doMock('../../src/services/conversationHistoryService', () => ({
      getRecentHistory: jest.fn().mockResolvedValue([]),
      findSimilarExamples: jest.fn().mockResolvedValue([]),
      saveConversation: jest.fn().mockResolvedValue(true)
    }));
    jest.doMock('../../src/services/analyticsService', () => ({ track: jest.fn().mockResolvedValue(true) }));
    jest.doMock('../../src/services/pdfQueueService', () => ({ addJob: jest.fn().mockResolvedValue(true) }));

    jest.doMock('../../src/services/intentHeuristicService', () => ({
      detectIntent: detectIntentMock,
      extractCostInfo: jest.fn().mockReturnValue({ categoria: 'Outros' })
    }));

    jest.doMock('../../src/services/conversationRuntimeStateService', () => ({
      getAllActive: runtimeGetAllActiveMock,
      upsert: jest.fn().mockResolvedValue(true),
      clear: jest.fn().mockResolvedValue(true)
    }));

    jest.doMock('../../src/db/supabase', () => ({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null })
      }))
    }));

    jest.doMock('../../src/utils/phone', () => ({ normalizePhone: (phone) => phone }));
    jest.doMock('../../src/utils/moneyParser', () => ({
      extractPrimaryMonetaryValue: jest.fn().mockReturnValue(null)
    }));

    jest.doMock('../../src/controllers/messages/transactionHandler', () => jest.fn().mockImplementation(() => ({
      handleTransactionRequest: handleTransactionRequestMock,
      handleConfirmation: jest.fn().mockResolvedValue('confirmado'),
      restorePendingTransaction: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/queryHandler', () => jest.fn().mockImplementation(() => ({
      handleBalance: jest.fn(),
      handleHistory: jest.fn(),
      handleMonthlyReport: jest.fn(),
      handleCompareCustomPeriods: jest.fn(),
      handleCompareMonths: jest.fn(),
      handleTodayStats: jest.fn(),
      handleProcedureRanking: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/documentHandler', () => jest.fn().mockImplementation(() => ({
      handleDocumentConfirmation: jest.fn(),
      getPersistedPendingConfirmation: jest.fn().mockResolvedValue(null),
      handleImageMessage: jest.fn(),
      handleImageMessageWithBuffer: jest.fn(),
      handleDocumentMessage: jest.fn(),
      handleDocumentMessageWithBuffer: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/editHandler', () => jest.fn().mockImplementation(() => ({
      handleEditConfirmation: jest.fn(),
      handleUndoLastTransaction: jest.fn(),
      handleEditTransaction: jest.fn(),
      restorePendingEdit: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/searchHandler', () => jest.fn().mockImplementation(() => ({
      handleSearchTransaction: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/goalHandler', () => jest.fn().mockImplementation(() => ({
      handleGoalProgress: jest.fn(),
      handleDefineGoal: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/helpHandler', () => jest.fn().mockImplementation(() => ({
      handleDocumentPrompt: jest.fn(),
      handleGreeting: jest.fn().mockReturnValue('oi'),
      handleHelp: jest.fn(),
      handleAmbiguousMessage: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/installmentHandler', () => jest.fn().mockImplementation(() => ({
      handlePendingInstallments: jest.fn(),
      handleMarkInstallmentPaid: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/exportHandler', mockGenericHandler);
    jest.doMock('../../src/controllers/messages/scheduleHandler', () => jest.fn().mockImplementation(() => ({
      handleSchedule: jest.fn()
    })));
    jest.doMock('../../src/controllers/messages/insightsHandler', () => jest.fn().mockImplementation(() => ({
      handleInsights: jest.fn()
    })));

    jest.doMock('../../src/controllers/messages/memberHandler', () => jest.fn().mockImplementation(() => ({
      isAddingMember: jest.fn().mockReturnValue(false),
      processAddMember: jest.fn(),
      isRemovingMember: jest.fn().mockReturnValue(false),
      processRemoveMember: jest.fn(),
      hasPendingTransfer: jest.fn().mockReturnValue(false),
      processTransferResponse: jest.fn(),
      handleAddMember: jest.fn(),
      handleListMembers: jest.fn(),
      handleRemoveMember: jest.fn(),
      restoreAddMemberState: jest.fn(),
      restoreRemoveMemberState: jest.fn()
    })));

    jest.doMock('../../src/services/mdrChatFlowService', () => ({
      isActive: jest.fn().mockReturnValue(false),
      handleMessageIfNeeded: jest.fn().mockResolvedValue(null),
      handleMedia: jest.fn().mockResolvedValue(null),
      restoreState: jest.fn()
    }));

    jest.doMock('../../src/services/betaFeedbackService', () => ({
      capture: jest.fn().mockResolvedValue(true)
    }));

    controller = require('../../src/controllers/messageController');
    controller.getAwaitingData().clear();
  });

  afterEach(() => {
    if (controller?.getAwaitingData) {
      controller.getAwaitingData().clear();
    }
    jest.clearAllMocks();
  });

  test('bloqueia opção órfã e não classifica como valor', async () => {
    const response = await controller.handleIncomingMessage('5511999999999', '1');

    expect(response).toContain('Não encontrei confirmação pendente agora');
    expect(detectIntentMock).not.toHaveBeenCalled();
  });

  test('mantém exceção: em awaiting_value_for_category, 1 é aceito como valor', async () => {
    const phone = '5511888888888';

    controller.getAwaitingData().set(phone, {
      stage: 'awaiting_value_for_category',
      intent: { intencao: 'apenas_procedimento', dados: { categoria: 'Botox' } },
      timestamp: Date.now()
    });

    detectIntentMock.mockResolvedValue({
      intencao: 'apenas_valor',
      dados: { valor: 1 },
      confidence: 0.9,
      source: 'heuristic'
    });

    const response = await controller.handleIncomingMessage(phone, '1');

    expect(response).toBe('ok');
    expect(handleTransactionRequestMock).toHaveBeenCalledTimes(1);
    const mergedIntent = handleTransactionRequestMock.mock.calls[0][1];
    expect(mergedIntent.dados.valor).toBe(1);
  });
});
