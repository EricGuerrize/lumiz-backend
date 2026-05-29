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
    graphApiVersion = process.env.WA_GRAPH_API_VERSION || 'v23.0'
  } = {}) {
    this.accessToken = accessToken;
    this.graphApiVersion = graphApiVersion;
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
