const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { buildMdrExtractionPrompt } = require('../config/prompts');
require('dotenv').config();

const MODEL_ID = 'gemini-2.0-flash-exp';

class MdrOcrService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY não configurada para OCR de MDR.');
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = genAI.getGenerativeModel({ model: MODEL_ID });
  }

  async extractRates({ imageUrl, provider }) {
    if (!imageUrl) {
      throw new Error('URL da imagem é obrigatória');
    }

    const buffer = await this.downloadImage(imageUrl);
    // Usa prompt centralizado
    const prompt = buildMdrExtractionPrompt(provider);

    const imagePart = {
      inlineData: {
        data: buffer.data.toString('base64'),
        mimeType: buffer.mimeType
      }
    };

    const result = await this.model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    return this.normalizeExtraction(parsed, provider);
  }

  async downloadImage(imageUrl) {
    const res = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'apikey': process.env.EVOLUTION_API_KEY
      }
    });

    return {
      data: Buffer.from(res.data),
      mimeType: res.headers['content-type'] || 'image/jpeg'
    };
  }

  // Método mantido por compatibilidade, mas usa prompt centralizado
  buildPrompt(provider) {
    return buildMdrExtractionPrompt(provider);
  }

  normalizeExtraction(data, fallbackProvider) {
    return {
      provider: data.provider || fallbackProvider || null,
      bandeiras: data.bandeiras || [],
      tiposVenda: data.tiposVenda || {},
      observacoes: data.observacoes || null,
      parcelas: data.tiposVenda?.parcelado?.tabela || {}
    };
  }
}

module.exports = new MdrOcrService();

