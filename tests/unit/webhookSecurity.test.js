const crypto = require('crypto');

process.env.REDIS_CACHE_ENABLED = 'false';
process.env.REDIS_QUEUE_ENABLED = 'false';
process.env.WHATSAPP_OUTBOUND_QUEUE_ENABLED = 'false';

jest.mock('../../src/controllers/messageController', () => ({
  handleIncomingMessage: jest.fn().mockResolvedValue('ok'),
  handleImageMessageWithBuffer: jest.fn().mockResolvedValue('ok'),
  handleDocumentMessageWithBuffer: jest.fn().mockResolvedValue('ok')
}));

jest.mock('../../src/services/audioTranscriptionService', () => ({
  isEnabled: jest.fn(() => false),
  transcribeAudio: jest.fn()
}));

jest.mock('../../src/services/evolutionService', () => ({
  validatePhoneNumber: jest.fn(() => true),
  sendPresenceUpdate: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/outboundMessageService', () => ({
  sendText: jest.fn().mockResolvedValue({ status: 'sent' }),
  sendInteractiveButtons: jest.fn().mockResolvedValue({ status: 'sent', provider: 'meta' })
}));

jest.mock('../../src/services/messageReliabilityService', () => ({
  recordFailure: jest.fn()
}));

jest.mock('../../src/services/whatsappLatencyService', () => ({
  record: jest.fn()
}));

jest.mock('../../src/middleware/userRateLimit', () => ({
  phoneRateLimitMiddleware: () => (_req, _res, next) => next()
}));

jest.mock('../../src/services/metaWhatsappService', () => ({
  downloadMedia: jest.fn()
}));

function loadHelpers() {
  jest.resetModules();
  return require('../../src/routes/webhook')._test;
}

function evolutionReq(headers = {}) {
  return {
    headers,
    body: {
      event: 'messages.upsert',
      data: {
        key: { id: 'msg-1', remoteJid: '556592997732@s.whatsapp.net', fromMe: false },
        message: { conversation: 'oi' }
      }
    }
  };
}

function metaPayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'wamid-1', from: '556592997732', type: 'text', text: { body: 'oi' } }] } }] }]
  };
}

describe('Webhook security helpers', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  test('rejeita Evolution sem segredo quando EVOLUTION_WEBHOOK_SECRET está configurado', () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = 'segredo-evolution';
    const { validateInboundWebhook } = loadHelpers();

    expect(validateInboundWebhook(evolutionReq())).toMatchObject({
      ok: false,
      reason: 'missing_evolution_webhook_secret'
    });
  });

  test('aceita Evolution com segredo correto', () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = 'segredo-evolution';
    const { validateInboundWebhook } = loadHelpers();

    expect(validateInboundWebhook(evolutionReq({ 'x-webhook-secret': 'segredo-evolution' }))).toMatchObject({ ok: true });
  });

  test('rejeita Meta Cloud API com assinatura inválida', () => {
    process.env.META_APP_SECRET = 'meta-secret';
    const { validateInboundWebhook } = loadHelpers();

    const body = metaPayload();
    const req = {
      headers: { 'x-hub-signature-256': 'sha256=invalid' },
      body,
      rawBody: Buffer.from(JSON.stringify(body))
    };

    expect(validateInboundWebhook(req)).toMatchObject({
      ok: false,
      reason: 'invalid_meta_signature'
    });
  });

  test('aceita Meta Cloud API com assinatura correta', () => {
    process.env.META_APP_SECRET = 'meta-secret';
    const { validateInboundWebhook } = loadHelpers();

    const body = metaPayload();
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${crypto.createHmac('sha256', 'meta-secret').update(rawBody).digest('hex')}`;
    const req = { headers: { 'x-hub-signature-256': signature }, body, rawBody };

    expect(validateInboundWebhook(req)).toMatchObject({ ok: true });
  });

  test('normaliza resposta de botão interativo da Meta para confirmação de documento', () => {
    const { normalizeMetaWebhookBody } = loadHelpers();

    const normalized = normalizeMetaWebhookBody({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            messages: [{
              id: 'wamid-button-1',
              from: '556592997732',
              type: 'interactive',
              interactive: {
                button_reply: {
                  id: 'doc_confirm',
                  title: 'Confirmar'
                }
              }
            }]
          }
        }]
      }]
    });

    expect(normalized).toMatchObject({
      ok: true,
      reason: 'meta_cloud_api',
      data: {
        message: {
          conversation: 'sim',
          interactiveMessage: {
            buttonId: 'doc_confirm',
            title: 'Confirmar'
          }
        }
      }
    });
  });

  test('detecta confirmações de mídia do onboarding como elegíveis para botões', () => {
    const documentCopy = require('../../src/copy/documentWhatsappCopy');

    expect(documentCopy.isDocumentConfirmationPrompt(
      '💸 *CUSTO*\n\nTipo: Variável\nCategoria: Insumos\nValor: R$ 450,00\nData: 2026-06-01\n\nTá certo? Me diz se quiser ajustar alguma coisa.'
    )).toBe(true);

    expect(documentCopy.isDocumentConfirmationPrompt(
      'Custo de teste identificado:\n*Nota fiscal de insumos* — R$ 450,00.\n\nConfirma? Se não for isso, me manda a correção.'
    )).toBe(true);
  });
});
