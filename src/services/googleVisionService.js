const vision = require('@google-cloud/vision');
const axios = require('axios');
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
      // Prioridade 1: Credentials JSON (mais seguro, para produção)
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        this.client = new vision.ImageAnnotatorClient({
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
        });
        console.log('[VISION] ✅ Google Vision inicializado com credentials JSON');
      } 
      // Prioridade 2: API Key direta (mais simples, para desenvolvimento)
      else if (process.env.GOOGLE_VISION_API_KEY) {
        // Google Vision API aceita API key via variável de ambiente
        // Ou podemos passar diretamente no cliente
        process.env.GOOGLE_APPLICATION_CREDENTIALS = undefined; // Remove se existir
        this.client = new vision.ImageAnnotatorClient({
          apiKey: process.env.GOOGLE_VISION_API_KEY
        });
        console.log('[VISION] ✅ Google Vision inicializado com API key');
        console.log('[VISION] API Key configurada (primeiros 10 chars):', process.env.GOOGLE_VISION_API_KEY.substring(0, 10) + '...');
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

      // Configura opções da requisição (inclui API key se necessário)
      const requestOptions = {};
      if (process.env.GOOGLE_VISION_API_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // Se usando API key direta, pode precisar passar no request
        requestOptions.apiKey = process.env.GOOGLE_VISION_API_KEY;
      }

      // Extrai texto da imagem (OCR)
      console.log('[VISION] Extraindo texto (OCR) com Google Vision API...');
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
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY não configurada. Necessária para processar texto extraído pelo Google Vision.');
      }
      
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
      
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
      const geminiResult = await geminiModel.generateContent(prompt);
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

  async processImageWithRestAPI(imageBuffer, mimeType) {
    try {
      const base64Image = imageBuffer.toString('base64');
      
      // Google Vision REST API endpoint
      const url = `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`;
      
      const requestBody = {
        requests: [
          {
            image: {
              content: base64Image
            },
            features: [
              {
                type: 'TEXT_DETECTION',
                maxResults: 10
              }
            ]
          }
        ]
      };

      console.log('[VISION] Chamando Google Vision REST API...');
      const response = await retryWithBackoff(
        () => withTimeout(
          axios.post(url, requestBody, {
            headers: {
              'Content-Type': 'application/json'
            }
          }),
          IMAGE_PROCESSING_TIMEOUT_MS,
          'Timeout ao processar imagem com Google Vision REST API (60s)'
        ),
        2,
        1000
      );

      const responses = response.data.responses;
      if (!responses || responses.length === 0 || !responses[0].textAnnotations) {
        throw new Error('Nenhum texto encontrado na imagem');
      }

      const textAnnotations = responses[0].textAnnotations;
      const fullText = textAnnotations[0].description || '';
      
      console.log('[VISION] ✅ Texto extraído:', fullText.length, 'caracteres');
      console.log('[VISION] Primeiros 200 caracteres:', fullText.substring(0, 200));

      // Processa texto com Gemini (mesmo código do método anterior)
      return await this.processTextWithGemini(fullText);
    } catch (error) {
      console.error('[VISION] ❌ Erro ao processar com REST API:', error.message);
      
      if (error.response?.status === 403) {
        throw new Error('API key inválida ou sem permissões. Verifique GOOGLE_VISION_API_KEY.');
      }
      
      if (error.response?.status === 429) {
        throw new Error('Limite de requisições do Google Vision atingido. Tente novamente em alguns instantes.');
      }
      
      throw error;
    }
  }

  async processTextWithGemini(fullText) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY não configurada. Necessária para processar texto extraído pelo Google Vision.');
    }
    
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
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
    const geminiResult = await geminiModel.generateContent(prompt);
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
  }
}

module.exports = new GoogleVisionService();

