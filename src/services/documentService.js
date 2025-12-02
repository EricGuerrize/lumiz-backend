const Tesseract = require('tesseract.js');
const axios = require('axios');
const { withTimeout } = require('../utils/timeout');
require('dotenv').config();

// Timeout para processamento de imagens (60 segundos - imagens podem demorar)
const IMAGE_PROCESSING_TIMEOUT_MS = 60000;

class DocumentService {
  constructor() {
  }

  async processImage(imageBuffer) {
    try {
      console.log('[DOC] Iniciando OCR com Tesseract...');

      // Converte buffer para base64 se necessário
      const imageBase64 = imageBuffer.toString('base64');
      const imageData = `data:image/png;base64,${imageBase64}`;

      // Configuração para economizar memória e usar dados locais
      const path = require('path');
      const worker = await Tesseract.createWorker('por+eng', 1, {
        cachePath: '/tmp',
        gzip: false,
        cacheMethod: 'refresh',
        langPath: path.join(__dirname, '../../tessdata'), // Caminho para os dados locais
        logger: info => console.log(`[OCR] ${info.status}: ${info.progress}`)
      });

      // Executa OCR
      const { data: { text, confidence } } = await worker.recognize(imageData);

      // Use o worker e depois termine
      await worker.terminate();

      console.log(`[DOC] OCR concluído. Confiança: ${confidence}%`);
      console.log(`[DOC] Texto extraído: ${text.substring(0, 100)}...`);

      if (!text || text.trim().length === 0) {
        throw new Error('Nenhum texto foi extraído da imagem');
      }

      return {
        text: text.trim(),
        confidence: confidence,
        processor: 'tesseract'
      };

    } catch (error) {
      console.error('[DOC] Erro no Tesseract OCR:', error);
      throw new Error(`Erro ao processar imagem com Tesseract: ${error.message}`);
    }
  }

  formatDocumentSummary(result) {
    if (result.processor === 'tesseract') {
      return `📄 *Texto Extraído (OCR)*\n\n"${result.text}"\n\n_Confiança: ${result.confidence}%_`;
    }
    return 'Documento processado.';
  }
}

module.exports = new DocumentService();
