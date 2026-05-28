process.env.NODE_ENV = 'test';
process.env.WHATSAPP_OUTBOUND_QUEUE_ENABLED = 'false';

describe('outboundMessageService', () => {
  let OutboundMessageService;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    ({ OutboundMessageService } = require('../../src/services/outboundMessageService'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('envia texto pela Evolution quando API responde', async () => {
    const evolution = { sendMessage: jest.fn().mockResolvedValue({ success: true }) };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      reliability,
      queueEnabled: false
    });

    const result = await service.sendText('5565999991234', 'oi', { messageId: 'msg-1' });

    expect(result.status).toBe('sent');
    expect(evolution.sendMessage).toHaveBeenCalledWith('5565999991234', 'oi');
    expect(reliability.recordFailure).not.toHaveBeenCalled();
  });

  it('registra falha e relança quando não há fila de reenvio', async () => {
    const error = new Error('Evolution down');
    const evolution = { sendMessage: jest.fn().mockRejectedValue(error) };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      reliability,
      queueEnabled: false
    });

    await expect(
      service.sendText('5565999991234', 'oi', { messageId: 'msg-2' })
    ).rejects.toThrow('Evolution down');

    expect(reliability.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_send_failed',
        phase: 'send',
        phone: '5565999991234',
        messageId: 'msg-2',
        queued: false
      })
    );
  });

  it('retorna queued quando consegue enfileirar após falha no envio', async () => {
    const evolution = { sendMessage: jest.fn().mockRejectedValue(new Error('timeout')) };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      reliability,
      queueEnabled: false
    });
    service.enqueueText = jest.fn().mockResolvedValue(true);

    const result = await service.sendText('5565999991234', 'oi', { messageId: 'msg-3' });

    expect(result.status).toBe('queued');
    expect(service.enqueueText).toHaveBeenCalled();
    expect(reliability.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_send_queued',
        queued: true
      })
    );
  });
});
