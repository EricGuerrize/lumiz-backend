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
      console.log('[EVOLUTION] Tentando baixar mídia...');
      console.log('[EVOLUTION] MessageKey:', JSON.stringify(messageKey));
      console.log('[EVOLUTION] MediaType:', mediaType);
      
      // Evolution API pode usar diferentes endpoints dependendo da versão
      // Tenta múltiplos endpoints em ordem de prioridade
      const endpoints = [
        // Endpoint mais comum (v2+)
        `${this.baseUrl}/message/fetchMediaFromMessage/${this.instanceName}`,
        // Endpoint alternativo (v1)
        `${this.baseUrl}/chat/fetchMediaFromMessage/${this.instanceName}`,
        // Endpoint alternativo 2
        `${this.baseUrl}/media/fetchMediaFromMessage/${this.instanceName}`
      ];
      
      // Prepara payload no formato correto
      const payload = {
        messageKey: {
          remoteJid: messageKey.remoteJid,
          id: messageKey.id,
          fromMe: messageKey.fromMe || false
        }
      };

      let lastError = null;
      
      // Tenta cada endpoint até um funcionar
      for (let i = 0; i < endpoints.length; i++) {
        const url = endpoints[i];
        console.log(`[EVOLUTION] Tentando endpoint ${i + 1}/${endpoints.length}:`, url);
        console.log('[EVOLUTION] Payload:', JSON.stringify(payload));

        try {
          // Timeout maior para download de mídia (30 segundos)
          const response = await retryWithBackoff(
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
            1, // 1 tentativa por endpoint
            500 // delay inicial de 500ms
          );

          const buffer = Buffer.from(response.data);
          const contentType = response.headers['content-type'] || 'image/jpeg';
          
          console.log('[EVOLUTION] ✅ Mídia baixada com sucesso');
          console.log('[EVOLUTION] Endpoint usado:', url);
          console.log('[EVOLUTION] Status:', response.status);
          console.log('[EVOLUTION] Tamanho:', buffer.length, 'bytes');
          console.log('[EVOLUTION] Content-Type:', contentType);

          // Valida se o buffer não está vazio
          if (!buffer || buffer.length === 0) {
            throw new Error('Buffer vazio - mídia pode estar corrompida');
          }

          return {
            data: buffer,
            contentType: contentType,
            status: response.status
          };
        } catch (endpointError) {
          lastError = endpointError;
          console.log(`[EVOLUTION] ⚠️ Endpoint ${i + 1} falhou:`, endpointError.response?.status || endpointError.message);
          
          // Se não é 404, pode ser que o endpoint exista mas tenha outro problema
          // Se for 404, continua tentando outros endpoints
          if (endpointError.response?.status !== 404) {
            // Se não é 404, pode ser outro erro (401, 403, 500, etc) - não tenta outros endpoints
            throw endpointError;
          }
          
          // Se é 404, continua para o próximo endpoint
          if (i < endpoints.length - 1) {
            console.log('[EVOLUTION] Tentando próximo endpoint...');
          }
        }
      }
      
      // Se chegou aqui, todos os endpoints falharam
      throw lastError || new Error('Todos os endpoints falharam');
      
    } catch (error) {
      console.error('[EVOLUTION] ❌ Erro ao baixar mídia');
      console.error('[EVOLUTION] Status:', error.response?.status);
      console.error('[EVOLUTION] StatusText:', error.response?.statusText);
      console.error('[EVOLUTION] Message:', error.message);
      
      if (error.response?.data) {
        const errorData = error.response.data.toString ? error.response.data.toString().substring(0, 500) : JSON.stringify(error.response.data);
        console.error('[EVOLUTION] Response data:', errorData);
      }
      
      // Erros específicos
      if (error.response?.status === 404) {
        throw new Error('Mídia não encontrada. Pode ter expirado ou sido removida. Verifique se o endpoint da Evolution API está correto.');
      }
      
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error('Erro de autenticação na Evolution API. Verifique a API key.');
      }
      
      if (error.message.includes('Timeout')) {
        throw new Error('Timeout ao baixar mídia. Tente novamente.');
      }
      
      throw new Error(`Erro ao baixar mídia: ${error.message}`);
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
