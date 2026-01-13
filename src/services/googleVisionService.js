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
      this.useRestAPI = false;
      this.apiKey = null;
      this.isAvailable = false;
      return;
    }

    this.useRestAPI = false;
    this.apiKey = null;
    this.isAvailable = false;

    try {
      // Prioridade 1: Credentials JSON (mais seguro, para produção) - usa SDK
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        this.client = new vision.ImageAnnotatorClient({
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
        });
        console.log('[VISION] ✅ Google Vision inicializado com credentials JSON (SDK)');
        this.useRestAPI = false;
        this.isAvailable = true;
      } 
      // Prioridade 2: API Key direta - usa REST API (mais confiável)
      else if (process.env.GOOGLE_VISION_API_KEY) {
        // REST API funciona melhor com API key direta do que o SDK
        this.apiKey = process.env.GOOGLE_VISION_API_KEY;
        this.client = null; // Não usa SDK quando tem API key
        this.useRestAPI = true;
        this.isAvailable = true;
        console.log('[VISION] ✅ Google Vision configurado para usar REST API (mais confiável com API key)');
        console.log('[VISION] API Key configurada (primeiros 10 chars):', this.apiKey.substring(0, 10) + '...');
      }
    } catch (error) {
      console.error('[VISION] ❌ Erro ao inicializar Google Vision:', error.message);
      this.client = null;
      this.useRestAPI = false;
      this.apiKey = null;
      this.isAvailable = false;
    }
  }

  async processImage(imageBuffer, mimeType) {
    // Se tem API key, usa REST API (mais confiável)
    if (this.useRestAPI && this.apiKey) {
      return await this.processImageWithRestAPI(imageBuffer, mimeType);
    }

    // Se tem credentials JSON, usa SDK
    if (!this.client) {
      throw new Error('Google Vision não configurado. Configure GOOGLE_APPLICATION_CREDENTIALS ou GOOGLE_VISION_API_KEY');
    }

    try {
      console.log('[VISION] ========================================');
      console.log('[VISION] Processando imagem com Google Vision SDK...');
      console.log('[VISION] MIME Type:', mimeType);
      console.log('[VISION] Tamanho:', imageBuffer.length, 'bytes');
      console.log('[VISION] ========================================');

      // Google Vision aceita Buffer diretamente
      const image = {
        content: imageBuffer
      };

      // Extrai texto da imagem (OCR)
      console.log('[VISION] Extraindo texto (OCR) com Google Vision SDK...');
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

      // Processa texto com Gemini
      return await this.processTextWithGemini(fullText);
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
    if (!this.apiKey) {
      throw new Error('GOOGLE_VISION_API_KEY não configurada');
    }

    try {
      console.log('[VISION] ========================================');
      console.log('[VISION] Processando imagem com Google Vision REST API...');
      console.log('[VISION] MIME Type:', mimeType);
      console.log('[VISION] Tamanho:', imageBuffer.length, 'bytes');
      console.log('[VISION] API Key presente:', this.apiKey ? 'SIM' : 'NÃO');
      console.log('[VISION] API Key (primeiros 10 chars):', this.apiKey.substring(0, 10) + '...');
      console.log('[VISION] ========================================');

      const base64Image = imageBuffer.toString('base64');
      console.log('[VISION] Base64 gerado, tamanho:', base64Image.length, 'caracteres');
      
      // Google Vision REST API endpoint
      const url = `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`;
      console.log('[VISION] URL da API:', url.replace(this.apiKey, 'API_KEY_HIDDEN'));
      
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

      console.log('[VISION] Request body preparado');
      console.log('[VISION] Número de requests:', requestBody.requests.length);
      console.log('[VISION] Feature type:', requestBody.requests[0].features[0].type);
      console.log('[VISION] Chamando Google Vision REST API...');
      
      const startTime = Date.now();
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
      const duration = Date.now() - startTime;
      console.log('[VISION] ✅ Resposta recebida em', duration, 'ms');
      console.log('[VISION] Status HTTP:', response.status);
      console.log('[VISION] Headers:', JSON.stringify(response.headers).substring(0, 200));

      // Verifica erros na resposta
      if (response.data.error) {
        console.error('[VISION] ❌ Erro na resposta da API:', JSON.stringify(response.data.error));
        throw new Error(`Google Vision API Error: ${response.data.error.message || JSON.stringify(response.data.error)}`);
      }

      console.log('[VISION] Response data keys:', Object.keys(response.data));
      const responses = response.data.responses;
      console.log('[VISION] Número de responses:', responses ? responses.length : 0);
      
      if (!responses || responses.length === 0) {
        console.error('[VISION] ❌ Resposta vazia do Google Vision API');
        console.error('[VISION] Response data completo:', JSON.stringify(response.data).substring(0, 1000));
        throw new Error('Resposta vazia do Google Vision API');
      }

      // Verifica se tem erro na resposta individual
      if (responses[0].error) {
        console.error('[VISION] ❌ Erro na response individual:', JSON.stringify(responses[0].error));
        throw new Error(`Google Vision API Error: ${responses[0].error.message || JSON.stringify(responses[0].error)}`);
      }

      console.log('[VISION] Response[0] keys:', Object.keys(responses[0]));
      console.log('[VISION] Tem textAnnotations?', !!responses[0].textAnnotations);
      console.log('[VISION] Número de textAnnotations:', responses[0].textAnnotations ? responses[0].textAnnotations.length : 0);

      if (!responses[0].textAnnotations || responses[0].textAnnotations.length === 0) {
        console.error('[VISION] ❌ Nenhum texto encontrado na imagem');
        console.error('[VISION] Response[0] completo:', JSON.stringify(responses[0]).substring(0, 500));
        throw new Error('Nenhum texto encontrado na imagem');
      }

      const textAnnotations = responses[0].textAnnotations;
      const fullText = textAnnotations[0].description || '';
      
      console.log('[VISION] ✅ Texto extraído com sucesso!');
      console.log('[VISION] Tamanho do texto:', fullText.length, 'caracteres');
      console.log('[VISION] Número de palavras:', fullText.split(/\s+/).length);
      console.log('[VISION] Primeiros 200 caracteres:', fullText.substring(0, 200));
      console.log('[VISION] Últimos 200 caracteres:', fullText.substring(Math.max(0, fullText.length - 200)));

      // Processa texto com Gemini
      console.log('[VISION] Iniciando processamento do texto com Gemini...');
      const geminiResult = await this.processTextWithGemini(fullText);
      console.log('[VISION] ✅ Processamento completo com Gemini');
      return geminiResult;
    } catch (error) {
      console.error('[VISION] ❌ Erro ao processar com REST API');
      console.error('[VISION] Tipo do erro:', error.constructor.name);
      console.error('[VISION] Mensagem:', error.message);
      console.error('[VISION] Stack:', error.stack);
      
      if (error.response) {
        console.error('[VISION] Status HTTP:', error.response.status);
        console.error('[VISION] Status Text:', error.response.statusText);
        console.error('[VISION] Response headers:', JSON.stringify(error.response.headers).substring(0, 300));
        console.error('[VISION] Response data:', JSON.stringify(error.response.data).substring(0, 1000));
        
        if (error.response.status === 400) {
          const errorMsg = error.response.data?.error?.message || 'Erro na requisição ao Google Vision. Verifique se a imagem é válida.';
          throw new Error(`Erro 400: ${errorMsg}`);
        }
        
        if (error.response.status === 403) {
          const errorMsg = error.response.data?.error?.message || 'API key inválida ou sem permissões';
          console.error('[VISION] ❌ Erro 403 - Verifique:');
          console.error('[VISION] 1. Se GOOGLE_VISION_API_KEY está correta');
          console.error('[VISION] 2. Se Cloud Vision API está habilitada no Google Cloud Console');
          console.error('[VISION] 3. Se a API key tem permissões para Cloud Vision API');
          throw new Error(`API key inválida ou sem permissões: ${errorMsg}`);
        }
        
        if (error.response.status === 429) {
          throw new Error('Limite de requisições do Google Vision atingido. Tente novamente em alguns instantes.');
        }
      }
      
      // Re-throw o erro original com contexto
      throw error;
    }
  }

  async processTextWithGemini(fullText) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY não configurada. Necessária para processar texto extraído pelo Google Vision.');
    }
    
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const { buildDocumentExtractionPrompt } = require('../config/prompts');
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    // Usa prompt centralizado para consistência
    const prompt = buildDocumentExtractionPrompt(fullText);

    console.log('[VISION] Processando texto com Gemini para extrair dados...');
    console.log('[VISION] Tamanho do prompt:', prompt.length, 'caracteres');
    console.log('[VISION] Tamanho do texto extraído:', fullText.length, 'caracteres');
    
    const startTime = Date.now();
    const geminiResult = await retryWithBackoff(
      () => withTimeout(
        geminiModel.generateContent(prompt),
        IMAGE_PROCESSING_TIMEOUT_MS,
        'Timeout ao processar texto com Gemini (60s)'
      ),
      2,
      1000
    );
    const geminiDuration = Date.now() - startTime;
    console.log('[VISION] ✅ Resposta do Gemini recebida em', geminiDuration, 'ms');
    
    const response = await geminiResult.response;
    const text = response.text();
    console.log('[VISION] Tamanho da resposta do Gemini:', text.length, 'caracteres');
    console.log('[VISION] Primeiros 300 caracteres da resposta:', text.substring(0, 300));

    // Remove markdown code blocks se houver
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    console.log('[VISION] JSON após limpeza:', jsonText.length, 'caracteres');
    console.log('[VISION] Primeiros 500 caracteres do JSON:', jsonText.substring(0, 500));

    try {
      const parsed = JSON.parse(jsonText);
      console.log('[VISION] ✅ JSON parseado com sucesso!');
      console.log('[VISION] Tipo documento:', parsed.tipo_documento);
      console.log('[VISION] Número de transações:', parsed.transacoes?.length || 0);
      
      if (parsed.transacoes && parsed.transacoes.length > 0) {
        parsed.transacoes.forEach((t, i) => {
          console.log(`[VISION] Transação ${i + 1}:`, {
            tipo: t.tipo,
            valor: t.valor,
            categoria: t.categoria,
            data: t.data
          });
        });
      }
      
      return parsed;
    } catch (parseError) {
      console.error('[VISION] ❌ Erro ao fazer parse do JSON');
      console.error('[VISION] Erro:', parseError.message);
      console.error('[VISION] Stack:', parseError.stack);
      console.error('[VISION] JSON completo recebido:', jsonText);
      throw new Error(`Erro ao processar resposta do Gemini: ${parseError.message}`);
    }
  }
}

module.exports = new GoogleVisionService();

