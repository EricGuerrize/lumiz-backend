const axios = require('axios');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
require('dotenv').config();

// Timeout para chamadas da Evolution API (10 segundos)
const EVOLUTION_TIMEOUT_MS = 10000;

class EvolutionService {
  constructor() {
    this.baseUrl = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;
    this.instanceName = process.env.EVOLUTION_INSTANCE_NAME;

    if (!this.baseUrl || !this.apiKey || !this.instanceName) {
      console.error('[EVOLUTION] Configuração incompleta. Verifique o arquivo .env');
    }

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'apikey': this.apiKey,
        'Content-Type': 'application/json'
      }
    });
  }

  async downloadMedia(messageKey, mediaType = 'image') {
    try {
      // Evolution API pode usar diferentes endpoints
      // Tenta primeiro o endpoint mais comum
      let url = `${this.baseUrl}/chat/fetchMediaFromMessage/${this.instanceName}`;

      // Prepara payload - Evolution API pode esperar diferentes formatos
      let payload = {
        messageKey: messageKey
      };

      // Timeout maior para download de mídia (30 segundos)
      let response;
      try {
        response = await retryWithBackoff(
          () => withTimeout(
            this.axiosInstance.post(url, payload, {
              headers: {
                'apikey': this.apiKey,
                'Content-Type': 'application/json'
              },
              responseType: 'arraybuffer'
            }),
            30000, // 30 segundos para download
            'Timeout ao baixar mídia via Evolution API (30s)'
          ),
          2,
          1000
        );
      } catch (firstError) {
        // Se falhar, tenta endpoint alternativo
        console.log('[EVOLUTION] Tentando endpoint alternativo...');
        url = `${this.baseUrl}/media/download/${this.instanceName}`;

        // Tenta com GET usando messageKey como query param
        try {
          response = await retryWithBackoff(
            () => withTimeout(
              this.axiosInstance.get(url, {
                headers: {
                  'apikey': this.apiKey
                },
                params: {
                  messageKey: JSON.stringify(messageKey)
                },
                responseType: 'arraybuffer'
              }),
              30000,
              'Timeout ao baixar mídia via Evolution API (30s)'
            ),
            1, // Apenas 1 tentativa no fallback
            500
          );
        } catch (secondError) {
          console.error('[EVOLUTION] Ambos endpoints falharam');
          throw firstError; // Lança o primeiro erro
        }
      }

      return {
        data: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'image/jpeg',
        status: response.status
      };
    } catch (error) {
      console.error('[EVOLUTION] Erro ao baixar mídia:', error.response?.status, error.response?.statusText || error.message);

      // Fallback: tenta usar a URL direta se disponível
      if (error.response?.status === 404 || error.message.includes('not found')) {
        console.log('[EVOLUTION] Tentando fallback via getBase64FromMediaMessage...');
        try {
          // 1. Busca a mensagem completa para ter os dados necessários
          const messageData = await this.findMessage(messageKey);

          if (messageData) {
            // 2. Busca o base64 usando a mensagem completa
            const base64Data = await this.getBase64FromMediaMessage(messageData);

            if (base64Data) {
              console.log('[EVOLUTION] ✅ Fallback recuperou mídia com sucesso');
              return {
                data: Buffer.from(base64Data, 'base64'),
                contentType: mediaType === 'image' ? 'image/jpeg' : 'application/pdf', // Assumindo tipos comuns
                status: 200
              };
            }
          }
        } catch (fallbackError) {
          console.error('[EVOLUTION] Fallback também falhou:', fallbackError.message);
        }

        throw new Error('Mídia não encontrada. Pode ter expirado ou sido removida.');
      }

      throw error;
    }
  }

  async findMessage(messageKey) {
    try {
      const url = `${this.baseUrl}/chat/findMessages/${this.instanceName}`;
      const payload = {
        where: {
          key: {
            id: messageKey.id,
            remoteJid: messageKey.remoteJid
          }
        }
      };

      const response = await this.axiosInstance.post(url, payload, {
        headers: {
          'apikey': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (response.data?.messages?.records?.length > 0) {
        return response.data.messages.records[0];
      }
      return null;
    } catch (error) {
      console.error('[EVOLUTION] Erro ao buscar mensagem:', error.message);
      return null;
    }
  }

  async getBase64FromMediaMessage(messageData) {
    try {
      const url = `${this.baseUrl}/chat/getBase64FromMediaMessage/${this.instanceName}`;
      const payload = {
        message: messageData,
        convertToMp4: false
      };

      const response = await this.axiosInstance.post(url, payload, {
        headers: {
          'apikey': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data?.base64;
    } catch (error) {
      console.error('[EVOLUTION] Erro ao buscar base64:', error.message);
      return null;
    }
  }

  async sendMessage(phone, message) {
    try {
      const url = `${this.baseUrl}/message/sendText/${this.instanceName}`;

      const payload = {
        number: phone,
        text: message
      };

      // Adiciona retry com timeout
      const response = await retryWithBackoff(
        () => withTimeout(
          this.axiosInstance.post(url, payload, {
            headers: {
              'apikey': this.apiKey,
              'Content-Type': 'application/json'
            }
          }),
          EVOLUTION_TIMEOUT_MS,
          'Timeout ao enviar mensagem via Evolution API (10s)'
        ),
        2, // 2 tentativas (não queremos spam)
        500 // delay inicial de 500ms
      );

      return response.data;
    } catch (error) {
      console.error('[EVOLUTION] Erro ao enviar mensagem:', error.response?.data || error.message);
      if (error.message.includes('Timeout')) {
        console.error('[EVOLUTION] Timeout excedido ao enviar mensagem');
      }
      throw error;
    }
  }

  async getInstanceStatus() {
    try {
      const url = `${this.baseUrl}/instance/connectionState/${this.instanceName}`;

      const response = await retryWithBackoff(
        () => withTimeout(
          this.axiosInstance.get(url, {
            headers: {
              'apikey': this.apiKey
            }
          }),
          EVOLUTION_TIMEOUT_MS,
          'Timeout ao verificar status da Evolution API (10s)'
        ),
        2,
        500
      );

      return response.data;
    } catch (error) {
      console.error('[EVOLUTION] Erro ao verificar status:', error.response?.data || error.message);
      throw error;
    }
  }
  async sendDocument(phone, base64Data, fileName, mimeType) {
    try {
      const url = `${this.baseUrl}/message/sendMedia/${this.instanceName}`;

      const payload = {
        number: phone,
        media: base64Data,
        mediatype: 'document',
        mimetype: mimeType,
        fileName: fileName
      };

      const response = await retryWithBackoff(
        () => withTimeout(
          this.axiosInstance.post(url, payload, {
            headers: {
              'apikey': this.apiKey,
              'Content-Type': 'application/json'
            }
          }),
          30000, // 30s timeout for media
          'Timeout ao enviar documento via Evolution API (30s)'
        ),
        2,
        1000
      );

      return response.data;
    } catch (error) {
      console.error('[EVOLUTION] Erro ao enviar documento:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new EvolutionService();
