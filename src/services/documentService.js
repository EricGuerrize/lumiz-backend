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
   * Detecta o tipo de imagem pelos magic numbers (primeiros bytes)
   * @param {Buffer} buffer - Buffer da imagem
   * @returns {Object} - { mimeType, fileExtension }
   */
  detectImageType(buffer) {
    const firstBytes = buffer.slice(0, 12);

    // Log dos primeiros bytes para debug
    const hexPreview = Array.from(firstBytes.slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    console.log('[DOC] Primeiros bytes (hex):', hexPreview);

    // JPEG: FF D8 FF
    if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) {
      return { mimeType: 'image/jpeg', fileExtension: 'JPG' };
    }
    // PNG: 89 50 4E 47
    else if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
      return { mimeType: 'image/png', fileExtension: 'PNG' };
    }
    // GIF: 47 49 46 38
    else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x38) {
      return { mimeType: 'image/gif', fileExtension: 'GIF' };
    }
    // WEBP: RIFF...WEBP
    else if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46 &&
             firstBytes[8] === 0x57 && firstBytes[9] === 0x45 && firstBytes[10] === 0x42 && firstBytes[11] === 0x50) {
      return { mimeType: 'image/webp', fileExtension: 'WEBP' };
    }
    // BMP: 42 4D
    else if (firstBytes[0] === 0x42 && firstBytes[1] === 0x4D) {
      return { mimeType: 'image/bmp', fileExtension: 'BMP' };
    }
    // PDF: 25 50 44 46 (%PDF)
    else if (firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && firstBytes[2] === 0x44 && firstBytes[3] === 0x46) {
      return { mimeType: 'application/pdf', fileExtension: 'PDF' };
    }

    // Padrão: assume JPEG
    console.log('[DOC] ⚠️ Tipo não identificado pelos magic numbers, usando JPEG como padrão');
    return { mimeType: 'image/jpeg', fileExtension: 'JPG' };
  }

  /**
   * Processa imagem usando OCR.space API
   * @param {Buffer|string} imageBufferOrUrl - Buffer da imagem ou URL para download
   * @param {Object} messageKey - Chave da mensagem (opcional, para Evolution API)
   * @returns {Promise<Object>} - Resultado do OCR com texto extraído
   */
  async processImage(imageBufferOrUrl, messageKey = null) {
    try {
      console.log('[DOC] Iniciando OCR com OCR.space API...');

      let imageBuffer;

      // Se recebeu uma string (URL), faz o download
      if (typeof imageBufferOrUrl === 'string') {
        const imageUrl = imageBufferOrUrl;
        console.log('[DOC] Baixando imagem da URL:', imageUrl.substring(0, 100) + '...');

        try {
          const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
              'apikey': process.env.EVOLUTION_API_KEY || '',
              'User-Agent': 'Lumiz-Backend/1.0',
              'Accept': 'image/*,application/pdf,*/*'
            }
          });

          imageBuffer = Buffer.from(response.data);
          console.log('[DOC] ✅ Arquivo baixado via URL');
        } catch (downloadError) {
          console.error('[DOC] ❌ Erro ao baixar arquivo:', downloadError.message);
          throw new Error(`Não foi possível baixar o arquivo: ${downloadError.message}`);
        }
      } else {
        // Já é um buffer
        imageBuffer = imageBufferOrUrl;
      }

      console.log('[DOC] Tamanho do buffer:', imageBuffer.length, 'bytes');

      // Detecta o tipo da imagem
      const { mimeType, fileExtension } = this.detectImageType(imageBuffer);
      console.log('[DOC] Tipo detectado:', mimeType, '(' + fileExtension + ')');

      // Converte buffer para base64 SEM prefixo (OCR.space prefere assim)
      const base64Image = imageBuffer.toString('base64');

      console.log('[DOC] Enviando para OCR.space API...');
      console.log('[DOC] Tamanho base64:', base64Image.length, 'chars');

      // Prepara o payload como application/x-www-form-urlencoded
      const FormData = require('form-data');
      const form = new FormData();

      // Cria um blob da imagem
      form.append('base64Image', `data:${mimeType};base64,${base64Image}`);
      form.append('language', 'por');
      form.append('isOverlayRequired', 'false');
      form.append('detectOrientation', 'true');
      form.append('scale', 'true');
      form.append('OCREngine', '2');

      // Chama OCR.space API usando multipart/form-data
      const response = await withTimeout(
        axios.post(
          'https://api.ocr.space/parse/image',
          form,
          {
            headers: {
              'apikey': OCR_SPACE_API_KEY,
              ...form.getHeaders()
            },
            timeout: 50000, // 50 segundos
            maxBodyLength: Infinity,
            maxContentLength: Infinity
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
