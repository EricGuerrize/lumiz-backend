require('dotenv').config();
const axios = require('axios');
const { withTimeout, retryWithBackoff } = require('../utils/timeout');
const googleVisionService = require('./googleVisionService');

// Timeout para processamento de imagens (60 segundos - imagens podem demorar)
const IMAGE_PROCESSING_TIMEOUT_MS = 60000;

class DocumentService {
  constructor() {
    console.log('[DOC] DocumentService inicializado com Google Vision');
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
   * Processa imagem usando Google Vision API
   * @param {Buffer|string} imageBufferOrUrl - Buffer da imagem ou URL para download
   * @param {Object} messageKey - Chave da mensagem (opcional, para Evolution API)
   * @returns {Promise<Object>} - Resultado do OCR com texto extraído
   */
  async processImage(imageBufferOrUrl, messageKey = null) {
    try {
      console.log('[DOC] Iniciando processamento com Google Vision...');

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

      // Detecta o tipo da imagem (apenas para log)
      const { mimeType, fileExtension } = this.detectImageType(imageBuffer);
      console.log('[DOC] Tipo detectado:', mimeType, '(' + fileExtension + ')');

      // Chama Google Vision Service
      const extractedText = await withTimeout(
        googleVisionService.extractTextFromImage(imageBuffer),
        IMAGE_PROCESSING_TIMEOUT_MS,
        'Timeout ao processar imagem com Google Vision'
      );

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('Nenhum texto foi extraído da imagem');
      }

      console.log('[DOC] ✅ OCR concluído com sucesso');
      console.log('[DOC] Texto extraído:', extractedText.substring(0, 200) + '...');

      return {
        text: extractedText.trim(),
        confidence: 95, // Google Vision retorna confidence por bloco, simplificando aqui
        processor: 'google-vision'
      };

    } catch (error) {
      console.error('[DOC] ❌ Erro no processamento de imagem:', error.message);
      throw new Error(`Erro ao processar imagem: ${error.message}`);
    }
  }

  /**
   * Formata o resultado do OCR para exibição ao usuário
   * @param {Object} result - Resultado do processamento
   * @returns {string} - Mensagem formatada
   */
  formatDocumentSummary(result) {
    if (result.processor === 'google-vision' || result.processor === 'ocrspace' || result.processor === 'tesseract') {
      return `📄 *Texto Extraído (Google Vision)*\n\n"${result.text}"\n\n_Processado com sucesso ✅_`;
    }
    return 'Documento processado.';
  }
}

module.exports = new DocumentService();
