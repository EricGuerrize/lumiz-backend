describe('MessageController - reidratação de estado runtime', () => {
  let controller;
  let runtimeStates;
  let runtimeGetAllActiveMock;
  let detectIntentMock;
  let transactionHandleConfirmationMock;
  let memberProcessRemoveMock;
  let mdrHandleMessageIfNeededMock;
  let mdrRestoreStateMock;

  const mockGenericHandler = () => jest.fn().mockImplementation(() => ({}));

  beforeEach(() => {
    jest.resetModules();

    runtimeStates = [];
    detectIntentMock = jest.fn();
    transactionHandleConfirmationMock = jest.fn();
    memberProcessRemoveMock = jest.fn();
    mdrHandleMessageIfNeededMock = jest.fn().mockResolvedValue(null);
    mdrRestoreStateMock = jest.fn();

    runtimeGetAllActiveMock = jest.fn().mockImplementation(async () => runtimeStates);

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

    jest.doMock('../../src/controllers/messages/transactionHandler', () => jest.fn().mockImplementation((pendingTransactions) => ({
      handleTransactionRequest: jest.fn().mockResolvedValue('tx-request-ok'),
      handleConfirmation: transactionHandleConfirmationMock,
      restorePendingTransaction: jest.fn((phone, pending) => pendingTransactions.set(phone, pending))
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

    jest.doMock('../../src/controllers/messages/editHandler', () => jest.fn().mockImplementation((pendingEdits) => ({
      handleEditConfirmation: jest.fn(),
      handleUndoLastTransaction: jest.fn(),
      handleEditTransaction: jest.fn(),
      restorePendingEdit: jest.fn((phone, pending) => pendingEdits.set(phone, pending))
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

    jest.doMock('../../src/controllers/messages/memberHandler', () => jest.fn().mockImplementation(() => {
      let removing = false;
      let adding = false;
      return {
        isAddingMember: jest.fn(() => adding),
        processAddMember: jest.fn(),
        isRemovingMember: jest.fn(() => removing),
        processRemoveMember: memberProcessRemoveMock,
        hasPendingTransfer: jest.fn().mockReturnValue(false),
        processTransferResponse: jest.fn(),
        handleAddMember: jest.fn(),
        handleListMembers: jest.fn(),
        handleRemoveMember: jest.fn(),
        restoreAddMemberState: jest.fn(() => { adding = true; }),
        restoreRemoveMemberState: jest.fn(() => { removing = true; })
      };
    }));

    let mdrActive = false;
    jest.doMock('../../src/services/mdrChatFlowService', () => ({
      isActive: jest.fn(() => mdrActive),
      handleMessageIfNeeded: jest.fn(async (args) => {
        await mdrHandleMessageIfNeededMock(args);
        return mdrActive ? 'mdr-flow-ok' : null;
      }),
      handleMedia: jest.fn().mockResolvedValue(null),
      restoreState: jest.fn((phone, payload) => {
        mdrRestoreStateMock(phone, payload);
        mdrActive = true;
      })
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

  test('rehidrata tx_confirm e processa resposta 1 sem virar valor', async () => {
    runtimeStates = [{
      flow: 'tx_confirm',
      payload: {
        stage: 'confirm',
        dados: { tipo: 'saida', valor: 1000, categoria: 'Outros', data: '2026-02-24' },
        timestamp: Date.now()
      }
    }];

    transactionHandleConfirmationMock.mockResolvedValue('confirmado');

    const response = await controller.handleIncomingMessage('5511999999999', '1');

    expect(response).toBe('confirmado');
    expect(transactionHandleConfirmationMock).toHaveBeenCalled();
    expect(detectIntentMock).not.toHaveBeenCalled();
  });

  test('rehidrata tx_confirm e processa resposta 2 para cancelamento', async () => {
    runtimeStates = [{
      flow: 'tx_confirm',
      payload: {
        stage: 'confirm',
        dados: { tipo: 'entrada', valor: 2000, categoria: 'Botox', data: '2026-02-24' },
        timestamp: Date.now()
      }
    }];

    transactionHandleConfirmationMock.mockResolvedValue('cancelado');

    const response = await controller.handleIncomingMessage('5511999999999', '2');

    expect(response).toBe('cancelado');
    expect(transactionHandleConfirmationMock).toHaveBeenCalled();
    expect(detectIntentMock).not.toHaveBeenCalled();
  });

  test('rehidrata fluxo de remoção de membro e processa opção', async () => {
    runtimeStates = [{
      flow: 'member_remove',
      payload: {
        step: 'CONFIRM',
        selectedMember: { id: 'member-1', nome: 'Ana', telefone: '5511999990000' },
        members: [],
        timestamp: Date.now()
      }
    }];

    memberProcessRemoveMock.mockResolvedValue('remove-ok');

    const response = await controller.handleIncomingMessage('5511999999999', '1');

    expect(response).toBe('remove-ok');
    expect(memberProcessRemoveMock).toHaveBeenCalled();
    expect(detectIntentMock).not.toHaveBeenCalled();
  });

  test('rehidrata fluxo mdr e mantém processamento por opção', async () => {
    runtimeStates = [{
      flow: 'mdr_flow',
      payload: {
        step: 'REVIEW_MANUAL',
        provider: 'Stone',
        timestamp: Date.now()
      }
    }];

    const response = await controller.handleIncomingMessage('5511999999999', '1');

    expect(response).toBe('mdr-flow-ok');
    expect(mdrRestoreStateMock).toHaveBeenCalled();
    expect(detectIntentMock).not.toHaveBeenCalled();
  });
});
