process.env.NODE_ENV = 'test';

jest.mock('../../src/db/supabase', () => ({
  from: jest.fn()
}));

jest.mock('../../src/services/outboundMessageService', () => ({
  sendText: jest.fn()
}));

jest.mock('../../src/services/nfValidadeService', () => ({
  listarProximos: jest.fn()
}));

jest.mock('../../src/services/inadimplenciaService', () => ({
  getOverview: jest.fn()
}));

jest.mock('../../src/services/reminderSentHelper', () => ({
  alreadySent: jest.fn(),
  markSent: jest.fn()
}));

jest.mock('../../src/controllers/messages/queryHandler', () => jest.fn().mockImplementation(() => ({
  handleDailyBriefing: jest.fn()
})));

const supabase = require('../../src/db/supabase');
const outboundMessageService = require('../../src/services/outboundMessageService');
const inadimplenciaService = require('../../src/services/inadimplenciaService');
const { alreadySent, markSent } = require('../../src/services/reminderSentHelper');
const service = require('../../src/services/whatsappOperationalAlertService');

function mockProfiles(rows) {
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockResolvedValue({ data: rows, error: null })
  });
}

describe('whatsappOperationalAlertService inadimplência', () => {
  beforeEach(() => {
    process.env.WHATSAPP_INADIMPLENCIA_ALERTS_ENABLED = 'true';
    jest.clearAllMocks();
    mockProfiles([{ id: 'user-1', telefone: '556599999999' }]);
    alreadySent.mockResolvedValue(false);
    markSent.mockResolvedValue(undefined);
    outboundMessageService.sendText.mockResolvedValue({ success: true });
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 500,
      totalParcelas: 1,
      clientes: [{ nome: 'Ana', totalEmAtraso: 500, diasAtrasoMax: 5 }]
    });
  });

  afterEach(() => {
    delete process.env.WHATSAPP_INADIMPLENCIA_ALERTS_ENABLED;
  });

  it('envia alerta para perfil opt-in com parcelas vencidas', async () => {
    const sent = await service.sendInadimplenciaAlerts();

    expect(outboundMessageService.sendText).toHaveBeenCalledWith(
      '556599999999',
      expect.stringContaining('Alerta de inadimplência'),
      expect.objectContaining({ messageType: 'inadimplencia_alert', source: 'cron' })
    );
    expect(markSent).toHaveBeenCalledWith('user-1', 'user-1', expect.stringMatching(/^inadimplencia_/));
    expect(sent).toHaveLength(1);
  });

  it('não envia quando não há vencidos', async () => {
    inadimplenciaService.getOverview.mockResolvedValue({
      totalEmAtraso: 0,
      totalParcelas: 0,
      clientes: []
    });

    const sent = await service.sendInadimplenciaAlerts();

    expect(outboundMessageService.sendText).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
