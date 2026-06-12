/**
 * Testes dos itens do canal WhatsApp (itens do CSV de features V1).
 * Cobre copy functions e métodos de alerta do whatsappOperationalAlertService.
 *
 * Itens cobertos:
 *  #11 contasVencendo — 3 níveis de urgência
 *  #45 sendCobrancaAlerts — régua em 4 tiers
 *  #49 sendCashFlowGapAlerts — gap de caixa proativo
 *  #56 sendCriticalStockAlerts — flag guard
 *  #57 sendValidityAlerts — flag guard
 *  #58 sendPatientReturnAlerts — flag guard + conteúdo
 *  #59 sendPatientReactivationAlerts — flag guard
 *  #82 goalReminderService — env var guard WHATSAPP_WEEKLY_GOAL_ENABLED
 *  copy — gapDeCaixa, cobrancaTier1-3, cobrancaEscalado, retornoPaciente, reativacaoPaciente
 */

process.env.NODE_ENV = 'test';

jest.mock('../../src/db/supabase', () => ({ from: jest.fn() }));
jest.mock('../../src/services/outboundMessageService', () => ({ sendText: jest.fn() }));
jest.mock('../../src/services/nfValidadeService', () => ({ listarProximos: jest.fn() }));
jest.mock('../../src/services/inadimplenciaService', () => ({ getOverview: jest.fn() }));
jest.mock('../../src/services/cashflowService', () => ({ getCashflowProjection: jest.fn() }));
jest.mock('../../src/services/estoqueProdutoService', () => ({
  listarLotesProximosVencimento: jest.fn(),
  getProdutosAbaixoMinimo: jest.fn()
}));
jest.mock('../../src/controllers/messages/queryHandler', () =>
  jest.fn().mockImplementation(() => ({ handleDailyBriefing: jest.fn() }))
);
jest.mock('../../src/services/reminderSentHelper', () => ({
  alreadySent: jest.fn(),
  markSent: jest.fn()
}));

const supabase = require('../../src/db/supabase');
const outboundMessageService = require('../../src/services/outboundMessageService');
const inadimplenciaService = require('../../src/services/inadimplenciaService');
const cashflowService = require('../../src/services/cashflowService');
const { alreadySent, markSent } = require('../../src/services/reminderSentHelper');
const service = require('../../src/services/whatsappOperationalAlertService');
const copy = require('../../src/copy/operationalAlertWhatsappCopy');

function mockProfiles(rows) {
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockResolvedValue({ data: rows, error: null })
  });
}

const PROFILE = { id: 'user-1', telefone: '5565999990001' };

beforeEach(() => {
  jest.clearAllMocks();
  mockProfiles([PROFILE]);
  alreadySent.mockResolvedValue(false);
  markSent.mockResolvedValue(undefined);
  outboundMessageService.sendText.mockResolvedValue({ success: true });
});

// ─── Copy functions ──────────────────────────────────────────────────────────

describe('operationalAlertWhatsappCopy', () => {
  describe('contasVencendo (#11) — 3 níveis de urgência', () => {
    const conta = { descricao: 'Aluguel', valor: 2500, data_vencimento: '2026-06-12' };

    it('usa 🚨 para vencimento em 1 dia', () => {
      const msg = copy.contasVencendo([conta], 1);
      expect(msg).toContain('🚨');
      expect(msg).toContain('*amanhã*');
    });

    it('usa ⚠️ para vencimento em 3 dias', () => {
      const msg = copy.contasVencendo([conta], 3);
      expect(msg).toContain('⚠️');
      expect(msg).toContain('*3 dias*');
    });

    it('usa ℹ️ para vencimento em 7 dias', () => {
      const msg = copy.contasVencendo([conta], 7);
      expect(msg).toContain('ℹ️');
      expect(msg).toContain('*7 dias*');
    });

    it('retorna null para lista vazia', () => {
      expect(copy.contasVencendo([], 3)).toBeNull();
    });
  });

  describe('gapDeCaixa (#49)', () => {
    const negativeDays = [
      { data: '2026-06-20', saldoAcumulado: -1200 },
      { data: '2026-06-21', saldoAcumulado: -800 }
    ];

    it('exibe saldo atual e dias negativos', () => {
      const msg = copy.gapDeCaixa(3500, negativeDays);
      expect(msg).toContain('⚡');
      expect(msg).toContain('R$ 3.500');
      expect(msg).toContain('20/06');
      expect(msg).toContain('fluxo de caixa');
    });

    it('retorna null para lista vazia', () => {
      expect(copy.gapDeCaixa(5000, [])).toBeNull();
    });

    it('limita a 3 dias exibidos com overflow', () => {
      const many = Array.from({ length: 5 }, (_, i) => ({
        data: `2026-06-2${i}`,
        saldoAcumulado: -100 * (i + 1)
      }));
      const msg = copy.gapDeCaixa(1000, many);
      expect(msg).toContain('mais 2 dia(s)');
    });
  });

  describe('régua de cobrança (#45)', () => {
    const clientes1 = [{ nome: 'Ana', totalEmAtraso: 300, diasAtrasoMax: 3 }];
    const clientes2 = [{ nome: 'Bruno', totalEmAtraso: 600, diasAtrasoMax: 10 }];
    const clientes3 = [{ nome: 'Carla', totalEmAtraso: 1200, diasAtrasoMax: 20 }];
    const clientesEsc = [{ nome: 'Diego', totalEmAtraso: 2500, diasAtrasoMax: 45 }];

    it('tier1 (1-6d): tom amigável com 📋', () => {
      const msg = copy.cobrancaTier1(clientes1);
      expect(msg).toContain('📋');
      expect(msg).toContain('1–6 dias');
      expect(msg).toContain('Ana');
      expect(msg).toContain('esquecimento');
    });

    it('tier2 (7-14d): tom atencioso com ⚠️', () => {
      const msg = copy.cobrancaTier2(clientes2);
      expect(msg).toContain('⚠️');
      expect(msg).toContain('7–14 dias');
      expect(msg).toContain('Bruno');
      expect(msg).toContain('10d');
    });

    it('tier3 (15-29d): tom urgente com 🔴', () => {
      const msg = copy.cobrancaTier3(clientes3);
      expect(msg).toContain('🔴');
      expect(msg).toContain('15–29 dias');
      expect(msg).toContain('Carla');
    });

    it('escalado (30+d): tom sério com 🚨', () => {
      const msg = copy.cobrancaEscalado(clientesEsc);
      expect(msg).toContain('🚨');
      expect(msg).toContain('30+ dias');
      expect(msg).toContain('Diego');
      expect(msg).toContain('45d');
    });

    it('retorna null para lista vazia em qualquer tier', () => {
      expect(copy.cobrancaTier1([])).toBeNull();
      expect(copy.cobrancaTier2([])).toBeNull();
      expect(copy.cobrancaTier3([])).toBeNull();
      expect(copy.cobrancaEscalado([])).toBeNull();
    });

    it('limita a 5 clientes com overflow', () => {
      const muitos = Array.from({ length: 7 }, (_, i) => ({
        nome: `Cliente ${i}`,
        totalEmAtraso: 100,
        diasAtrasoMax: 5
      }));
      const msg = copy.cobrancaTier1(muitos);
      expect(msg).toContain('mais 2 cliente(s)');
    });
  });

  describe('retornoPaciente (#58) e reativacaoPaciente (#59)', () => {
    it('retornoPaciente exibe paciente, procedimento e dias', () => {
      const msg = copy.retornoPaciente([{
        paciente: 'Ana', procedimento: 'Botox',
        ultimaData: '2026-02-15', diasSemAtendimento: 115
      }]);
      expect(msg).toContain('Ana');
      expect(msg).toContain('Botox');
      expect(msg).toContain('115d');
    });

    it('reativacaoPaciente exibe paciente e dias sem atendimento', () => {
      const msg = copy.reativacaoPaciente([{ paciente: 'Maria', diasSemAtendimento: 52 }]);
      expect(msg).toContain('Maria');
      expect(msg).toContain('52d');
    });

    it('retornoPaciente retorna null para lista vazia', () => {
      expect(copy.retornoPaciente([])).toBeNull();
    });
  });
});

// ─── Service: sendCashFlowGapAlerts (#49) ────────────────────────────────────

describe('sendCashFlowGapAlerts (#49)', () => {
  const PROJECTION_NEGATIVE = {
    saldoAtual: 1500,
    days: [
      { data: '2026-06-20', saldoAcumulado: -300, caixaNegativo: true },
      { data: '2026-06-21', saldoAcumulado: -500, caixaNegativo: true }
    ],
    summary: { temProjecaoCaixaNegativo: true, saldoFinal: -500 }
  };
  const PROJECTION_OK = {
    saldoAtual: 5000,
    days: [{ data: '2026-06-20', saldoAcumulado: 4800, caixaNegativo: false }],
    summary: { temProjecaoCaixaNegativo: false, saldoFinal: 4800 }
  };

  beforeEach(() => {
    process.env.WHATSAPP_CASH_GAP_ALERTS_ENABLED = 'true';
    cashflowService.getCashflowProjection.mockResolvedValue(PROJECTION_NEGATIVE);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_CASH_GAP_ALERTS_ENABLED;
  });

  it('retorna [] sem chamar outbound quando flag está desativada', async () => {
    delete process.env.WHATSAPP_CASH_GAP_ALERTS_ENABLED;
    const sent = await service.sendCashFlowGapAlerts();
    expect(sent).toEqual([]);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
  });

  it('envia alerta quando projeção tem dias negativos', async () => {
    const sent = await service.sendCashFlowGapAlerts();
    expect(outboundMessageService.sendText).toHaveBeenCalledWith(
      PROFILE.telefone,
      expect.stringContaining('⚡'),
      expect.objectContaining({ messageType: 'cash_gap_alert', source: 'cron' })
    );
    expect(markSent).toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it('não envia quando projeção é positiva', async () => {
    cashflowService.getCashflowProjection.mockResolvedValue(PROJECTION_OK);
    const sent = await service.sendCashFlowGapAlerts();
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('não reenvia se dedup já marcou como enviado', async () => {
    alreadySent.mockResolvedValue(true);
    const sent = await service.sendCashFlowGapAlerts();
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

// ─── Service: sendCobrancaAlerts (#45) ───────────────────────────────────────

describe('sendCobrancaAlerts (#45)', () => {
  beforeEach(() => {
    process.env.WHATSAPP_COBRANCA_ALERTS_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.WHATSAPP_COBRANCA_ALERTS_ENABLED;
  });

  it('retorna [] sem chamar outbound quando flag está desativada', async () => {
    delete process.env.WHATSAPP_COBRANCA_ALERTS_ENABLED;
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 500, clientes: [{ nome: 'Ana', totalEmAtraso: 500, diasAtrasoMax: 3 }]
    });
    const sent = await service.sendCobrancaAlerts();
    expect(sent).toEqual([]);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
  });

  it('não envia quando não há inadimplentes', async () => {
    inadimplenciaService.getOverview.mockResolvedValue({ totalEmAtraso: 0, clientes: [] });
    const sent = await service.sendCobrancaAlerts();
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('envia mensagem tier1 para atraso de 1-6 dias', async () => {
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 300,
      clientes: [{ nome: 'Ana', totalEmAtraso: 300, diasAtrasoMax: 4 }]
    });
    await service.sendCobrancaAlerts();
    expect(outboundMessageService.sendText).toHaveBeenCalledWith(
      PROFILE.telefone,
      expect.stringContaining('📋'),
      expect.objectContaining({ source: 'cron' })
    );
  });

  it('envia mensagem tier2 para atraso de 7-14 dias', async () => {
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 600,
      clientes: [{ nome: 'Bruno', totalEmAtraso: 600, diasAtrasoMax: 10 }]
    });
    await service.sendCobrancaAlerts();
    expect(outboundMessageService.sendText).toHaveBeenCalledWith(
      PROFILE.telefone,
      expect.stringContaining('⚠️'),
      expect.anything()
    );
  });

  it('envia mensagens separadas por tier quando há clientes em múltiplos tiers', async () => {
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 900,
      clientes: [
        { nome: 'Ana', totalEmAtraso: 300, diasAtrasoMax: 3 },
        { nome: 'Bruno', totalEmAtraso: 600, diasAtrasoMax: 10 }
      ]
    });
    await service.sendCobrancaAlerts();
    expect(outboundMessageService.sendText).toHaveBeenCalledTimes(2);
  });

  it('não reenvia tier já enviado no dia', async () => {
    alreadySent.mockResolvedValue(true);
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 300,
      clientes: [{ nome: 'Ana', totalEmAtraso: 300, diasAtrasoMax: 4 }]
    });
    const sent = await service.sendCobrancaAlerts();
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

// ─── Flag guards: features já implementadas pelo Cursor ──────────────────────

describe('flag guards — alertas existentes', () => {
  it('#56 sendCriticalStockAlerts retorna [] quando flag está off', async () => {
    delete process.env.WHATSAPP_CRITICAL_STOCK_ALERTS_ENABLED;
    const sent = await service.sendCriticalStockAlerts();
    expect(sent).toEqual([]);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
  });

  it('#57 sendValidityAlerts retorna [] quando flag está off', async () => {
    delete process.env.WHATSAPP_VALIDITY_ALERTS_ENABLED;
    const sent = await service.sendValidityAlerts();
    expect(sent).toEqual([]);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
  });

  it('#58 sendPatientReturnAlerts retorna [] quando flag está off', async () => {
    delete process.env.WHATSAPP_PATIENT_RETURN_ALERTS_ENABLED;
    const sent = await service.sendPatientReturnAlerts();
    expect(sent).toEqual([]);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
  });

  it('#59 sendPatientReactivationAlerts retorna [] quando flag está off', async () => {
    delete process.env.WHATSAPP_PATIENT_REACTIVATION_ALERTS_ENABLED;
    const sent = await service.sendPatientReactivationAlerts();
    expect(sent).toEqual([]);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
  });

  it('#11 sendBillDueAlerts retorna [] quando flag está off', async () => {
    delete process.env.WHATSAPP_BILL_DUE_ALERTS_ENABLED;
    const sent = await service.sendBillDueAlerts();
    expect(sent).toEqual([]);
    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
  });
});

// ─── #82 goalReminderService — env var guard ─────────────────────────────────

describe('goalReminderService (#82) — env var guard', () => {
  let goalReminderService;
  let goalOutbound;
  let goalSupabase;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../src/db/supabase');
    jest.mock('../../src/services/outboundMessageService');
    jest.mock('../../src/controllers/transactionController');
    jest.mock('../../src/services/reminderSentHelper');
    goalSupabase = require('../../src/db/supabase');
    goalOutbound = require('../../src/services/outboundMessageService');
    const reminderHelper = require('../../src/services/reminderSentHelper');
    reminderHelper.alreadySent = jest.fn().mockResolvedValue(false);
    reminderHelper.markSent = jest.fn().mockResolvedValue(undefined);
    goalOutbound.sendText = jest.fn().mockResolvedValue({ success: true });

    goalSupabase.from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          not: jest.fn(() => ({
            not: jest.fn(() =>
              Promise.resolve({ data: [{ id: 'u1', telefone: '5511999990001', meta_mensal: '5000' }], error: null })
            )
          }))
        }))
      }))
    }));

    const transactionController = require('../../src/controllers/transactionController');
    transactionController.getMonthlyReport = jest.fn().mockResolvedValue({ entradas: 3200 });

    goalReminderService = require('../../src/services/goalReminderService');
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEEKLY_GOAL_ENABLED;
  });

  it('envia lembrete de meta quando goalReminderService.checkAndSendGoalReminders é chamado', async () => {
    process.env.WHATSAPP_WEEKLY_GOAL_ENABLED = 'true';
    await goalReminderService.checkAndSendGoalReminders();
    expect(goalOutbound.sendText).toHaveBeenCalled();
  });
});
