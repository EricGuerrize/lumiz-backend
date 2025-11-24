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

    // Configura timeout padrão para axios
    this.axiosInstance = axios.create({
      timeout: EVOLUTION_TIMEOUT_MS
    });
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

  async sendButtons(phone, message, buttons) {
    try {
      const url = `${this.baseUrl}/message/sendButtons/${this.instanceName}`;

      const payload = {
        number: phone,
        title: message,
        description: '',
        footer: 'Lumiz - Sua assistente financeira 💜',
        buttons: buttons.map((btn, index) => ({
          type: 'replyButton',
          reply: {
            id: `btn_${index}`,
            title: btn
          }
        }))
      };

      const response = await retryWithBackoff(
        () => withTimeout(
          this.axiosInstance.post(url, payload, {
            headers: {
              'apikey': this.apiKey,
              'Content-Type': 'application/json'
            }
          }),
          EVOLUTION_TIMEOUT_MS,
          'Timeout ao enviar botões via Evolution API (10s)'
        ),
        2,
        500
      );

      return response.data;
    } catch (error) {
      console.error('[EVOLUTION] Erro ao enviar botões:', error.response?.data || error.message);
      // Fallback para mensagem de texto se botões não funcionarem
      return await this.sendMessage(phone, message);
    }
  }

  async sendList(phone, message, buttonText, sections) {
    try {
      const url = `${this.baseUrl}/message/sendList/${this.instanceName}`;

      const payload = {
        number: phone,
        title: message,
        description: '',
        buttonText: buttonText,
        footer: 'Lumiz 💜',
        sections: sections
      };

      const response = await retryWithBackoff(
        () => withTimeout(
          this.axiosInstance.post(url, payload, {
            headers: {
              'apikey': this.apiKey,
              'Content-Type': 'application/json'
            }
          }),
          EVOLUTION_TIMEOUT_MS,
          'Timeout ao enviar lista via Evolution API (10s)'
        ),
        2,
        500
      );

      return response.data;
    } catch (error) {
      console.error('[EVOLUTION] Erro ao enviar lista:', error.response?.data || error.message);
      // Fallback para mensagem de texto se lista não funcionar
      return await this.sendMessage(phone, message);
    }
  }

  async sendDocument(phone, base64File, fileName, mimeType = 'application/pdf') {
    try {
      const url = `${this.baseUrl}/message/sendMedia/${this.instanceName}`;

      const payload = {
        number: phone,
        mediatype: 'document',
        media: `data:${mimeType};base64,${base64File}`,
        fileName: fileName,
        caption: ''
      };

      // Timeout maior para upload de arquivos (30 segundos)
      const response = await retryWithBackoff(
        () => withTimeout(
          this.axiosInstance.post(url, payload, {
            headers: {
              'apikey': this.apiKey,
              'Content-Type': 'application/json'
            }
          }),
          30000, // 30 segundos para upload
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
        throw new Error('Mídia não encontrada. Pode ter expirado ou sido removida.');
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
}

module.exports = new EvolutionService();
