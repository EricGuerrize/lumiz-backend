process.env.NODE_ENV = 'test';

jest.mock('axios', () => {
  const post = jest.fn();
  const get = jest.fn();
  return {
    create: jest.fn(() => ({ get, post })),
    get: jest.fn(),
    post,
    __clientGet: get
  };
});

describe('metaWhatsappService', () => {
  let axios;
  let MetaWhatsappService;

  beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    ({ MetaWhatsappService } = require('../../src/services/metaWhatsappService'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('baixa mídia usando metadata URL e bearer token', async () => {
    const service = new MetaWhatsappService({
      accessToken: 'token-meta',
      graphApiVersion: 'v23.0'
    });

    axios.__clientGet.mockResolvedValueOnce({
      data: {
        url: 'https://lookaside.fbsbx.com/whatsapp/media',
        mime_type: 'image/jpeg'
      }
    });
    axios.get.mockResolvedValueOnce({
      data: Buffer.from('fake-image'),
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    });

    const result = await service.downloadMedia('media-123');

    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://graph.facebook.com/v23.0',
      headers: { Authorization: 'Bearer token-meta' }
    }));
    expect(axios.__clientGet).toHaveBeenCalledWith('/media-123');
    expect(axios.get).toHaveBeenCalledWith(
      'https://lookaside.fbsbx.com/whatsapp/media',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-meta' },
        responseType: 'arraybuffer'
      })
    );
    expect(result.contentType).toBe('image/jpeg');
    expect(result.data).toBeInstanceOf(Buffer);
  });

  it('falha claramente sem WA_ACCESS_TOKEN', async () => {
    const service = new MetaWhatsappService({ accessToken: '' });

    await expect(service.downloadMedia('media-123')).rejects.toThrow('WA_ACCESS_TOKEN');
  });

  it('envia vídeo por link usando payload da Cloud API', async () => {
    const service = new MetaWhatsappService({
      accessToken: 'token-meta',
      graphApiVersion: 'v23.0',
      phoneNumberId: 'phone-123'
    });

    axios.post.mockResolvedValueOnce({
      data: { messages: [{ id: 'wamid.video' }] }
    });

    const result = await service.sendVideo(
      '556592997732',
      'https://cdn.example.com/teaser.mp4',
      'Veja o dashboard'
    );

    expect(axios.post).toHaveBeenCalledWith('/phone-123/messages', {
      messaging_product: 'whatsapp',
      to: '556592997732',
      type: 'video',
      video: {
        link: 'https://cdn.example.com/teaser.mp4',
        caption: 'Veja o dashboard'
      }
    });
    expect(result.messages[0].id).toBe('wamid.video');
  });

  it('envia documento por buffer com upload de mídia e envio pelo media id', async () => {
    const service = new MetaWhatsappService({
      accessToken: 'token-meta',
      graphApiVersion: 'v23.0',
      phoneNumberId: 'phone-123'
    });

    axios.post
      .mockResolvedValueOnce({ data: { id: 'media-123' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.doc' }] } });

    const result = await service.sendDocumentBuffer(
      '556592997732',
      Buffer.from('%PDF fake'),
      'Relatorio_maio_2026.pdf',
      'application/pdf'
    );

    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      '/phone-123/media',
      expect.any(FormData),
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(axios.post).toHaveBeenNthCalledWith(2, '/phone-123/messages', {
      messaging_product: 'whatsapp',
      to: '556592997732',
      type: 'document',
      document: {
        id: 'media-123',
        filename: 'Relatorio_maio_2026.pdf'
      }
    });
    expect(result.messages[0].id).toBe('wamid.doc');
  });

  it('envia botões interativos usando payload da Cloud API', async () => {
    const service = new MetaWhatsappService({
      accessToken: 'token-meta',
      graphApiVersion: 'v23.0',
      phoneNumberId: 'phone-123'
    });

    axios.post.mockResolvedValueOnce({
      data: { messages: [{ id: 'wamid.buttons' }] }
    });

    const result = await service.sendInteractiveButtons(
      '556592997732',
      'Confira o comprovante antes de registrar.',
      [
        { id: 'doc_confirm', title: 'Confirmar' },
        { id: 'doc_correct', title: 'Corrigir' },
        { id: 'doc_cancel', title: 'Cancelar' }
      ]
    );

    expect(axios.post).toHaveBeenCalledWith('/phone-123/messages', {
      messaging_product: 'whatsapp',
      to: '556592997732',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: 'Confira o comprovante antes de registrar.'
        },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'doc_confirm', title: 'Confirmar' } },
            { type: 'reply', reply: { id: 'doc_correct', title: 'Corrigir' } },
            { type: 'reply', reply: { id: 'doc_cancel', title: 'Cancelar' } }
          ]
        }
      }
    });
    expect(result.messages[0].id).toBe('wamid.buttons');
  });
});
