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
    const meta = { isOutboundConfigured: jest.fn().mockReturnValue(false) };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
      reliability,
      queueEnabled: false
    });

    const result = await service.sendText('5565999991234', 'oi', { messageId: 'msg-1' });

    expect(result.status).toBe('sent');
    expect(evolution.sendMessage).toHaveBeenCalledWith('5565999991234', 'oi');
    expect(reliability.recordFailure).not.toHaveBeenCalled();
  });

  it('prioriza Meta Cloud API quando outbound oficial está configurado', async () => {
    const evolution = { sendMessage: jest.fn().mockResolvedValue({ success: true }) };
    const meta = {
      isOutboundConfigured: jest.fn().mockReturnValue(true),
      sendText: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid-1' }] })
    };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
      reliability,
      queueEnabled: false
    });

    const result = await service.sendText('5565999991234', 'oi', { messageId: 'msg-meta-1' });

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('meta');
    expect(meta.sendText).toHaveBeenCalledWith('5565999991234', 'oi');
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });

  it('cai para Evolution quando a Meta falha temporariamente', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const evolution = { sendMessage: jest.fn().mockResolvedValue({ success: true }) };
    const meta = {
      isOutboundConfigured: jest.fn().mockReturnValue(true),
      sendText: jest.fn().mockRejectedValue(new Error('meta timeout'))
    };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
      reliability,
      queueEnabled: false
    });

    const result = await service.sendText('5565999991234', 'oi', { messageId: 'msg-meta-2' });

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('evolution');
    expect(meta.sendText).toHaveBeenCalledWith('5565999991234', 'oi');
    expect(evolution.sendMessage).toHaveBeenCalledWith('5565999991234', 'oi');
  });

  it('registra falha e relança quando não há fila de reenvio', async () => {
    const error = new Error('Evolution down');
    const evolution = { sendMessage: jest.fn().mockRejectedValue(error) };
    const meta = { isOutboundConfigured: jest.fn().mockReturnValue(false) };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
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
    const meta = { isOutboundConfigured: jest.fn().mockReturnValue(false) };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
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
