describe('MessageController - entendimento conversacional', () => {
  let controller;
  let handleTransactionRequestMock;
  let extractPrimaryMonetaryValueMock;
  let extractCostInfoMock;

  const mockGenericHandler = () => jest.fn().mockImplementation(() => ({}));

  beforeEach(() => {
    jest.resetModules();

    handleTransactionRequestMock = jest.fn().mockResolvedValue('ok');
    extractPrimaryMonetaryValueMock = jest.fn().mockReturnValue(null);
    extractCostInfoMock = jest.fn((text) => {
      const normalized = String(text || '').toLowerCase();
      if (normalized.includes('luz') || normalized.includes('energia')) return { categoria: 'Energia' };
      if (normalized.includes('internet') || normalized.includes('telefone') || normalized.includes('celular')) return { categoria: 'Internet' };
      return { categoria: 'Outros' };
    });

    jest.doMock('../../src/services/geminiService', () => ({ processMessage: jest.fn() }));
    jest.doMock('../../src/services/evolutionService', () => ({}));
    jest.doMock('../../src/controllers/userController', () => ({ findUserByPhone: jest.fn() }));
    jest.doMock('../../src/services/onboardingFlowService', () => ({
      ensureOnboardingState: jest.fn().mockResolvedValue(false),
      processOnboarding: jest.fn(),
      startIntroFlow: jest.fn(),
      startNewOnboarding: jest.fn()
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
      detectIntent: jest.fn(),
      extractCostInfo: extractCostInfoMock
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
      extractPrimaryMonetaryValue: extractPrimaryMonetaryValueMock
    }));

    jest.doMock('../../src/controllers/messages/transactionHandler', () => jest.fn().mockImplementation(() => ({
      handleTransactionRequest: handleTransactionRequestMock,
      handleConfirmation: jest.fn()
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
      handleEditTransaction: jest.fn()
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
      handleGreeting: jest.fn(),
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
      handleRemoveMember: jest.fn()
    })));

    jest.doMock('../../src/services/mdrChatFlowService', () => ({
      isActive: jest.fn().mockReturnValue(false),
      handleMessageIfNeeded: jest.fn().mockResolvedValue(null),
      handleMedia: jest.fn().mockResolvedValue(null)
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

  test('usa fallback de valor em registrar_saida quando valor vem nulo', async () => {
    extractPrimaryMonetaryValueMock.mockReturnValue(1000);

    const intent = {
      intencao: 'registrar_saida',
      dados: {
        tipo: 'saida',
        valor: null,
        categoria: 'Energia',
        data: '2026-02-24'
      }
    };

    await controller.routeIntent(intent, { id: 'user-1' }, '5511999999999', 'luz 1000 reais');

    expect(handleTransactionRequestMock).toHaveBeenCalledTimes(1);
    const mergedIntent = handleTransactionRequestMock.mock.calls[0][1];
    expect(mergedIntent.dados.valor).toBe(1000);
    expect(mergedIntent.dados.categoria).toBe('Energia');
  });

  test('combina apenas_valor + gasto sem pedir valor de novo', async () => {
    const phone = '5511888888888';
    controller.getAwaitingData().set(phone, {
      stage: 'awaiting_type_for_value',
      intent: { intencao: 'apenas_valor', dados: { valor: 1000 } },
      timestamp: Date.now()
    });

    const response = await controller.handleAwaitingData(
      phone,
      'gasto',
      { intencao: 'mensagem_ambigua', dados: {} },
      { id: 'user-1' }
    );

    expect(response).toBe('ok');
    expect(handleTransactionRequestMock).toHaveBeenCalledTimes(1);

    const intent = handleTransactionRequestMock.mock.calls[0][1];
    expect(intent.intencao).toBe('registrar_saida');
    expect(intent.dados.tipo).toBe('saida');
    expect(intent.dados.valor).toBe(1000);
    expect(intent.dados.categoria).toBe('Outros');
    expect(controller.getAwaitingData().has(phone)).toBe(false);
  });

  test('combina apenas_valor + venda com categoria padrão Procedimento', async () => {
    const phone = '5511777777777';
    controller.getAwaitingData().set(phone, {
      stage: 'awaiting_type_for_value',
      intent: { intencao: 'apenas_valor', dados: { valor: 1000 } },
      timestamp: Date.now()
    });

    await controller.handleAwaitingData(
      phone,
      'venda',
      { intencao: 'mensagem_ambigua', dados: {} },
      { id: 'user-1' }
    );

    const intent = handleTransactionRequestMock.mock.calls[0][1];
    expect(intent.intencao).toBe('registrar_entrada');
    expect(intent.dados.tipo).toBe('entrada');
    expect(intent.dados.valor).toBe(1000);
    expect(intent.dados.categoria).toBe('Procedimento');
  });

  test('combina apenas_valor + gasto luz com categoria Energia', async () => {
    const phone = '5511666666666';
    controller.getAwaitingData().set(phone, {
      stage: 'awaiting_type_for_value',
      intent: { intencao: 'apenas_valor', dados: { valor: 1000 } },
      timestamp: Date.now()
    });

    await controller.handleAwaitingData(
      phone,
      'gasto luz',
      { intencao: 'mensagem_ambigua', dados: {} },
      { id: 'user-1' }
    );

    const intent = handleTransactionRequestMock.mock.calls[0][1];
    expect(intent.intencao).toBe('registrar_saida');
    expect(intent.dados.categoria).toBe('Energia');
    expect(intent.dados.valor).toBe(1000);
  });

  test('suporta stage awaiting_value_for_category com apenas_valor', async () => {
    const phone = '5511555555555';
    controller.getAwaitingData().set(phone, {
      stage: 'awaiting_value_for_category',
      intent: { intencao: 'apenas_procedimento', dados: { categoria: 'Botox' } },
      timestamp: Date.now()
    });

    await controller.handleAwaitingData(
      phone,
      '1000',
      { intencao: 'apenas_valor', dados: { valor: 1000 } },
      { id: 'user-1' }
    );

    const intent = handleTransactionRequestMock.mock.calls[0][1];
    expect(intent.intencao).toBe('registrar_entrada');
    expect(intent.dados.categoria).toBe('Botox');
    expect(intent.dados.valor).toBe(1000);
  });

  test('expira awaitingData antigo e limpa estado', async () => {
    const phone = '5511444444444';
    controller.getAwaitingData().set(phone, {
      stage: 'awaiting_type_for_value',
      intent: { intencao: 'apenas_valor', dados: { valor: 1000 } },
      timestamp: Date.now() - (11 * 60 * 1000)
    });

    const response = await controller.handleAwaitingData(
      phone,
      'gasto',
      { intencao: 'mensagem_ambigua', dados: {} },
      { id: 'user-1' }
    );

    expect(response).toContain('expirou');
    expect(controller.getAwaitingData().has(phone)).toBe(false);
    expect(handleTransactionRequestMock).not.toHaveBeenCalled();
  });

  test('mantém regressão: comando completo continua direto para confirmação', async () => {
    const intent = {
      intencao: 'registrar_entrada',
      dados: {
        tipo: 'entrada',
        valor: 2800,
        categoria: 'Botox',
        data: '2026-02-24'
      }
    };

    await controller.routeIntent(intent, { id: 'user-1' }, '5511333333333', 'botox 2800');

    expect(handleTransactionRequestMock).toHaveBeenCalledTimes(1);
    const routedIntent = handleTransactionRequestMock.mock.calls[0][1];
    expect(routedIntent.dados.valor).toBe(2800);
    expect(routedIntent.dados.categoria).toBe('Botox');
  });

  test('cancelar em awaitingData continua removendo estado', async () => {
    const phone = '5511222222222';
    controller.getAwaitingData().set(phone, {
      stage: 'awaiting_type_for_value',
      intent: { intencao: 'apenas_valor', dados: { valor: 1000 } },
      timestamp: Date.now()
    });

    const response = await controller.handleAwaitingData(
      phone,
      'cancelar',
      { intencao: 'mensagem_ambigua', dados: {} },
      { id: 'user-1' }
    );

    expect(response).toContain('cancelei');
    expect(controller.getAwaitingData().has(phone)).toBe(false);
    expect(handleTransactionRequestMock).not.toHaveBeenCalled();
  });
});
