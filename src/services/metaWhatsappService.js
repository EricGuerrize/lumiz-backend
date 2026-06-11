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
   * Envia mensagem interativa com botões de resposta rápida pela Cloud API.
   * @param {string} phone
   * @param {string} body
   * @param {Array<{id: string, title: string}>} buttons
   * @returns {Promise<Object>}
   */
  async sendInteractiveButtons(phone, body, buttons = []) {
    if (!phone) {
      throw new Error('Telefone ausente para envio interativo via Meta');
    }

    if (!body || !String(body).trim()) {
      throw new Error('Corpo vazio para envio interativo via Meta');
    }

    if (!this.isOutboundConfigured()) {
      throw new Error('WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID não configurados para envio interativo via Meta');
    }

    const safeButtons = Array.isArray(buttons) ? buttons.slice(0, 3) : [];
    if (safeButtons.length === 0) {
      throw new Error('Botões ausentes para envio interativo via Meta');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: String(body)
        },
        action: {
          buttons: safeButtons.map((button) => ({
            type: 'reply',
            reply: {
              id: String(button.id || '').slice(0, 256),
              title: String(button.title || '').slice(0, 20)
            }
          }))
        }
      }
    };

    const response = await retryWithBackoff(
      () => withTimeout(
        this.client.post(`/${this.phoneNumberId}/messages`, payload),
        META_TIMEOUT_MS,
        'Timeout ao enviar botões via Meta'
      ),
      2,
      1000
    );

    return response.data;
  }

  /**
   * Envia mensagem interativa tipo lista (até 10 opções) pela Cloud API.
   * @param {string} phone
   * @param {string} body
   * @param {string} buttonLabel
   * @param {Array<{title: string, rows: Array<{id: string, title: string, description?: string}>}>} sections
   * @returns {Promise<Object>}
   */
  async sendInteractiveList(phone, body, buttonLabel = 'Ver opções', sections = []) {
    if (!phone) {
      throw new Error('Telefone ausente para envio de lista via Meta');
    }

    if (!body || !String(body).trim()) {
      throw new Error('Corpo vazio para envio de lista via Meta');
    }

    if (!this.isOutboundConfigured()) {
      throw new Error('WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID não configurados para envio de lista via Meta');
    }

    const safeSections = (Array.isArray(sections) ? sections : []).slice(0, 1).map((section) => ({
      title: String(section.title || 'Opções').slice(0, 24),
      rows: (Array.isArray(section.rows) ? section.rows : []).slice(0, 10).map((row) => ({
        id: String(row.id || '').slice(0, 200),
        title: String(row.title || '').slice(0, 24),
        ...(row.description ? { description: String(row.description).slice(0, 72) } : {})
      }))
    }));

    if (!safeSections[0]?.rows?.length) {
      throw new Error('Linhas ausentes para envio de lista via Meta');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: String(body) },
        action: {
          button: String(buttonLabel || 'Ver opções').slice(0, 20),
          sections: safeSections
        }
      }
    };

    const response = await retryWithBackoff(
      () => withTimeout(
        this.client.post(`/${this.phoneNumberId}/messages`, payload),
        META_TIMEOUT_MS,
        'Timeout ao enviar lista via Meta'
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
   * Envia documento por buffer pela Cloud API oficial da Meta.
   * A Cloud API exige upload prévio da mídia e depois envio pelo media id.
   * @param {string} phone
   * @param {Buffer} buffer
   * @param {string} fileName
   * @param {string} mimeType
   * @returns {Promise<Object>}
   */
  async sendDocumentBuffer(phone, buffer, fileName = 'documento.pdf', mimeType = 'application/pdf') {
    if (!phone) {
      throw new Error('Telefone ausente para envio de documento via Meta');
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Buffer ausente para envio de documento via Meta');
    }

    if (!this.isOutboundConfigured()) {
      throw new Error('WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID não configurados para envio de documento via Meta');
    }

    const mediaId = await this.uploadMedia(buffer, fileName, mimeType);
    return this.sendDocumentByMediaId(phone, mediaId, fileName);
  }

  /**
   * Faz upload de mídia para a Cloud API e retorna o media id.
   * @param {Buffer} buffer
   * @param {string} fileName
   * @param {string} mimeType
   * @returns {Promise<string>}
   */
  async uploadMedia(buffer, fileName = 'documento.pdf', mimeType = 'application/pdf') {
    if (!this.isOutboundConfigured()) {
      throw new Error('WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID não configurados para upload de mídia via Meta');
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);

    const response = await retryWithBackoff(
      () => withTimeout(
        this.client.post(`/${this.phoneNumberId}/media`, form, {
          headers: {
            ...form.getHeaders?.()
          }
        }),
        META_TIMEOUT_MS,
        'Timeout ao subir mídia via Meta'
      ),
      2,
      1000
    );

    const mediaId = response.data?.id;
    if (!mediaId) {
      throw new Error('Meta não retornou media id no upload');
    }

    return mediaId;
  }

  /**
   * Envia documento já carregado na Meta pelo media id.
   * @param {string} phone
   * @param {string} mediaId
   * @param {string} fileName
   * @returns {Promise<Object>}
   */
  async sendDocumentByMediaId(phone, mediaId, fileName = 'documento.pdf') {
    if (!phone) {
      throw new Error('Telefone ausente para envio de documento via Meta');
    }

    if (!mediaId) {
      throw new Error('Media id ausente para envio de documento via Meta');
    }

    if (!this.isOutboundConfigured()) {
      throw new Error('WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID não configurados para envio de documento via Meta');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'document',
      document: {
        id: mediaId,
        filename: fileName
      }
    };

    const response = await retryWithBackoff(
      () => withTimeout(
        this.client.post(`/${this.phoneNumberId}/messages`, payload),
        META_TIMEOUT_MS,
        'Timeout ao enviar documento via Meta'
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
