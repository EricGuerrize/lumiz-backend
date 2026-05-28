process.env.NODE_ENV = 'test';

describe('whatsappLatencyService', () => {
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    service = require('../../src/services/whatsappLatencyService');
    service.events = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registra evento sem expor telefone completo', () => {
    service.record({
      messageId: 'm1',
      phone: '5565999991234',
      event: 'messages.upsert',
      messageType: 'text',
      webhookAckMs: 2,
      processingMs: 100,
      sendMs: 50,
      totalMs: 160,
      responseChars: 20,
      status: 'ok'
    });

    const snapshot = service.snapshot();

    expect(snapshot.summary.totalEvents).toBe(1);
    expect(snapshot.recent[0].phoneSuffix).toBe('1234');
    expect(snapshot.recent[0]).not.toHaveProperty('phone');
    expect(snapshot.summary.avgTotalMs).toBe(160);
  });

  it('mantém no máximo 100 eventos recentes', () => {
    for (let index = 0; index < 105; index += 1) {
      service.record({
        messageId: `m${index}`,
        phone: '5565999991234',
        totalMs: index,
        status: 'ok'
      });
    }

    expect(service.snapshot().summary.totalEvents).toBe(100);
    expect(service.snapshot().recent[0].messageId).toBe('m104');
  });
});
