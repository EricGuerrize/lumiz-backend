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

      // Limita título a 20 caracteres (limite do WhatsApp)
      const title = message.length > 20 ? message.substring(0, 17) + '...' : message;
      const description = message.length > 20 ? message.substring(20) : '';
      
      // Limita e formata botões (máximo 3 botões, título máximo 20 caracteres)
      const formattedButtons = buttons.slice(0, 3).map((btn, index) => {
        // Remove emojis e limita tamanho
        const cleanBtn = btn.replace(/[📦🏠✅✏️❌]/g, '').trim();
        const shortBtn = cleanBtn.length > 20 ? cleanBtn.substring(0, 17) + '...' : cleanBtn;
        return {
          buttonId: `btn_${index}`,
          displayText: shortBtn
        };
      });
      
      const payload = {
        number: phone,
        buttonsText: title,
        title: title,
        description: description || '',
        footer: 'Lumiz',
        buttons: formattedButtons
      };
      
      console.log('[EVOLUTION] Payload dos botões:', JSON.stringify(payload, null, 2));

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
