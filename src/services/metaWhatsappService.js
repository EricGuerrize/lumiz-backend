/**
 * Fase 17 — WhatsApp Oficial (Meta Cloud API).
 * Baixa mídias recebidas no webhook nativo da Meta usando `media_id`.
 */

const axios = require('axios');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');

const META_TIMEOUT_MS = Number(process.env.WA_META_TIMEOUT_MS || 30000);

class MetaWhatsappService {
  constructor({
    accessToken = process.env.WA_ACCESS_TOKEN,
    graphApiVersion = process.env.WA_GRAPH_API_VERSION || 'v23.0',
    phoneNumberId = process.env.WA_PHONE_NUMBER_ID
  } = {}) {
    this.accessToken = accessToken;
    this.graphApiVersion = graphApiVersion;
    this.phoneNumberId = phoneNumberId;
    this.baseUrl = `https://graph.facebook.com/${graphApiVersion}`;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    });
  }

  /**
   * Indica se o serviço pode baixar mídia da Meta.
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.accessToken);
  }

  /**
   * Indica se o serviço pode enviar mensagens via Cloud API.
   * @returns {boolean}
   */
  isOutboundConfigured() {
    return Boolean(this.accessToken && this.phoneNumberId);
  }

  /**
   * Envia texto simples pela Cloud API oficial da Meta.
   * @param {string} phone
   * @param {string} message
   * @returns {Promise<Object>}
   */
  async sendText(phone, message) {
    if (!phone) {
      throw new Error('Telefone ausente para envio via Meta');
    }

    if (!message || !String(message).trim()) {
      throw new Error('Mensagem vazia para envio via Meta');
    }

    if (!this.isOutboundConfigured()) {
      throw new Error('WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID não configurados para envio via Meta');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: {
        body: String(message)
      }
    };

    const response = await retryWithBackoff(
      () => withTimeout(
        this.client.post(`/${this.phoneNumberId}/messages`, payload),
        META_TIMEOUT_MS,
        'Timeout ao enviar mensagem via Meta'
      ),
      2,
      1000
    );

    return response.data;
  }

  /**
   * Envia vídeo por link público pela Cloud API oficial da Meta.
   * @param {string} phone
   * @param {string} videoUrl
   * @param {string} [caption]
   * @returns {Promise<Object>}
   */
  async sendVideo(phone, videoUrl, caption = '') {
    if (!phone) {
      throw new Error('Telefone ausente para envio de vídeo via Meta');
    }

    if (!videoUrl || !String(videoUrl).trim()) {
      throw new Error('URL do vídeo ausente para envio via Meta');
    }

    if (!this.isOutboundConfigured()) {
      throw new Error('WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID não configurados para envio de vídeo via Meta');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'video',
      video: {
        link: String(videoUrl).trim()
      }
    };

    if (caption && String(caption).trim()) {
      payload.video.caption = String(caption);
    }

    const response = await retryWithBackoff(
      () => withTimeout(
        this.client.post(`/${this.phoneNumberId}/messages`, payload),
        META_TIMEOUT_MS,
        'Timeout ao enviar vídeo via Meta'
      ),
      2,
      1000
    );

    return response.data;
  }

  /**
   * Baixa mídia da Cloud API a partir do media_id recebido no webhook.
   * Fluxo Meta: GET /{media-id} -> URL temporária -> GET URL com Bearer token.
   * @param {string} mediaId
   * @returns {Promise<{data: Buffer, contentType: string, status: number, mediaId: string}>}
   */
  async downloadMedia(mediaId) {
    if (!mediaId) {
      throw new Error('Meta media_id ausente');
    }

    if (!this.isConfigured()) {
      throw new Error('WA_ACCESS_TOKEN não configurado para baixar mídia da Meta');
    }

    const metadataResponse = await retryWithBackoff(
      () => withTimeout(
        this.client.get(`/${mediaId}`),
        META_TIMEOUT_MS,
        'Timeout ao buscar metadata de mídia Meta'
      ),
      2,
      1000
    );

    const mediaUrl = metadataResponse.data?.url;
    if (!mediaUrl) {
      throw new Error('Meta não retornou URL para a mídia');
    }

    const mediaResponse = await retryWithBackoff(
      () => withTimeout(
        axios.get(mediaUrl, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          responseType: 'arraybuffer'
        }),
        META_TIMEOUT_MS,
        'Timeout ao baixar arquivo de mídia Meta'
      ),
      2,
      1000
    );

    return {
      data: Buffer.from(mediaResponse.data),
      contentType:
        metadataResponse.data?.mime_type ||
        mediaResponse.headers?.['content-type'] ||
        'application/octet-stream',
      status: mediaResponse.status,
      mediaId
    };
  }
}

module.exports = new MetaWhatsappService();
module.exports.MetaWhatsappService = MetaWhatsappService;
