const axios = require('axios');
require('dotenv').config();

class EvolutionService {
  constructor() {
    this.baseUrl = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;
    this.instanceName = process.env.EVOLUTION_INSTANCE_NAME;
  }

  async sendMessage(phone, message) {
    try {
      const url = `${this.baseUrl}/message/sendText/${this.instanceName}`;

      const payload = {
        number: phone,
        text: message
      };

      const response = await axios.post(url, payload, {
        headers: {
          'apikey': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error.response?.data || error.message);
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

      const response = await axios.post(url, payload, {
        headers: {
          'apikey': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao enviar botões:', error.response?.data || error.message);
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

      const response = await axios.post(url, payload, {
        headers: {
          'apikey': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao enviar lista:', error.response?.data || error.message);
      // Fallback para mensagem de texto se lista não funcionar
      return await this.sendMessage(phone, message);
    }
  }

  async getInstanceStatus() {
    try {
      const url = `${this.baseUrl}/instance/connectionState/${this.instanceName}`;

      const response = await axios.get(url, {
        headers: {
          'apikey': this.apiKey
        }
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao verificar status:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new EvolutionService();
