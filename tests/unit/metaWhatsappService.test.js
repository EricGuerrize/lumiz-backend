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
});
