const vision = require('@google-cloud/vision');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
require('dotenv').config();

// Timeout para processamento de imagens (60 segundos)
const IMAGE_PROCESSING_TIMEOUT_MS = 60000;

class GoogleVisionService {
  constructor() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_VISION_API_KEY) {
      console.warn('[VISION] Google Vision não configurado. Configure GOOGLE_APPLICATION_CREDENTIALS ou GOOGLE_VISION_API_KEY');
      this.client = null;
      return;
    }

    try {
      // Tenta usar credentials JSON primeiro (mais seguro)
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        this.client = new vision.ImageAnnotatorClient({
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
        });
        console.log('[VISION] ✅ Google Vision inicializado com credentials JSON');
      } else if (process.env.GOOGLE_VISION_API_KEY) {
        // Fallback: usa API key direta (menos seguro, mas mais simples)
        this.client = new vision.ImageAnnotatorClient({
          apiKey: process.env.GOOGLE_VISION_API_KEY
        });
        console.log('[VISION] ✅ Google Vision inicializado com API key');
      }
    } catch (error) {
      console.error('[VISION] ❌ Erro ao inicializar Google Vision:', error.message);
      this.client = null;
    }
  }

  async processImage(imageBuffer, mimeType) {
    if (!this.client) {
      throw new Error('Google Vision não configurado. Configure GOOGLE_APPLICATION_CREDENTIALS ou GOOGLE_VISION_API_KEY');
    }

    try {
      console.log('[VISION] ========================================');
      console.log('[VISION] Processando imagem com Google Vision...');
      console.log('[VISION] MIME Type:', mimeType);
      console.log('[VISION] Tamanho:', imageBuffer.length, 'bytes');
      console.log('[VISION] ========================================');

      // Google Vision aceita Buffer diretamente
      const image = {
        content: imageBuffer
      };

      // Extrai texto da imagem (OCR)
      console.log('[VISION] Extraindo texto (OCR)...');
      const [textResult] = await retryWithBackoff(
        () => withTimeout(
          this.client.textDetection(image),
          IMAGE_PROCESSING_TIMEOUT_MS,
          'Timeout ao processar imagem com Google Vision (60s)'
        ),
        2,
        1000
      );

      const textAnnotations = textResult.textAnnotations;
      
      if (!textAnnotations || textAnnotations.length === 0) {
        throw new Error('Nenhum texto encontrado na imagem');
      }

      // Pega todo o texto extraído
      const fullText = textAnnotations[0].description || '';
      console.log('[VISION] ✅ Texto extraído:', fullText.length, 'caracteres');
      console.log('[VISION] Primeiros 200 caracteres:', fullText.substring(0, 200));

      // Agora precisa processar o texto com Gemini para extrair dados estruturados
      // (Google Vision só faz OCR, não entende contexto)
      const geminiService = require('./geminiService');
      
      // Cria um prompt para o Gemini processar o texto extraído
      const dataHoje = new Date().toISOString().split('T')[0];
      
      const prompt = `
TAREFA: Analisar este texto extraído de um documento financeiro e extrair informações estruturadas.

TEXTO EXTRAÍDO DO DOCUMENTO:
${fullText}

DATA DE HOJE: ${dataHoje}

INSTRUÇÕES:
- Analise o texto e identifique o tipo de documento (boleto, extrato, comprovante PIX, nota fiscal, etc)
- Extraia todas as transações encontradas
- Para cada transação, identifique: tipo (entrada/saída), valor, categoria, data, descrição
- Siga as mesmas regras do prompt de análise de imagens para identificar tipo de documento e transações

REGRAS IMPORTANTES:
- Para BOLETO/NOTA FISCAL/FATURA: sempre é SAÍDA (custo a pagar)
- Para COMPROVANTE PIX: identifique se é entrada ou saída baseado no contexto
- Para NOTA FISCAL: extraia fornecedor, valor total, data, número da NF
- Para COMPROVANTE PIX MERCADO PAGO: procure por seções "De" e "Para", assuma que quem enviou o comprovante fez a transferência (tipo "saida")

RETORNE APENAS JSON NO SEGUINTE FORMATO:
{
  "tipo_documento": "boleto" | "extrato" | "comprovante_pix" | "comprovante" | "nota_fiscal" | "fatura" | "recibo" | "nao_identificado",
  "transacoes": [
    {
      "tipo": "entrada" | "saida",
      "valor": 1234.56,
      "categoria": "Nome da categoria",
      "data": "YYYY-MM-DD",
      "descricao": "Descrição detalhada"
    }
  ]
}
`;

      console.log('[VISION] Processando texto com Gemini para extrair dados...');
      const geminiResult = await geminiService.model.generateContent(prompt);
      const response = await geminiResult.response;
      const text = response.text();

      // Remove markdown code blocks se houver
      const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      try {
        const parsed = JSON.parse(jsonText);
        console.log('[VISION] ✅ Dados extraídos com sucesso');
        console.log('[VISION] Tipo documento:', parsed.tipo_documento);
        console.log('[VISION] Número de transações:', parsed.transacoes?.length || 0);
        return parsed;
      } catch (parseError) {
        console.error('[VISION] ❌ Erro ao fazer parse do JSON:', parseError.message);
        console.error('[VISION] JSON recebido:', jsonText.substring(0, 500));
        throw new Error(`Erro ao processar resposta do Gemini: ${parseError.message}`);
      }
    } catch (error) {
      console.error('[VISION] ❌ Erro ao processar imagem:', error.message);
      
      if (error.message && error.message.includes('Invalid image')) {
        throw new Error('A imagem enviada não é válida. Verifique se é uma imagem JPEG, PNG, WEBP ou PDF válida.');
      }

      if (error.message && error.message.includes('rate limit') || error.message.includes('quota')) {
        throw new Error('Limite de requisições do Google Vision atingido. Tente novamente em alguns instantes.');
      }

      throw new Error(`Erro ao processar documento com Google Vision: ${error.message}`);
    }
  }
}

module.exports = new GoogleVisionService();

