process.env.NODE_ENV = 'test';
process.env.WHATSAPP_OUTBOUND_QUEUE_ENABLED = 'false';

jest.mock('../../src/services/analyticsService', () => ({
  track: jest.fn().mockResolvedValue(true)
}));

describe('messageReliabilityService', () => {
  let service;
  let analyticsService;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    analyticsService = require('../../src/services/analyticsService');
    service = require('../../src/services/messageReliabilityService');
    service.failures = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registra falha sem expor telefone completo', () => {
    service.recordFailure({
      kind: 'empty_bot_response',
      phase: 'process',
      phone: '5565999991234',
      messageId: 'msg-1',
      reason: 'empty_response'
    });

    const snapshot = service.snapshot();

    expect(snapshot.summary.totalFailures).toBe(1);
    expect(snapshot.summary.byKind.empty_bot_response).toBe(1);
    expect(snapshot.recent[0].phoneSuffix).toBe('1234');
    expect(snapshot.recent[0]).not.toHaveProperty('phone');
    expect(analyticsService.track).toHaveBeenCalledWith(
      'whatsapp_message_failure',
      expect.objectContaining({
        phone: '5565999991234',
        source: 'whatsapp_webhook'
      })
    );
  });

  it('mantém no máximo 100 falhas recentes', () => {
    for (let index = 0; index < 105; index += 1) {
      service.recordFailure({
        kind: 'outbound_send_failed',
        phase: 'send',
        phone: '5565999991234',
        messageId: `msg-${index}`
      });
    }

    expect(service.snapshot().summary.totalFailures).toBe(100);
    expect(service.snapshot().recent[0].messageId).toBe('msg-104');
  });
});
