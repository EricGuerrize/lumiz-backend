const axios = require('axios');
const { withTimeout } = require('../utils/timeout');
require('dotenv').config();

// Timeout para processamento de imagens (60 segundos - imagens podem demorar)
const IMAGE_PROCESSING_TIMEOUT_MS = 60000;

// API Key do OCR.space
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY || 'K83193260988957';

class DocumentService {
  constructor() {
    console.log('[DOC] DocumentService inicializado com OCR.space API');
  }

  /**
   * Processa imagem usando OCR.space API
   * @param {Buffer} imageBuffer - Buffer da imagem
   * @returns {Promise<Object>} - Resultado do OCR com texto extraído
   */
  async processImage(imageBuffer) {
    try {
      console.log('[DOC] Iniciando OCR com OCR.space API...');
      console.log('[DOC] Tamanho do buffer:', imageBuffer.length, 'bytes');

      // Converte buffer para base64
      const base64Image = imageBuffer.toString('base64');
      const base64WithPrefix = `data:image/jpeg;base64,${base64Image}`;

      console.log('[DOC] Enviando para OCR.space API...');

      // Chama OCR.space API
      const response = await withTimeout(
        axios.post(
          'https://api.ocr.space/parse/image',
          {
            base64Image: base64WithPrefix,
            language: 'por', // Português
            isOverlayRequired: false,
            detectOrientation: true,
            scale: true,
            OCREngine: 2, // Engine 2 é melhor para documentos
            filetype: 'JPG'
          },
          {
            headers: {
              'apikey': OCR_SPACE_API_KEY,
              'Content-Type': 'application/json'
            },
            timeout: 50000 // 50 segundos
          }
        ),
        IMAGE_PROCESSING_TIMEOUT_MS,
        'Timeout ao processar imagem com OCR.space'
      );

      console.log('[DOC] Resposta recebida do OCR.space');

      // Valida resposta
      if (!response.data) {
        throw new Error('Resposta vazia da API OCR.space');
      }

      if (response.data.IsErroredOnProcessing) {
        const errorMsg = response.data.ErrorMessage?.[0] || 'Erro desconhecido';
        throw new Error(`Erro no OCR.space: ${errorMsg}`);
      }

      // Extrai texto
      const parsedResults = response.data.ParsedResults;
      if (!parsedResults || parsedResults.length === 0) {
        throw new Error('Nenhum resultado foi retornado pelo OCR');
      }

      const extractedText = parsedResults[0].ParsedText;

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('Nenhum texto foi extraído da imagem');
      }

      console.log('[DOC] ✅ OCR concluído com sucesso');
      console.log('[DOC] Texto extraído:', extractedText.substring(0, 200) + '...');

      return {
        text: extractedText.trim(),
        confidence: 95, // OCR.space não retorna confidence, usar valor padrão
        processor: 'ocrspace'
      };

    } catch (error) {
      console.error('[DOC] ❌ Erro no OCR.space:', error.message);

      // Tratamento de erros específicos
      if (error.response) {
        console.error('[DOC] Status da resposta:', error.response.status);
        console.error('[DOC] Dados da resposta:', JSON.stringify(error.response.data));
      }

      throw new Error(`Erro ao processar imagem com OCR: ${error.message}`);
    }
  }

  /**
   * Formata o resultado do OCR para exibição ao usuário
   * @param {Object} result - Resultado do processamento
   * @returns {string} - Mensagem formatada
   */
  formatDocumentSummary(result) {
    if (result.processor === 'ocrspace' || result.processor === 'tesseract') {
      return `📄 *Texto Extraído (OCR)*\n\n"${result.text}"\n\n_Processado com sucesso ✅_`;
    }
    return 'Documento processado.';
  }
}

module.exports = new DocumentService();
