const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
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
    const prompt = this.buildPrompt(provider);

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

  buildPrompt(provider) {
    const providers = provider
      ? [provider]
      : ['Stone', 'PagSeguro', 'Rede', 'Cielo', 'GetNet', 'Mercado Pago'];

    return `
Você é um especialista em adquirência. Leia o print de taxas da maquininha e devolva APENAS um JSON com o seguinte formato:
{
  "provider": "nome encontrado ou sugerido",
  "bandeiras": [
    {
      "nome": "Visa",
      "debito_percent": 1.45,
      "credito_avista_percent": 3.19,
      "parcelado_percent": {
        "2x": 4.29,
        "3x": 4.99,
        "...": 0
      }
    }
  ],
  "tiposVenda": {
    "debito": {
      "liquidacao": "D+1",
      "taxa_media": 1.45
    },
    "credito_avista": {
      "liquidacao": "D+30",
      "taxa_media": 3.19
    },
    "parcelado": {
      "liquidacao": "D+30",
      "tabela": {
        "2x": 4.29,
        "3x": 4.99,
        "4x": 5.69,
        "5x": 6.39,
        "6x": 6.99,
        "7x": 7.59,
        "8x": 8.19,
        "9x": 8.79,
        "10x": 9.39,
        "11x": 9.99,
        "12x": 10.59
      }
    }
  },
  "observacoes": "comentários importantes"
}

REGRAS:
- Se algum campo não estiver no print, use null.
- Valores sempre em porcentagem com duas casas decimais.
- Informe o provider detectado ou o mais provável (entre ${providers.join(', ')}).
- NÃO retorne texto fora do JSON.
`;
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

