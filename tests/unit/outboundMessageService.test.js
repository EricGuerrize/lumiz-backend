process.env.NODE_ENV = 'test';
process.env.WHATSAPP_OUTBOUND_QUEUE_ENABLED = 'false';
process.env.EVOLUTION_FALLBACK_ENABLED = 'false';

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
      queueEnabled: false,
      evolutionFallbackEnabled: true
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

  it('não usa Evolution por padrão quando a Meta falha', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const evolution = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendMessage: jest.fn().mockResolvedValue({ success: true })
    };
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

    await expect(
      service.sendText('5565999991234', 'oi', { messageId: 'msg-no-evolution' })
    ).rejects.toThrow('meta timeout');

    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(reliability.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_send_failed',
        messageId: 'msg-no-evolution',
        queued: false
      })
    );
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
      queueEnabled: false,
      evolutionFallbackEnabled: true
    });

    const result = await service.sendText('5565999991234', 'oi', { messageId: 'msg-meta-2' });

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('evolution');
    expect(meta.sendText).toHaveBeenCalledWith('5565999991234', 'oi');
    expect(evolution.sendMessage).toHaveBeenCalledWith('5565999991234', 'oi');
    expect(reliability.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_provider_failed',
        reason: expect.stringContaining('meta_text_failed')
      })
    );
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
      queueEnabled: false,
      evolutionFallbackEnabled: true
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
      queueEnabled: false,
      evolutionFallbackEnabled: true
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

  it('envia documento pela Meta quando outbound oficial está configurado', async () => {
    const evolution = { sendDocument: jest.fn().mockResolvedValue({ success: true }) };
    const meta = {
      isOutboundConfigured: jest.fn().mockReturnValue(true),
      sendDocumentBuffer: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.doc' }] })
    };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
      reliability,
      queueEnabled: false,
      evolutionFallbackEnabled: true
    });

    const buffer = Buffer.from('pdf');
    const result = await service.sendDocument('5565999991234', buffer, 'relatorio.pdf', 'application/pdf', { messageId: 'doc-1' });

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('meta');
    expect(meta.sendDocumentBuffer).toHaveBeenCalledWith('5565999991234', buffer, 'relatorio.pdf', 'application/pdf');
    expect(evolution.sendDocument).not.toHaveBeenCalled();
  });

  it('cai para Evolution ao enviar documento quando Meta falha', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const evolution = { sendDocument: jest.fn().mockResolvedValue({ success: true }) };
    const meta = {
      isOutboundConfigured: jest.fn().mockReturnValue(true),
      sendDocumentBuffer: jest.fn().mockRejectedValue(new Error('meta media down'))
    };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
      reliability,
      queueEnabled: false,
      evolutionFallbackEnabled: true
    });

    const buffer = Buffer.from('pdf');
    const result = await service.sendDocument('5565999991234', buffer, 'relatorio.pdf', 'application/pdf', { messageId: 'doc-fallback-1' });

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('evolution');
    expect(evolution.sendDocument).toHaveBeenCalledWith('5565999991234', buffer.toString('base64'), 'relatorio.pdf', 'application/pdf');
    expect(reliability.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_provider_failed',
        messageId: 'doc-fallback-1',
        reason: expect.stringContaining('meta_document_failed')
      })
    );
  });

  it('envia botões interativos pela Meta quando disponível', async () => {
    const evolution = { sendMessage: jest.fn().mockResolvedValue({ success: true }) };
    const meta = {
      isOutboundConfigured: jest.fn().mockReturnValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.buttons' }] })
    };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
      reliability,
      queueEnabled: false,
      evolutionFallbackEnabled: true
    });

    const buttons = [{ id: 'doc_confirm', title: 'Confirmar' }];
    const result = await service.sendInteractiveButtons('5565999991234', 'confirma?', buttons, 'responda sim');

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('meta');
    expect(meta.sendInteractiveButtons).toHaveBeenCalledWith('5565999991234', 'confirma?', buttons);
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });

  it('usa fallback textual quando botões interativos falham', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const evolution = { sendMessage: jest.fn().mockResolvedValue({ success: true }) };
    const meta = {
      isOutboundConfigured: jest.fn().mockReturnValue(true),
      sendInteractiveButtons: jest.fn().mockRejectedValue(new Error('interactive unsupported'))
    };
    const reliability = { recordFailure: jest.fn() };
    const service = new OutboundMessageService({
      evolution,
      meta,
      reliability,
      queueEnabled: false,
      evolutionFallbackEnabled: true
    });

    const result = await service.sendInteractiveButtons(
      '5565999991234',
      'confirma?',
      [{ id: 'doc_confirm', title: 'Confirmar' }],
      'responda sim',
      { messageId: 'interactive-1' }
    );

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('evolution');
    expect(evolution.sendMessage).toHaveBeenCalledWith('5565999991234', 'responda sim');
    expect(reliability.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'outbound_interactive_failed',
        messageId: 'interactive-1'
      })
    );
  });
});
